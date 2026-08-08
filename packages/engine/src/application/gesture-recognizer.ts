import type { ButtonEvent } from '../domain/action.js';
import { systemClock } from './ports/clock-port.js';
import type { ClockPort, TimerHandle } from './ports/clock-port.js';

/**
 * Turns contact and release into gestures.
 *
 * This belongs to the surface, not to the profile. A physical panel can only
 * report that a key went down and came up, so something has to sit between it
 * and the engine and decide whether that was a tap, a hold or half of a double
 * press. A surface that can work it out itself — a touchscreen across the
 * network — recognises locally and sends the finished gesture, which is also
 * what keeps a slow link from turning a double tap into two singles.
 *
 * Written to run in either place: the daemon uses it over HID reports, and a
 * browser uses the same class over touch events.
 *
 * Keys are independent. Two of them held at once produce two gestures, and
 * nothing here cares — the limit of one key at a time is the D6's matrix, not
 * a rule of the model.
 */

export interface GestureRecognizerOptions {
  /** How long a key must be held before a hold is reported. */
  readonly longPressMs?: number;
  /** How long a tap waits for a partner before it counts as an ordinary press. */
  readonly doublePressMs?: number;
  readonly clock?: ClockPort;
}

export const DEFAULT_LONG_PRESS_MS = 500;
/**
 * Long enough for a deliberate double tap, short enough that the wait does not
 * read as the deck being slow. Only keys that bind a double press ever wait.
 */
export const DEFAULT_DOUBLE_PRESS_MS = 300;

/** A key's progress through a gesture. */
interface Progress {
  /** Fires the hold if the key is still down when it expires. */
  longPress?: TimerHandle;
  /** Open window for a second tap; while it runs, the next press is a second. */
  pending?: TimerHandle;
  second: boolean;
  held: boolean;
}

export class GestureRecognizer {
  private readonly progress = new Map<number, Progress>();
  /** Keys whose current appearance binds a double press. */
  private doublePressKeys: ReadonlySet<number> = new Set();

  private readonly longPressMs: number;
  private readonly doublePressMs: number;
  private readonly clock: ClockPort;

  constructor(
    private readonly emit: (key: number, gesture: ButtonEvent) => void,
    options: GestureRecognizerOptions = {},
  ) {
    this.longPressMs = options.longPressMs ?? DEFAULT_LONG_PRESS_MS;
    this.doublePressMs = options.doublePressMs ?? DEFAULT_DOUBLE_PRESS_MS;
    this.clock = options.clock ?? systemClock;
  }

  /**
   * Which keys currently have something bound to a double press.
   *
   * Told rather than guessed, because only the profile knows. Waiting on every
   * key would make the whole deck feel late for a feature most buttons do not
   * use; waiting on none would make a second tap impossible to recognise.
   */
  setDoublePressKeys(keys: Iterable<number>): void {
    this.doublePressKeys = new Set(keys);
  }

  /**
   * Contact. Nothing is reported yet, because nothing is known yet.
   *
   * A press arriving while a tap still waits for its partner is the second half
   * of a double press. Every press starts the hold timer, that second one
   * included: holding means the same thing wherever it happens, and a key held
   * down with nothing happening reads as the deck having stuck.
   */
  down(key: number): void {
    const progress = this.progress.get(key) ?? { second: false, held: false };

    // A repeated press without a release means the release report was lost.
    // Drop the orphaned timer, or it would later fire a phantom hold.
    if (progress.longPress !== undefined) this.clock.clearTimeout(progress.longPress);

    if (progress.pending !== undefined) {
      this.clock.clearTimeout(progress.pending);
      progress.pending = undefined;
      progress.second = true;
    }

    progress.held = false;
    progress.longPress = this.clock.setTimeout(() => {
      progress.longPress = undefined;
      progress.held = true;
      // The hold wins outright: the tap that was waiting is abandoned rather
      // than reported alongside it, and this press no longer completes a pair.
      progress.second = false;
      this.emit(key, 'longPress');
    }, this.longPressMs);

    this.progress.set(key, progress);
  }

  /** Release, where an ordinary press is finally decided. */
  up(key: number): void {
    const progress = this.progress.get(key);
    if (!progress) return;

    if (progress.longPress !== undefined) {
      this.clock.clearTimeout(progress.longPress);
      progress.longPress = undefined;
    }

    // A hold swallows its release. Without this, holding a key would report
    // both the hold and an ordinary press — exactly wrong when the two undo
    // each other, as in hold-to-reset-a-counter.
    if (progress.held) {
      progress.held = false;
      progress.second = false;
      return;
    }

    if (progress.second) {
      progress.second = false;
      this.emit(key, 'doublePress');
      return;
    }

    if (!this.doublePressKeys.has(key)) {
      this.emit(key, 'press');
      return;
    }

    progress.pending = this.clock.setTimeout(() => {
      progress.pending = undefined;
      this.emit(key, 'press');
    }, this.doublePressMs);
  }

  /** Forgets every key mid-gesture and cancels its timers. */
  reset(): void {
    for (const progress of this.progress.values()) {
      if (progress.longPress !== undefined) this.clock.clearTimeout(progress.longPress);
      if (progress.pending !== undefined) this.clock.clearTimeout(progress.pending);
    }
    this.progress.clear();
  }
}

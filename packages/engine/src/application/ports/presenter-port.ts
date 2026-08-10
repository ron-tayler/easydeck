import type { ButtonEvent } from '../../domain/action.js';
import type { Scene } from '../../domain/scene.js';

/**
 * Outbound port: a deck, as the engine needs it.
 *
 * Narrower than it looks. The engine says what the panel should show and hears
 * which gestures happened on it; it never learns which key gets which slice of
 * a picture, what is worth re-encoding, how fast an animation may run — nor
 * even whether a press was long or short. All of that belongs to whoever
 * implements this.
 *
 * Gestures rather than contact and release, because recognising them is a
 * property of the surface. A physical panel can only report that a key went
 * down, so its adapter runs a `GestureRecognizer` over the reports. A
 * touchscreen across the network recognises locally and sends the finished
 * gesture, which is what stops a slow link from turning a double tap into two
 * singles.
 */
export interface PresenterPort {
  readonly layout: { readonly rows: number; readonly cols: number };

  /** Registers a gesture listener. Returns an unsubscribe function. */
  onGesture(listener: (key: number, gesture: ButtonEvent) => void): () => void;

  /** Resolves once the scene is visibly on the deck. */
  present(scene: Scene): Promise<void>;

  /**
   * Which keys currently bind a double press.
   *
   * Only the profile knows this, and a recogniser needs it: waiting on every
   * key would make the whole deck feel late for a feature most buttons never
   * use, and waiting on none would make a second tap impossible to see.
   *
   * Optional, so a surface that does not recognise anything — a test double, a
   * mirror — simply leaves it out.
   */
  setDoublePressKeys?(keys: readonly number[]): void;
  /**
   * Which keys have something bound to being held.
   *
   * A surface that shows a key as pressed uses this to decide when to stop:
   * once a hold has fired on such a key, the acknowledgement has served its
   * purpose and the key returns to size with the finger still on it.
   */
  setLongPressKeys?(keys: readonly number[]): void;
}

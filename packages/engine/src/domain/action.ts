import type { VariableStore, VariableValue } from './variables.js';

/**
 * An action as stored in a profile: a type plus free-form parameters.
 *
 * Keeping actions declarative rather than as functions is what lets profiles
 * be plain JSON — shareable, diffable, and editable by a GUI that knows
 * nothing about the code behind each type.
 */
export interface ActionDescriptor {
  readonly type: string;
  readonly params?: Readonly<Record<string, unknown>>;
}

/**
 * Gestures an action can be bound to.
 *
 * Three gestures, and no way to bind the raw press and release separately.
 * That is the point: `down` and `up` looked more expressive, but a gesture
 * cannot be recognised from the moment a key goes down. Holding and
 * double-pressing both begin with a press that looks exactly like an ordinary
 * one, so anything bound to `down` fired before the deck could know which
 * gesture it was watching, and every combination ran two actions.
 *
 * - `press` — a tap. Runs on release, not on contact, because until the key
 *   comes back up it might still turn into a hold or the first half of a
 *   double press.
 * - `longPress` — the key held down. Runs while it is still held, and the
 *   release that follows does nothing.
 * - `doublePress` — two taps in quick succession, running on the second
 *   release.
 *
 * The cost is one deliberate delay: a button that binds `doublePress` cannot
 * run its `press` until the window for a second tap has closed. A button that
 * does not bind it runs `press` the instant the key is released, so nobody
 * pays for a feature they did not ask for.
 */
export type ButtonEvent = 'press' | 'longPress' | 'doublePress';

export const BUTTON_EVENTS: readonly ButtonEvent[] = ['press', 'longPress', 'doublePress'];

/**
 * What a handler is allowed to do to the deck while running.
 *
 * Note that every navigation method is something a user has to put on a
 * button: nothing moves between folders or pages by itself. Where the deck
 * goes is entirely a matter of what the profile says.
 */
export interface ActionContext {
  readonly variables: VariableStore;
  /**
   * Which deck the press came from.
   *
   * Navigation acts on this one: turning a page on the tablet must not move
   * the panel on the desk. Variables, by contrast, are shared — one machine,
   * several ways to reach it.
   */
  readonly deckId: string;
  /** The button whose event triggered this action. */
  readonly button: { readonly id: string; readonly key: number };
  readonly location: { readonly folderId: string; readonly pageId: string };
  readonly profileId: string;

  /** Enters a folder, landing on its first page. */
  openFolder(folderId: string): void;
  /** Switches page. Any page of the profile is reachable, not just a sibling. */
  goToPage(pageId: string): void;
  /** Leaves for the parent folder. Does nothing at the root. */
  goUp(): void;
  goHome(): void;
  /** Returns to the previous location, as navigation history remembers it. */
  goBack(): void;
  /**
   * Forces a button's state. On a button bound to a variable this writes the
   * variable instead, so both ways of changing state stay in agreement.
   */
  setButtonState(buttonId: string, stateId: string): void;
}

export type ActionHandler = (
  params: Readonly<Record<string, unknown>>,
  context: ActionContext,
) => void | Promise<void>;

/** Reads a parameter that must be a non-empty string. */
export function stringParam(
  params: Readonly<Record<string, unknown>>,
  name: string,
): string {
  const value = params[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`Parameter '${name}' must be a non-empty string`);
  }
  return value;
}

/** Reads a parameter that must be a variable value. */
export function valueParam(
  params: Readonly<Record<string, unknown>>,
  name: string,
): VariableValue {
  const value = params[name];
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
    throw new TypeError(`Parameter '${name}' must be a string, number or boolean`);
  }
  return value;
}

export function numberParam(
  params: Readonly<Record<string, unknown>>,
  name: string,
  fallback: number,
): number {
  const value = params[name];
  if (value === undefined) return fallback;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new TypeError(`Parameter '${name}' must be a finite number`);
  }
  return parsed;
}

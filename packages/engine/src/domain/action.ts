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
  /**
   * Steps that belong inside this one, by branch name.
   *
   * What makes a script a tree rather than a list: `core.if` holds `then` and
   * `else`, `core.for` holds `do`. Ordinary actions have none, so a profile
   * written before blocks existed reads exactly as it did.
   *
   * Named branches rather than a single list because a fork has two arms and
   * numbering them would leave the meaning to the reader.
   */
  readonly branches?: Readonly<Record<string, readonly ActionDescriptor[]>>;
}

/**
 * The steps the engine runs itself rather than handing to a plugin.
 *
 * They are structure, not errands: an `if` is not something a deck *does*, it
 * is how what a deck does is arranged. Keeping them out of the plugin system
 * means a plugin cannot redefine what a loop means, and the editor can draw
 * them differently — nested, like blocks — without asking which plugin a step
 * came from.
 *
 * `core.delay` sits here for the same reason, having started life as an action
 * of the system plugin: waiting is punctuation between steps, and every script
 * wants it whether or not the system plugin happens to be installed.
 */
export const CORE_IF = 'core.if';
export const CORE_FOR = 'core.for';
export const CORE_DELAY = 'core.delay';

/**
 * A handler rather than a step: "when this becomes true, do that".
 *
 * Only ever found at the top of a button's `event` script, where each one is
 * an independent watcher. Written as a block because that is what it reads
 * as — a condition with something under it — but a list of them is not a
 * sequence: none of them waits for the one above.
 *
 * It fires on the *edge*, when its condition goes from false to true, not for
 * as long as it holds. A handler watching "processor over 90" should act when
 * the processor climbs past ninety, not once a second for as long as it is
 * busy.
 */
export const CORE_ON = 'core.on';

export const CORE_STEPS: readonly string[] = [CORE_IF, CORE_FOR, CORE_DELAY, CORE_ON];

export function isCoreStep(type: string): boolean {
  return CORE_STEPS.includes(type);
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
export type ButtonEvent = 'press' | 'longPress' | 'doublePress' | 'event';

/**
 * The gestures, which is not all the events.
 *
 * `event` is deliberately absent: it is not something a finger does, it is a
 * list of handlers watching the world. Everything that dispatches a gesture
 * walks this list, and adding it here would have a variable change look like a
 * press.
 */
export const BUTTON_EVENTS: readonly ButtonEvent[] = ['press', 'longPress', 'doublePress'];

/** Every key a button's `actions` may hold: the gestures, plus the watchers. */
export const BUTTON_SCRIPTS: readonly ButtonEvent[] = [...BUTTON_EVENTS, 'event'];

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
  /**
   * Changes one setting of the widget on a key, over what the profile says.
   *
   * `undefined` puts it back. Laid over rather than written in, for the same
   * reason a forced state is: what a key shows is a fact about this moment,
   * and a press that edited the document would have it rewriting itself from
   * use rather than from editing.
   */
  setWidgetParam(buttonId: string, name: string, value: VariableValue | undefined): void;

  /**
   * The state a button is showing, for a condition to ask about.
   *
   * Without an id, the button running the script — which is what somebody
   * means nine times in ten, and saves them looking up their own id.
   */
  buttonState?(buttonId?: string): string | undefined;

  /**
   * Values that exist only inside the step being run.
   *
   * `{{loop}}` and `{{loop.left}}` while a `for` is running, and nothing else
   * so far. Kept apart from the variable store on purpose: a loop counter is
   * not a fact about the machine, it must not appear in the variables list,
   * and two decks running the same profile must not share one.
   */
  readonly locals?: Readonly<Record<string, VariableValue>>;
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

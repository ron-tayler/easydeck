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
 * Button events an action can be bound to.
 *
 * Prefer `up` for ordinary actions. Binding to `down` means a long press runs
 * both the ordinary action and the long-press one, since the key must be
 * pressed before it can be held. `up` is skipped entirely once `longPress`
 * has fired, so the two never both run.
 *
 * `down` is still right for anything that should feel instant, or that pairs
 * with `up` to bracket something — push-to-talk being the obvious case.
 */
export type ButtonEvent = 'down' | 'up' | 'longPress';

export const BUTTON_EVENTS: readonly ButtonEvent[] = ['down', 'up', 'longPress'];

/** What a handler is allowed to do to the deck while running. */
export interface ActionContext {
  readonly variables: VariableStore;
  /** The button whose event triggered this action. */
  readonly button: { readonly id: string; readonly key: number };
  readonly pageId: string;
  readonly profileId: string;

  /** Navigates to another page of the current profile. */
  goToPage(pageId: string): void;
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

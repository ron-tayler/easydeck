import type { ActionDescriptor, ButtonEvent } from './action.js';
import type { VariableValue } from './variables.js';
import type { ButtonVisualTemplate } from './visual.js';

/** One appearance a button can have, together with what it does in it. */
export interface ButtonStateDefinition {
  readonly id: string;
  readonly visual: ButtonVisualTemplate;
  readonly actions?: Partial<Record<ButtonEvent, readonly ActionDescriptor[]>>;
}

export interface ButtonDefinition {
  /** Stable identity, independent of where the button sits. */
  readonly id: string;
  /** Logical key index: 0-based, row-major, top-left origin. */
  readonly key: number;
  readonly states: readonly ButtonStateDefinition[];
  readonly initialStateId?: string;
  /**
   * Binds the current state to a variable: its value names the state.
   *
   * This is what makes a button reflect the world rather than its own press
   * history — a mic button bound to `micOn` follows the mic even when
   * something else mutes it.
   */
  readonly stateFrom?: string;
}

export interface PageDefinition {
  readonly id: string;
  readonly name?: string;
  readonly buttons: readonly ButtonDefinition[];
}

export interface ProfileDefinition {
  readonly id: string;
  readonly name: string;
  /** Grid the profile is authored for; must match the surface it runs on. */
  readonly layout: { readonly rows: number; readonly cols: number };
  readonly pages: readonly PageDefinition[];
  readonly initialPageId?: string;
  readonly variables?: Readonly<Record<string, VariableValue>>;
}

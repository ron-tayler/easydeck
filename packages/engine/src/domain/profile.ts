import type { ActionDescriptor, ButtonEvent } from './action.js';
import type { VariableDeclaration, VariableValue } from './variables.js';
import type { ButtonVisualTemplate } from './visual.js';

/**
 * Bumped whenever a stored profile needs migrating. Documents on disk carry
 * it, so an old file can be recognised and upgraded instead of failing to
 * load with a confusing validation error.
 */
export const PROFILE_FORMAT_VERSION = 3;

/**
 * Adding a page is meant to be cheaper than creating a folder, but a scene
 * with dozens of pages is a filing system pretending to be a deck. The cap
 * keeps the page strip readable and the choice honest.
 */
export const MAX_PAGES_PER_FOLDER = 16;

/** One appearance a button can have, together with what it does in it. */
export interface ButtonStateDefinition {
  readonly id: string;
  readonly visual: ButtonVisualTemplate;
  readonly actions?: Partial<Record<ButtonEvent, readonly ActionDescriptor[]>>;
  /**
   * Value of the bound variable this state stands for.
   *
   * Only meaningful on a button with `stateFrom`, and only needed when the
   * state's own id is not the value — which is the common case as soon as the
   * variable is a boolean or an enum, since "on" is a better state name than
   * "true". Two states may claim the same value; the first one wins, so the
   * others act as spares rather than as an error.
   */
  readonly when?: VariableValue;
}

export interface ButtonDefinition {
  /** Stable identity, independent of where the button sits. */
  readonly id: string;
  /** Logical key index: 0-based, row-major, top-left origin. */
  readonly key: number;
  readonly states: readonly ButtonStateDefinition[];
  readonly initialStateId?: string;
  /**
   * Binds the current state to a variable.
   *
   * This is what makes a button reflect the world rather than its own press
   * history — a mic button bound to `micOn` follows the mic even when
   * something else mutes it.
   *
   * How a value picks a state depends on the variable's declared type, and
   * this is the one rule a profile author has to hold in their head:
   *
   * - a state whose `when` equals the value always wins, whatever the type;
   * - failing that, a state whose *id* equals the value wins, which is what
   *   every profile written before `when` existed relies on;
   * - `number` then falls back to a carousel: the value indexes the states and
   *   wraps round, so a counter walks them in order. That is why being able to
   *   reorder states matters;
   * - `boolean` falls back to position — first state false, second true — so
   *   they can be named "off" and "on" rather than "false" and "true";
   * - `string` and `enum` have no further fallback. An unmatched value leaves
   *   the button showing what it already showed, which is quieter than
   *   blanking a key because a plugin published something unexpected.
   */
  readonly stateFrom?: string;
}

/** One screenful of buttons inside a scene. */
export interface PageDefinition {
  readonly id: string;
  readonly name?: string;
  readonly buttons: readonly ButtonDefinition[];
}

/**
 * A scene, and a node of the profile's tree.
 *
 * Folders are how a profile is organised and how it is navigated — they are
 * the same thing on purpose. A folder may hold nothing but children, which
 * makes it a pure grouping; it may hold pages, which makes it a scene; it may
 * do both. Nothing navigates on its own: moving between folders and pages
 * happens only through actions the user puts on buttons.
 */
export interface FolderDefinition {
  readonly id: string;
  readonly name: string;
  readonly folders?: readonly FolderDefinition[];
  /** At least one, at most MAX_PAGES_PER_FOLDER. */
  readonly pages: readonly PageDefinition[];
}

export interface ProfileDefinition {
  readonly formatVersion: number;
  readonly id: string;
  readonly name: string;
  /** Grid the profile is authored for; must match the surface it runs on. */
  readonly layout: { readonly rows: number; readonly cols: number };
  readonly root: FolderDefinition;
  /** Where to start. Defaults to the root folder's first page. */
  readonly initialFolderId?: string;
  readonly initialPageId?: string;
  /**
   * Variables the profile's author created, declared rather than merely
   * seeded: the type is what tells the configurator which control to draw and
   * the controller how to map values onto states. Plugin variables are not
   * listed here — they belong to their plugin and arrive with it.
   */
  readonly variables?: readonly VariableDeclaration[];
}

/** Where the deck currently is. */
export interface DeckLocation {
  readonly folderId: string;
  readonly pageId: string;
}

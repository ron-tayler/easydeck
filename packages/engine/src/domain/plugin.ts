import type { ButtonDefinition } from './profile.js';
import type { SurfaceDefinition } from './surface-spec.js';
import type { VariableDeclaration, VariableValue } from './variables.js';

/**
 * Bumped when the plugin contract changes in a way that breaks existing
 * plugins. A plugin declares the version it was built against, so an
 * incompatible one can be refused with an explanation instead of failing in
 * some obscure way once a button is pressed.
 */
export const PLUGIN_API_VERSION = 1;

/**
 * Text a plugin shows to a person.
 *
 * English is required and everything else optional, so a plugin that never
 * heard of Russian still works and simply falls back. Translations travel
 * with the plugin rather than living in the host: only the plugin author
 * knows what their action does.
 */
export interface LocalizedText {
  readonly en: string;
  readonly [locale: string]: string | undefined;
}

/**
 * What kind of value a parameter holds, and therefore what control the
 * configurator draws for it.
 *
 * This list is the whole reason manifests exist. Macro Deck has plugins hand
 * the host a ready-made UI control instead, which chains a plugin to one
 * widget toolkit — their WinForms controls cannot be rendered by a web UI, a
 * phone, or anything else, and the host can neither validate nor translate
 * what it cannot see. Describing parameters as data keeps the plugin free of
 * any UI and lets every client render them its own way.
 */
export type ParamType =
  | 'string'
  | 'text'
  | 'number'
  | 'boolean'
  | 'select'
  | 'color'
  /** A variable name, offered from the ones the profile already has. */
  | 'variable'
  /** A folder of the current profile. */
  | 'profile-folder'
  /** A page of the current profile. */
  | 'profile-page'
  /** A button of the current page; empty means the one being pressed. */
  | 'profile-button'
  /**
   * A state of whichever button a nearby `profile-button` parameter names.
   *
   * The only parameter type that depends on another. It exists because
   * choosing a state by typing its name is a guess, and the set of valid
   * answers is knowable the moment the target button is known.
   */
  | 'button-state'
  /** A path on disk, offered through the platform's file picker. */
  | 'file'
  | 'directory'
  /** A key combination, chosen key by key from the catalogue. */
  | 'hotkey'
  /**
   * A secret the profile must not hold.
   *
   * The value never appears in the document: what is stored is a reference,
   * and the secret itself lives in the machine's sealed store, outside every
   * profile. A profile is meant to be copied to another machine, exported,
   * pasted into an issue — and a password that travelled with it would be a
   * password nobody meant to send.
   *
   * A client is told whether one is set, never what it is.
   */
  | 'password';

export interface ParamOption {
  readonly value: string;
  readonly label: LocalizedText;
}

export interface ParamDefinition {
  readonly name: string;
  readonly type: ParamType;
  readonly label: LocalizedText;
  readonly description?: LocalizedText;
  /** Defaults to true: most parameters are needed for the action to mean anything. */
  readonly required?: boolean;
  readonly default?: VariableValue;
  readonly placeholder?: LocalizedText;
  /** For `select`. */
  readonly options?: readonly ParamOption[];
  /**
   * Where the choices come from when only the plugin can know them.
   *
   * A name the plugin registers at run time — `'scenes'`, `'sources'` — and
   * the host qualifies with the plugin's id. Static `options` cannot express
   * a list that only exists while OBS is running, and asking the user to type
   * a scene name exactly is a guess dressed up as a field.
   *
   * The configurator must still let the name be typed by hand: the moment
   * somebody sets up their buttons is precisely the moment the program those
   * choices come from is likely to be closed.
   */
  readonly optionsFrom?: string;
  /**
   * Parameters that must be answered before this one is worth asking.
   *
   * A form for "hide this filter" needs a scene, then a source, then a filter,
   * and each list only exists once the one before it is known. Shown all at
   * once, two of the three are empty boxes that look broken; revealed in turn,
   * the form explains its own order.
   *
   * Only about *showing* the field. What the choices are is still
   * `optionsFrom`, which already receives whatever has been filled in.
   */
  readonly dependsOn?: readonly string[];
  /**
   * What to say when the choices come back empty, rather than showing nothing.
   *
   * "This key has no widget", "that scene has no sources". A `select` with an
   * empty list currently falls back to a text box, which in these cases is
   * worse than silence: it invites somebody to type an answer that cannot be
   * right.
   *
   * Static, and that is enough: a field only appears once the thing it depends
   * on has been chosen, so "empty" always means the same thing by then.
   */
  readonly emptyNote?: LocalizedText;
  /**
   * This field's *definition* is supplied at run time, not written here.
   *
   * For a parameter whose very type depends on an earlier answer: an action
   * that changes some widget's setting cannot know whether that setting is a
   * number, a colour or a list until the setting has been picked. Named like
   * `optionsFrom` and answered the same way, except the answer is a whole
   * `ParamDefinition` rather than a list of options.
   *
   * The point is that the definition is *borrowed* rather than restated — the
   * one the widget already uses in its own form, with its range, its options
   * and its colour picker intact. There is nothing to drift.
   */
  readonly shapeFrom?: string;
  /**
   * A password, token or key: stored apart and never sent to a client.
   *
   * The configurator is told the field exists and whether it is filled, never
   * what is in it. A form that round-trips a token through a browser in order
   * to save an unrelated field is a token in a browser's memory, its logs and
   * possibly its history.
   */
  readonly secret?: boolean;
  /** For `number`. */
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
}

export interface ActionDefinition {
  /** Fully qualified and namespaced by plugin, e.g. `vars.set-variable`. */
  readonly type: string;
  readonly label: LocalizedText;
  readonly description?: LocalizedText;
  readonly params?: readonly ParamDefinition[];
  /** Groups actions inside a plugin when it has many. */
  readonly group?: LocalizedText;
  /**
   * The mark shown in the palette.
   *
   * Either a name from the host's set of action icons — `home`, `variable`,
   * `keyboard` and so on — or a plugin's own drawing as a `data:` URL. A name
   * the host does not know draws a neutral mark rather than a hole, so a
   * plugin written against a newer set still has a usable palette.
   */
  readonly icon?: string;
  /**
   * Keeps this action out of the palette beside the deck grid, because a
   * preset already offers it as a finished key.
   *
   * Declared rather than worked out. Two attempts at deducing it from the
   * presets failed on the same rock: a preset holding one action may be that
   * action dressed up *or* one ingredient of something larger, and a preset
   * holding three may be a sequence whose parts are still worth offering
   * separately *or* the only sensible way to use any of them. Nothing in the
   * data distinguishes those, because the difference is what the author
   * meant.
   *
   * The action stays in the key editor regardless: a preset means nothing
   * inside a macro, where a step is what is wanted.
   */
  readonly presetOnly?: boolean;
}

/**
 * Something a plugin does from its own settings window rather than a key.
 *
 * Authorising with Twitch, reconnecting to OBS, testing a token: real work,
 * but not work anybody wants on a button. Keeping them out of the action
 * palette is the point — a palette listing "Authorise" next to "Switch scene"
 * invites somebody to bind the one that opens a browser to a key they press
 * by accident.
 */
export interface PluginCommand {
  /** Unique within the plugin; not namespaced, since it is never stored. */
  readonly name: string;
  readonly label: LocalizedText;
  readonly description?: LocalizedText;
  readonly icon?: string;
  /** Asked before running it, for commands that throw away access. */
  readonly confirm?: LocalizedText;
}

/**
 * A whole key a plugin knows how to build, ready to drop onto the deck.
 *
 * The difference between the two palettes. Dragging an *action* into a macro
 * adds that one step; dragging a *preset* onto the grid puts down a finished
 * key — its picture, its colour, its states and whatever it does. Which is
 * what "show me the processor" actually is: no action at all, a label reading
 * `{{hw.cpu}}%` and three states that colour it.
 *
 * Without this a plugin that publishes but does not act — a gauge, a viewer
 * count — cannot appear in the palette at all, because the palette is made of
 * actions and it has none.
 */
export interface ButtonPreset {
  /** Unique within the plugin, and never stored in a profile. */
  readonly name: string;
  readonly label: LocalizedText;
  readonly description?: LocalizedText;
  /**
   * The key itself, minus where it sits.
   *
   * `id` and `key` are the configurator's to assign, exactly as when a button
   * is made by dragging an action onto an empty space. Everything else — the
   * states, the binding, the colours — is the plugin's to decide, because the
   * point of a preset is that somebody already worked out what looks right.
   */
  readonly button: PresetButton;
}

export type PresetButton = Omit<ButtonDefinition, 'id' | 'key'>;

export interface PluginManifest {
  /** Short and stable; the prefix of every action type the plugin declares. */
  readonly id: string;
  readonly name: LocalizedText;
  readonly description?: LocalizedText;
  readonly version: string;
  /** The PLUGIN_API_VERSION this plugin was written against. */
  readonly apiVersion: number;
  /** Ships in the box and cannot be uninstalled. */
  readonly builtIn?: boolean;
  readonly actions: readonly ActionDefinition[];
  /**
   * Variables the plugin publishes, declared up front.
   *
   * This is how a plugin exposes live data for buttons to show and bind to:
   * it declares the variable here and writes to it whenever the world changes.
   * Declaring beats letting the plugin invent variables as it goes, because
   * the configurator can then offer them by name and type before the plugin
   * has ever written anything — otherwise a variable only becomes bindable
   * after it first happens to change, which is impossible to design against.
   */
  readonly variables?: readonly VariableDeclaration[];
  /**
   * Pictures this plugin can draw for a key.
   *
   * The third way a plugin reaches a button, after actions and variables:
   * `actions` is what a key does, `variables` is what it says in text, and
   * these are what it shows. See `docs/live-surfaces.md`.
   */
  readonly surfaces?: readonly SurfaceDefinition[];
  /**
   * What the plugin needs to know before it can do anything.
   *
   * Described with the same parameter definitions as an action, so the
   * configurator draws this form with the machinery it already has, and a
   * plugin still ships no UI of its own.
   */
  readonly settings?: readonly ParamDefinition[];
  /** Buttons at the foot of the settings window. */
  readonly commands?: readonly PluginCommand[];
  /**
   * Ready-made keys, offered where keys are made rather than where macros are.
   *
   * A plugin may have both these and actions; the palette shows presets on
   * the deck grid and actions inside the key editor, so the same plugin reads
   * as "here are some keys" in one place and "here are some steps" in the
   * other.
   */
  readonly presets?: readonly ButtonPreset[];
}

/** Picks the best translation available, falling back to English. */
export function localized(text: LocalizedText, locale: string): string {
  return text[locale] ?? text.en;
}

import type { VariableValue } from './variables.js';

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
  /** A path on disk, offered through the platform's file picker. */
  | 'file'
  | 'directory'
  /** A key combination, captured by pressing it. */
  | 'hotkey';

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
  /** For `number`. */
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
}

export interface ActionDefinition {
  /** Fully qualified and namespaced by plugin, e.g. `easydeck.set-variable`. */
  readonly type: string;
  readonly label: LocalizedText;
  readonly description?: LocalizedText;
  readonly params?: readonly ParamDefinition[];
  /** Groups actions inside a plugin when it has many. */
  readonly group?: LocalizedText;
}

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
}

/** Picks the best translation available, falling back to English. */
export function localized(text: LocalizedText, locale: string): string {
  return text[locale] ?? text.en;
}

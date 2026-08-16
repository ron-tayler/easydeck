import type { LocalizedText } from '@easydeck/engine';

/**
 * Shapes that travel over the API without belonging to the deck itself.
 *
 * A profile, a button and a variable are the engine's, and they cross the wire
 * as they are. These describe what the daemon knows about its own machine —
 * pictures lying in a folder, plugins installed or offered — and a window
 * needs their shape without needing anything that produces them.
 *
 * Types and nothing else. Whatever reads the folder or unpacks the archive
 * stays on the daemon's side of this line.
 */

/** Where a profile is filed, as a list of them shows it. */
export interface ProfileSummary {
  /** Where it is filed. Derived from the name; never inside the document. */
  readonly id: string;
  readonly name: string;
}

/** One picture in the user's own icon library. */
export interface LibraryImage {
  /** File name without its extension: what the user sees under the picture. */
  readonly name: string;
  readonly source: string;
  readonly bytes: number;
  /**
   * Which folder it came from, relative to the library root, with `/` as the
   * separator. Empty for a picture lying loose at the top.
   */
  readonly group: string;
}

/** A folder of the installation somebody may ask to have opened. */
export type AppFolder = 'config' | 'profiles' | 'plugins' | 'icons' | 'logs';

export interface InstalledPluginInfo {
  readonly id: string;
  readonly name: string;
  readonly version?: string;
  readonly description?: string;
  readonly kind: 'easydeck' | 'stream-deck-icons';
  /** How many pictures it contributes, which is most of what a pack is. */
  readonly icons: number;
  /** Locale codes it translates, so the window can say what it covers. */
  readonly locales: readonly string[];
}

export interface InstalledPluginSummary {
  readonly plugins: readonly InstalledPluginInfo[];
  /** Plugins that could not be read, named so the user can find them. */
  readonly broken: readonly { readonly id: string; readonly problem: string }[];
  /**
   * Translations to lay over the built-in text, by locale code.
   *
   * Sent with the list rather than fetched separately: the window needs them
   * before it draws anything a plugin named.
   */
  readonly messages: Readonly<Record<string, unknown>>;
}

/**
 * A row of the store: what it is, and where the user stands.
 *
 * The listing and the installed state together, because every row draws both
 * — the name and the picture from one, the button's word from the other. What
 * it deliberately does *not* carry is the manifest.
 */
export interface StorePlugin {
  readonly id: string;
  readonly author: string;
  readonly version: string;
  readonly apiVersion: number;
  /** How large the download is, for a row that says so before it starts. */
  readonly bytes: number;
  readonly name: LocalizedText;
  readonly description?: LocalizedText;
  /** What the author is called, as opposed to their slug. */
  readonly by?: LocalizedText;
  /** The one picture a row shows; a `plugin:<id>/<path>` reference. */
  readonly cover?: string;
  /** The version already on this machine, absent when there is none. */
  readonly installedVersion?: string;
  /** Whether this build can run it at all. See PLUGIN_API_VERSION. */
  readonly compatible: boolean;
}

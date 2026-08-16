import type { PluginManifest } from '@easydeck/engine';

/**
 * Where installable plugins come from.
 *
 * One interface with one implementation today — a folder sitting beside the
 * checkout — and a second one later that fetches from GitHub. The seam is
 * here rather than at the point of use so the store, the installer and the
 * window are written once and never learn which of the two they are talking
 * to: a source lists what it has, and hands over bytes when asked.
 *
 * Everything is asked for by plugin id. A source that cannot answer says so
 * by returning nothing rather than by throwing — a store that could not be
 * reached is an ordinary state of a program on somebody's laptop, not a
 * failure worth stopping for.
 */
export interface PluginSource {
  /** What this source is, for a window that may one day show several. */
  readonly name: string;

  /** Everything on offer. Empty when the source cannot be reached. */
  list(): Promise<readonly PluginListing[]>;

  /** The archive for one plugin, or nothing if it is not there any more. */
  download(id: string): Promise<Uint8Array | undefined>;

  /**
   * One of a listing's pictures, as bytes.
   *
   * Kept out of `list` deliberately: a store's list needs one small picture
   * per row and a card needs several large ones, and an index that carried
   * every screenshot of every plugin would be megabytes fetched to draw a
   * list somebody may scroll past.
   */
  image(id: string, reference: string): Promise<PluginImage | undefined>;
}

/** A plugin as a store shows it, before anybody has installed anything. */
export interface PluginListing {
  readonly id: string;
  /** The author's slug — the first half of the id. */
  readonly author: string;
  readonly version: string;
  /** The plugin API this was built against; a mismatch cannot be installed. */
  readonly apiVersion: number;
  readonly bytes: number;
  readonly sha256: string;
  /**
   * Everything a card shows, and it is the plugin's own manifest.
   *
   * Which means a store page needs nothing invented for it: the actions, the
   * variables and the settings a plugin declares are what it does, described
   * by the plugin rather than by a description of the plugin.
   */
  readonly manifest: PluginManifest;
}

export interface PluginImage {
  readonly bytes: Uint8Array;
  /** `image/png` and friends, worked out from the name. */
  readonly type: string;
}

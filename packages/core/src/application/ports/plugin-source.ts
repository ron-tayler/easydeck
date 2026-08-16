import type { LocalizedText, PluginManifest } from '@easydeck/engine';

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

  /** Everything on offer, one row's worth each. Empty when unreachable. */
  list(): Promise<readonly PluginListing[]>;

  /**
   * Everything about one plugin, for its card.
   *
   * Apart from the list because it is most of the weight: a manifest was 97
   * to 99 per cent of every index entry, so four plugins made a hundred
   * kilobytes of index to draw four names. A list is what somebody scrolls
   * and a card is what they chose to wait for.
   */
  details(id: string): Promise<PluginManifest | undefined>;

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

  /**
   * Forgets whatever was kept, because somebody asked to look again.
   *
   * Part of the interface rather than of one implementation: a source caches
   * for as long as the store is open — that is the whole point of the window
   * being one file — and "look again" is the only thing that may empty it. It
   * used to be called through an `instanceof` check against the folder
   * source, which meant the published store cached its shelf for the life of
   * the process and the button did nothing at all.
   */
  refresh?(): void;
}

/**
 * One row of a store: what it takes to decide whether to look closer.
 *
 * Deliberately small. Everything a *card* shows — the actions, the variables,
 * the settings, the screenshots — is in the manifest, and the manifest is
 * fetched for the one plugin somebody opened rather than for all of them.
 */
export interface PluginListing {
  readonly id: string;
  /** The author's slug — the first half of the id. */
  readonly author: string;
  readonly version: string;
  /** The plugin API this was built against; a mismatch cannot be installed. */
  readonly apiVersion: number;
  readonly bytes: number;
  readonly sha256: string;
  readonly name: LocalizedText;
  readonly description?: LocalizedText;
  /** What the author is called, as opposed to their slug. */
  readonly by?: LocalizedText;
  /** The one picture a row shows; a `plugin:<id>/<path>` reference. */
  readonly cover?: string;
}

export interface PluginImage {
  readonly bytes: Uint8Array;
  /** `image/png` and friends, worked out from the name. */
  readonly type: string;
}

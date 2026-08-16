import { extname } from 'node:path';

import type { PluginManifest } from '@easydeck/engine';

import type { PluginImage, PluginListing, PluginSource } from '../../application/ports/plugin-source.js';
import { ZipArchive } from '../zip.js';

/**
 * What every plugin source has in common, which turns out to be most of it.
 *
 * A source is a shop window and some plugins, wherever they happen to live.
 * Only *fetching a named file* differs between a folder on this machine and a
 * GitHub release — so that is the one thing a subclass writes, and everything
 * else is written once here.
 *
 * **The window is one file.** `store.zip` holds the index, every plugin's
 * manifest and every cover, so opening the store is a single download and
 * drawing the list costs nothing further. Two things drove that. GitHub
 * releases are a flat list of assets with no folders, and a file per plugin
 * per purpose was eleven of them at five plugins and forty-one at twenty. And
 * covers used to be read out of the plugins' own archives, which meant
 * drawing a list of five names downloaded 317 KB of plugin — measured, and
 * the reason the slim index it was meant to pair with bought nothing.
 *
 * A plugin's own archive is then fetched for exactly two reasons: installing
 * it, and showing a screenshot, which stays inside it because screenshots are
 * large, rare, and only ever wanted by somebody who opened one card.
 */

const TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

/** `plugin:<id>/<path>`, the same reference form a preset's icon uses. */
const REFERENCE = /^plugin:([A-Za-z0-9][A-Za-z0-9._-]*)\/(.+)$/;

/** The shop window: index, manifests and covers, in one archive. */
export const STORE_FILE = 'store.zip';

/** Where the index sits inside it. */
export const INDEX_FILE = 'index.json';

export abstract class ArchivePluginSource implements PluginSource {
  abstract readonly name: string;

  /** The window, read once and kept until somebody asks to look again. */
  private window?: ZipArchive;
  private windowRead = false;

  /**
   * Plugin archives already fetched, by id.
   *
   * Only screenshots reach for these now — a card that has one, opened by
   * somebody who is deciding whether to install it anyway.
   */
  private readonly opened = new Map<string, ZipArchive>();

  /**
   * Fetches one named file, or nothing.
   *
   * The only difference between sources. `name` is either the window or a
   * plugin archive the index named — never a path a person typed.
   */
  protected abstract fetch(name: string): Promise<Uint8Array | undefined>;

  async list(): Promise<readonly PluginListing[]> {
    const index = await this.readIndex();
    return (index?.plugins ?? []).filter(isListing);
  }

  async details(id: string): Promise<PluginManifest | undefined> {
    const bytes = (await this.openWindow())?.read(`${id}.json`);
    if (!bytes) return undefined;

    try {
      const manifest = JSON.parse(bytes.toString('utf8')) as PluginManifest;
      return typeof manifest?.name === 'object' ? manifest : undefined;
    } catch {
      return undefined;
    }
  }

  async download(id: string): Promise<Uint8Array | undefined> {
    const listing = (await this.readIndex())?.plugins.find((entry) => entry?.id === id);
    if (!listing?.file) return undefined;

    return this.fetch(listing.file);
  }

  /**
   * A picture, from the window if it is there and from the plugin if not.
   *
   * Covers are in the window, so a list draws itself from one download.
   * Screenshots are not, and fetching one means fetching the plugin — which
   * is the bargain: they are big, and only somebody reading one card wants
   * them.
   */
  async image(id: string, reference: string): Promise<PluginImage | undefined> {
    const found = REFERENCE.exec(reference);
    if (!found) return undefined;

    const [, owner, path] = found as unknown as [string, string, string];
    const type = TYPES[extname(path).toLowerCase()];
    if (!type) return undefined;

    // A plugin may point at another's picture — the same latitude a preset's
    // icon has — so the reference says whose file this is, not the caller.
    const whose = owner === '' ? id : owner;

    const fromWindow = (await this.openWindow())?.read(`${whose}/${path}`);
    if (fromWindow) return { bytes: fromWindow, type };

    const archive = await this.open(whose);
    const bytes = archive?.read(path);
    return bytes ? { bytes, type } : undefined;
  }

  /** Forgets everything read, for a store that was told to look again. */
  refresh(): void {
    this.opened.clear();
    this.window = undefined;
    this.windowRead = false;
  }

  private async openWindow(): Promise<ZipArchive | undefined> {
    if (this.windowRead) return this.window;
    this.windowRead = true;

    const bytes = await this.fetch(STORE_FILE);
    if (!bytes) return undefined;

    try {
      this.window = new ZipArchive(Buffer.from(bytes));
    } catch {
      // A half-written window during a rebuild, or a network that answered a
      // login page. An empty store beats a store that refuses to open.
      this.window = undefined;
    }

    return this.window;
  }

  private async open(id: string): Promise<ZipArchive | undefined> {
    const kept = this.opened.get(id);
    if (kept) return kept;

    const bytes = await this.download(id);
    if (!bytes) return undefined;

    const archive = new ZipArchive(Buffer.from(bytes));
    this.opened.set(id, archive);
    return archive;
  }

  private async readIndex(): Promise<RawIndex | undefined> {
    const bytes = (await this.openWindow())?.read(INDEX_FILE);
    if (!bytes) return undefined;

    try {
      const parsed = JSON.parse(bytes.toString('utf8')) as RawIndex;
      return Array.isArray(parsed?.plugins) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
}

export interface RawIndex {
  readonly plugins: (Partial<PluginListing> & { file?: string })[];
}

/** An index entry with everything a store needs, and nothing assumed. */
export function isListing(
  entry: Partial<PluginListing> & { file?: string },
): entry is PluginListing {
  return (
    typeof entry?.id === 'string' &&
    typeof entry.version === 'string' &&
    typeof entry.sha256 === 'string' &&
    typeof entry.apiVersion === 'number' &&
    typeof entry.name === 'object'
  );
}

import { extname } from 'node:path';

import type { PluginManifest } from '@easydeck/engine';

import type { PluginImage, PluginListing, PluginSource } from '../../application/ports/plugin-source.js';
import { ZipArchive } from '../zip.js';

/**
 * What every plugin source has in common, which turns out to be most of it.
 *
 * A source is an index and some archives, wherever they happen to live. Only
 * *fetching a named file* differs between a folder on this machine and a
 * GitHub release — so that is the one thing a subclass writes, and listing,
 * downloading, caching and reading pictures out of an archive are written
 * once here.
 *
 * The index format is the same for both by construction: it names files, not
 * places. `ed.obs.easydeck` is resolved under `build/` by one and under a
 * release by the other, and moving from the folder to GitHub therefore
 * changes where one file is read from and nothing else.
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

/** Where the index lives, relative to whatever the source's root means. */
export const INDEX_FILE = 'index.json';

export abstract class ArchivePluginSource implements PluginSource {
  abstract readonly name: string;

  /**
   * Archives already read, by id.
   *
   * A card asks for several pictures at once and each would otherwise fetch
   * and reparse the whole zip — over the network, several times, for one
   * screen.
   */
  private readonly opened = new Map<string, ZipArchive>();
  private index?: RawIndex;

  /**
   * Fetches one named file, or nothing.
   *
   * The only difference between sources. `name` is either the index or an
   * archive the index named — never a path a person typed.
   */
  protected abstract fetch(name: string): Promise<Uint8Array | undefined>;

  async list(): Promise<readonly PluginListing[]> {
    const index = await this.readIndex();
    return (index?.plugins ?? []).filter(isListing);
  }

  async download(id: string): Promise<Uint8Array | undefined> {
    const listing = (await this.readIndex())?.plugins.find((entry) => entry?.id === id);
    if (!listing?.file) return undefined;

    return this.fetch(listing.file);
  }

  async image(id: string, reference: string): Promise<PluginImage | undefined> {
    const found = REFERENCE.exec(reference);
    if (!found) return undefined;

    const [, owner, path] = found as unknown as [string, string, string];
    // A plugin may point at another's picture — the same latitude a preset's
    // icon has — so the reference says whose archive to open, not the caller.
    const archive = await this.open(owner === '' ? id : owner);
    if (!archive) return undefined;

    const type = TYPES[extname(path).toLowerCase()];
    const bytes = archive.read(path);
    if (!type || !bytes) return undefined;

    return { bytes, type };
  }

  /** Forgets everything read, for a store that was told to look again. */
  refresh(): void {
    this.opened.clear();
    this.index = undefined;
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
    if (this.index) return this.index;

    const bytes = await this.fetch(INDEX_FILE);
    if (!bytes) return undefined;

    try {
      const parsed = JSON.parse(Buffer.from(bytes).toString('utf8')) as RawIndex;
      if (!Array.isArray(parsed?.plugins)) return undefined;

      this.index = parsed;
      return parsed;
    } catch {
      // A half-written index during a rebuild, or a network that answered a
      // login page. An empty store beats a store that refuses to open.
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
    typeof (entry.manifest as PluginManifest | undefined)?.name === 'object'
  );
}

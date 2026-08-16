import { readFile } from 'node:fs/promises';
import { extname, isAbsolute, join, resolve, sep } from 'node:path';

import type { PluginManifest } from '@easydeck/engine';

import type { PluginImage, PluginListing, PluginSource } from '../../application/ports/plugin-source.js';
import { ZipArchive } from '../zip.js';

/**
 * The plugins repository as a folder on this machine.
 *
 * A stand-in for the day the store fetches from GitHub, and deliberately the
 * same shape: it reads `registry/index.json`, hands over the archive the
 * index names, and answers for pictures. Replacing it means writing one more
 * `PluginSource` and choosing which to construct — nothing above this line
 * knows the difference.
 *
 * Pictures come out of the *archive* rather than from beside it. That is not
 * thrift: it is what makes the two sources interchangeable, since a remote
 * one will have a zip and a URL and nothing else, and a store that had learnt
 * to read loose files in a sibling folder would have to unlearn it.
 */

/** Where a checkout of the plugins repository is expected to sit. */
export const DEFAULT_PLUGIN_SOURCE = 'easydeck-plugins';

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

export class FolderPluginSource implements PluginSource {
  readonly name = 'local';

  /**
   * Archives already read, by id.
   *
   * A card asks for several pictures at once and each would otherwise reread
   * and reparse the whole zip. Held by id rather than by path because the
   * index is what says which file an id means, and that can change under us
   * between one build and the next.
   */
  private readonly opened = new Map<string, ZipArchive>();

  constructor(private readonly root: string = defaultSourceRoot()) {}

  async list(): Promise<readonly PluginListing[]> {
    const index = await this.readIndex();
    if (!index) return [];

    return index.plugins.filter(isListing);
  }

  async download(id: string): Promise<Uint8Array | undefined> {
    const listing = (await this.readIndex())?.plugins.find((entry) => entry?.id === id);
    if (!listing?.file) return undefined;

    return this.readInside(listing.file);
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

  private async open(id: string): Promise<ZipArchive | undefined> {
    const kept = this.opened.get(id);
    if (kept) return kept;

    const bytes = await this.download(id);
    if (!bytes) return undefined;

    const archive = new ZipArchive(Buffer.from(bytes));
    this.opened.set(id, archive);
    return archive;
  }

  /** Forgets what was read, for a store that has just been told to look again. */
  refresh(): void {
    this.opened.clear();
  }

  private async readIndex(): Promise<RawIndex | undefined> {
    const bytes = await this.readInside(join('registry', 'index.json'));
    if (!bytes) return undefined;

    try {
      const parsed = JSON.parse(Buffer.from(bytes).toString('utf8')) as RawIndex;
      return Array.isArray(parsed?.plugins) ? parsed : undefined;
    } catch {
      // A half-written index during a rebuild is the ordinary way to see this,
      // and an empty store beats a store that refuses to open.
      return undefined;
    }
  }

  /**
   * Reads a file the index named, and only from inside the source.
   *
   * The index is a file on disk that a build wrote, but it is also the one
   * place a name comes from — and a name is exactly the thing that should
   * never be able to say `../../../.ssh/id_rsa`.
   */
  private async readInside(relative: string): Promise<Uint8Array | undefined> {
    if (isAbsolute(relative)) return undefined;

    const inside = resolve(this.root) + sep;
    const target = resolve(this.root, 'build', relative);
    const registry = resolve(this.root, relative);

    for (const path of [target, registry]) {
      if (!path.startsWith(inside)) continue;
      try {
        return await readFile(path);
      } catch {
        continue;
      }
    }

    return undefined;
  }
}

/**
 * Where to look when nobody said.
 *
 * `EASYDECK_PLUGIN_SOURCE` first, so this can be pointed anywhere; otherwise
 * a folder beside the working directory, which is where the plugins
 * repository sits while there is no GitHub to fetch from. Both are temporary
 * by design — the day a remote source exists, the default becomes it and this
 * stays for whoever is developing a plugin.
 */
export function defaultSourceRoot(): string {
  const named = process.env['EASYDECK_PLUGIN_SOURCE'];
  if (named && named.length > 0) return named;

  return resolve(process.cwd(), '..', DEFAULT_PLUGIN_SOURCE);
}

interface RawIndex {
  readonly plugins: (Partial<PluginListing> & { file?: string })[];
}

/** An index entry with everything a store needs, and nothing assumed. */
function isListing(entry: Partial<PluginListing> & { file?: string }): entry is PluginListing {
  return (
    typeof entry?.id === 'string' &&
    typeof entry.version === 'string' &&
    typeof entry.sha256 === 'string' &&
    typeof entry.apiVersion === 'number' &&
    typeof (entry.manifest as PluginManifest | undefined)?.name === 'object'
  );
}

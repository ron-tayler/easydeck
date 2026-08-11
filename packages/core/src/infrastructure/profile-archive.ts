import { createHash } from 'node:crypto';

import type { ProfileDefinition } from '@easydeck/engine';

import { migrateProfile } from './migrate-profile.js';
import { ZipArchive } from './zip.js';
import { writeZip } from './zip-writer.js';
import type { ZipFile } from './zip-writer.js';

/**
 * A profile as one file you can send somebody.
 *
 * A profile stores its pictures inside itself, as data URLs, because it is one
 * JSON document. That is fine until it is not: a deck with a few animations
 * turns into nine megabytes of base64, where the same icon on five keys is
 * stored five times and nothing can be read by eye.
 *
 * So an export takes the pictures out. The document keeps `asset:<hash>` where
 * a data URL was, the pictures become files beside it, and identical ones
 * collapse into a single entry — which is most of the saving, since a deck is
 * built out of a handful of pictures used many times.
 *
 * An import puts them back. Nothing else in the program has to learn about
 * archives: what comes out of one is an ordinary profile with data URLs, the
 * only shape anything downstream has ever seen.
 */

const MANIFEST = 'profile.json';
const ASSETS = 'assets/';

/** `data:image/png;base64,…` split into what we need to file it. */
const DATA_URL = /^data:([^;,]+)(;base64)?,(.*)$/s;

/** What a content type is called on disk, for the few we actually store. */
const EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

/** Already compressed; deflating them again costs time and saves nothing. */
const OPAQUE = new Set(['png', 'jpg', 'gif', 'webp']);

export function exportProfile(profile: ProfileDefinition): Uint8Array {
  const assets = new Map<string, ZipFile>();

  const document = rewrite(profile, (source) => {
    const filed = file(source);
    if (!filed) return source;

    if (!assets.has(filed.name)) assets.set(filed.name, filed.entry);
    return `asset:${filed.id}`;
  });

  // Without its id, exactly as the folder on disk stores it: an archive is
  // opened on somebody else's machine, where which folder it used to sit in is
  // not a fact worth carrying.
  const { id: _filedAs, ...stored } = document;

  return writeZip([
    { name: MANIFEST, bytes: Buffer.from(`${JSON.stringify(stored, null, 2)}\n`, 'utf8') },
    // Sorted, so the same profile always exports to the same bytes: an export
    // is often compared with the last one to answer "did anything change?".
    ...[...assets.values()].sort((a, b) => a.name.localeCompare(b.name)),
  ]);
}

export function importProfile(bytes: Uint8Array): ProfileDefinition {
  const archive = new ZipArchive(Buffer.from(bytes));

  const manifest = archive.read(MANIFEST);
  if (!manifest) throw new Error('This archive has no profile.json in it');

  const stored = JSON.parse(manifest.toString('utf8')) as unknown;

  const document = rewrite(stored as ProfileDefinition, (source) => {
    if (!source.startsWith('asset:')) return source;

    const id = source.slice('asset:'.length);
    const name = archive.names().find((each) => each.startsWith(`${ASSETS}${id}.`));
    const found = name ? archive.read(name) : undefined;

    // A picture the archive does not carry: the key keeps the reference, so
    // what is missing is nameable rather than silently blank.
    if (!found || !name) return source;

    const extension = name.slice(name.lastIndexOf('.') + 1);
    const type =
      Object.entries(EXTENSIONS).find(([, each]) => each === extension)?.[0] ?? 'application/octet-stream';

    return `data:${type};base64,${found.toString('base64')}`;
  });

  // Through the same migration as a profile read off disk: an archive may have
  // been exported by an older version, and an import is exactly when that has
  // to be dealt with. The id is dropped along with it — an archive made before
  // this may still carry one, and it names a folder on a machine that is not
  // this one.
  return { ...migrateProfile(document), id: '' };
}

/** Turns a data URL into an entry, or reports that it is not one. */
function file(source: string): { id: string; name: string; entry: ZipFile } | undefined {
  const match = DATA_URL.exec(source);
  if (!match) return undefined;

  const [, contentType, base64, payload] = match;
  const bytes = base64
    ? Buffer.from(payload!, 'base64')
    : Buffer.from(decodeURIComponent(payload!), 'utf8');

  // Named by content, so the same picture used on twenty keys is one file and
  // the archive says so plainly.
  const id = createHash('sha1').update(bytes).digest('hex').slice(0, 16);
  const extension = EXTENSIONS[contentType!] ?? 'bin';
  const name = `${ASSETS}${id}.${extension}`;

  return {
    id,
    name,
    entry: { name, bytes, ...(OPAQUE.has(extension) ? { compress: false } : {}) },
  };
}

/**
 * Walks the document and rewrites every picture it finds.
 *
 * By key name rather than by knowing the shape of a profile: `source` is what
 * a picture is called wherever one appears — an icon, a backdrop, whatever a
 * later version adds — and a walker that had to be taught each place would
 * quietly miss the next one.
 */
function rewrite<T>(value: T, map: (source: string) => string): T {
  if (Array.isArray(value)) return value.map((item) => rewrite(item, map)) as unknown as T;
  if (typeof value !== 'object' || value === null) return value;

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = key === 'source' && typeof item === 'string' ? map(item) : rewrite(item, map);
  }

  return out as T;
}

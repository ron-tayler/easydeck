import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { ProfileDefinition } from '@easydeck/engine';

/**
 * A profile's pictures, kept beside it rather than inside it.
 *
 * A profile is one document, and a picture inside a document has to be text —
 * so every icon was a data URL, base64 costing a third more than the bytes it
 * carries, and the same picture on five keys stored five times over. A deck
 * with a couple of animations came to nine megabytes of it, which is a file
 * nobody can read and a saving operation nobody wants to repeat on every
 * keystroke.
 *
 * So a profile is a folder now: the document, and an `assets` folder of
 * pictures named after their own contents. Two keys with the same icon point
 * at one file. Nothing else in the program learns about this — what `load`
 * returns is the same profile with data URLs it always returned, because that
 * is the shape the engine, the renderer and every client already speak.
 */

const ASSETS = 'assets';
const DOCUMENT = 'profile.json';

const DATA_URL = /^data:([^;,]+)(;base64)?,(.*)$/s;

const EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

const TYPES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(EXTENSIONS).map(([type, extension]) => [extension, type]),
);

/**
 * A profile as it is stored, which is everything but its identity.
 *
 * The folder's name is the id — kept in one place rather than two, so
 * renaming the folder cannot leave the document disagreeing with it.
 */
export type ProfileDocument = Omit<ProfileDefinition, 'id'>;

export interface ProfileFolder {
  /** The document, with `asset:<id>` where pictures were. */
  readonly document: ProfileDefinition;
  /** Every picture it refers to, by file name. */
  readonly assets: ReadonlyMap<string, Uint8Array>;
}

/** Splits a profile into a document and its pictures. */
export function extractAssets(profile: ProfileDefinition): ProfileFolder {
  const assets = new Map<string, Uint8Array>();

  const document = rewrite(profile, (source) => {
    const match = DATA_URL.exec(source);
    if (!match) return source;

    const [, contentType, base64, payload] = match;
    const bytes = base64
      ? Buffer.from(payload!, 'base64')
      : Buffer.from(decodeURIComponent(payload!), 'utf8');

    const id = createHash('sha1').update(bytes).digest('hex').slice(0, 16);
    const name = `${id}.${EXTENSIONS[contentType!] ?? 'bin'}`;

    assets.set(name, bytes);
    return `asset:${id}`;
  });

  return { document, assets };
}

/**
 * Puts the pictures back, so callers see the profile they always have.
 *
 * A reference the folder cannot satisfy is left alone rather than blanked:
 * `asset:9f8b…` on a key says which picture is missing, where an empty string
 * would only say that something is.
 */
export function inlineAssets<T>(document: T, names: readonly string[], read: (name: string) => Uint8Array | undefined): T {
  return rewrite(document, (source) => {
    if (!source.startsWith('asset:')) return source;

    const id = source.slice('asset:'.length);
    const name = names.find((each) => each.startsWith(`${id}.`));
    const bytes = name ? read(name) : undefined;
    if (!name || !bytes) return source;

    const extension = name.slice(name.lastIndexOf('.') + 1);
    const type = TYPES[extension] ?? 'application/octet-stream';

    return `data:${type};base64,${Buffer.from(bytes).toString('base64')}`;
  });
}

/** Reads a profile folder off disk, pictures included. */
export async function readProfileFolder(folder: string): Promise<ProfileDocument> {
  const document = JSON.parse(await readFile(join(folder, DOCUMENT), 'utf8')) as ProfileDocument;

  let names: string[] = [];
  try {
    names = await readdir(join(folder, ASSETS));
  } catch {
    // A profile with no pictures has no folder for them, which is ordinary.
  }

  const bytes = new Map<string, Uint8Array>();
  for (const name of names) {
    try {
      bytes.set(name, await readFile(join(folder, ASSETS, name)));
    } catch {
      // A picture that cannot be read leaves its reference in place, which
      // names it on the key rather than blanking it.
    }
  }

  return inlineAssets(document, names, (name) => bytes.get(name));
}

/**
 * Writes one, and takes away what it no longer refers to.
 *
 * Sweeping on save rather than never: a picture replaced on a key would
 * otherwise stay in the folder for ever, and a profile whose folder grows
 * without bound is the reason people stop trusting a program with their
 * files.
 */
export async function writeProfileFolder(folder: string, profile: ProfileDefinition): Promise<void> {
  const { document, assets } = extractAssets(profile);

  await mkdir(join(folder, ASSETS), { recursive: true });

  for (const [name, bytes] of assets) {
    const target = join(folder, ASSETS, name);

    // Named by content, so a file that is already there is already right.
    try {
      await readFile(target);
      continue;
    } catch {
      await writeFile(target, bytes);
    }
  }

  let existing: string[] = [];
  try {
    existing = await readdir(join(folder, ASSETS));
  } catch {
    existing = [];
  }
  for (const name of existing) {
    if (!assets.has(name)) await rm(join(folder, ASSETS, name), { force: true });
  }

  // The folder's own name is the profile's identity, so writing an id into the
  // document would be storing the same fact twice — and the copy inside is the
  // one that goes stale the moment somebody renames the folder.
  const { id: _filedAs, ...stored } = document;

  // Beside the target and renamed over it: a crash mid-write must not leave a
  // half-written document where a profile used to be.
  const target = join(folder, DOCUMENT);
  const temporary = `${target}.tmp`;
  await writeFile(temporary, `${JSON.stringify(stored, null, 2)}\n`, 'utf8');
  await rename(temporary, target);
}

/**
 * Walks the document and rewrites every picture it finds.
 *
 * By key name rather than by knowing the shape of a profile: `source` is what
 * a picture is called wherever one appears, and a walker taught each place
 * would quietly miss the next one somebody adds.
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

import { readFile, stat } from 'node:fs/promises';
import { extname, posix } from 'node:path';

import { ZipArchive } from './zip.js';

/**
 * An icon pack, read where it lies.
 *
 * Stream Deck's `.streamDeckIconPack` is a ZIP holding a `manifest.json` (who
 * made it, what it is called), an `icons.json` (a name and tags per picture)
 * and a folder of SVGs. Reading it in place rather than unpacking is what
 * makes the pack behave like a folder: one file to drop in, one file to
 * delete, and nothing left behind when it is gone.
 *
 * Only the format's icon side is understood, which is all it is being asked
 * for. A Stream Deck *plugin* is a different thing — code, actions, property
 * inspectors — and none of that is read here.
 */

export interface PackedIcon {
  readonly name: string;
  readonly source: string;
  readonly bytes: number;
}

export interface IconPack {
  /** What the pack calls itself, used as the folder it appears under. */
  readonly name: string;
  readonly images: readonly PackedIcon[];
}

/** Recognised by extension, since that is what the file is handed out as. */
const PACK_EXTENSIONS = new Set(['.streamdeckiconpack', '.sdiconpack']);

const TYPES: Readonly<Record<string, string>> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
};

/** Large enough for any icon pack, small enough not to be a way in. */
const MAX_PACK_BYTES = 64 * 1024 * 1024;

/**
 * Reads a pack, or returns undefined when the file is not one.
 *
 * `limit` is what is left of the library's own cap: a folder holding several
 * packs must not be able to spend it all on the first.
 */
export async function readIconPack(file: string, limit: number): Promise<IconPack | undefined> {
  if (!PACK_EXTENSIONS.has(extname(file).toLowerCase())) return undefined;
  if (limit <= 0) return undefined;

  try {
    const info = await stat(file);
    if (!info.isFile() || info.size > MAX_PACK_BYTES) return undefined;
  } catch {
    return undefined;
  }

  let archive: ZipArchive;
  try {
    archive = new ZipArchive(await readFile(file));
  } catch {
    // Not a readable archive is the same answer as not a pack: the file stays
    // where it is and the rest of the library is unaffected.
    return undefined;
  }

  const manifest = findEntry(archive, 'manifest.json');
  if (!manifest) return undefined;

  const root = manifest.slice(0, manifest.length - 'manifest.json'.length);
  const name = packName(archive.readText(manifest), file);
  const listed = readIconList(archive, `${root}icons.json`);

  /*
   * The pictures live under `icons/`, and the two files beside it — the pack's
   * own badge and its store cover — are not icons anyone wants on a key. A
   * pack without that folder is read whole, since then there is nothing else
   * it could mean.
   */
  const inner = archive.names().some((entry) => entry.startsWith(`${root}icons/`))
    ? `${root}icons/`
    : root;

  const images: PackedIcon[] = [];

  for (const entry of archive.names()) {
    if (images.length >= limit) break;
    if (!entry.startsWith(inner) || entry.endsWith('/')) continue;

    const type = TYPES[extname(entry).toLowerCase()];
    if (!type) continue;

    const bytes = archive.read(entry);
    if (!bytes) continue;

    const path = entry.slice(root.length);
    images.push({
      // The pack's own name for the picture where it gives one: `icons.json`
      // says "add-user" where the file says "add-user.svg", and a few packs
      // name them differently altogether.
      name: listed.get(path) ?? basename(path),
      source: `data:${type};base64,${bytes.toString('base64')}`,
      bytes: bytes.byteLength,
    });
  }

  if (images.length === 0) return undefined;

  images.sort((a, b) => a.name.localeCompare(b.name));
  return { name, images };
}

/** The first entry with this name, at whatever depth the pack nests it. */
function findEntry(archive: ZipArchive, name: string): string | undefined {
  return archive.names().find((entry) => entry === name || entry.endsWith(`/${name}`));
}

/**
 * `icons.json` maps a path inside the pack to the name shown under it.
 *
 * Absent or malformed, the filename is used instead — a pack missing its
 * index is still a folder full of pictures.
 */
function readIconList(archive: ZipArchive, path: string): Map<string, string> {
  const names = new Map<string, string>();
  const text = archive.readText(path);
  if (!text) return names;

  try {
    const listed = JSON.parse(text) as { path?: unknown; name?: unknown }[];
    if (!Array.isArray(listed)) return names;

    for (const item of listed) {
      if (typeof item?.path !== 'string' || typeof item?.name !== 'string') continue;
      // Paths in the index are relative to the icons folder, and the entries
      // are relative to the pack root.
      names.set(posix.join('icons', item.path), item.name);
      names.set(item.path, item.name);
    }
  } catch {
    return new Map();
  }

  return names;
}

function packName(manifest: string | undefined, file: string): string {
  const fallback = basename(file.replace(/\\/g, '/'));

  if (!manifest) return fallback;
  try {
    const parsed = JSON.parse(manifest) as { Name?: unknown; Author?: unknown };
    const name = typeof parsed.Name === 'string' ? parsed.Name.trim() : '';
    // A name becomes a folder in the picker's tree, so it must not contain
    // separators of its own.
    return name ? name.replace(/[\\/]+/g, ' ') : fallback;
  } catch {
    return fallback;
  }
}

function basename(path: string): string {
  const last = path.slice(path.lastIndexOf('/') + 1);
  const dot = last.lastIndexOf('.');
  return dot > 0 ? last.slice(0, dot) : last;
}

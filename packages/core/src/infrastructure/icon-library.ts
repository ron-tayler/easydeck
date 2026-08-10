import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, join, posix } from 'node:path';

import { readIconPack } from './icon-pack.js';

/**
 * The user's own icon folder, read as data URLs.
 *
 * Data URLs rather than paths because the configurator may be a browser on
 * another machine talking over the WebSocket API, which can no more read this
 * folder than it can read any other. Sending the bytes is the only answer that
 * works for both transports, and it keeps the picker's two sources — built-in
 * and user — identical from the UI's point of view.
 *
 * Subfolders are kept rather than flattened. A collection arrives organised —
 * by who drew it, by what it is for — and throwing that away leaves one heap
 * of several hundred pictures with nothing but a filename to sort it by. The
 * path is reported as the group, and the picker builds its tree from that.
 */

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

const TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  // Icon packs are drawn as vectors, and the browser scales them for free.
  '.svg': 'image/svg+xml',
};

/**
 * Caps, because this folder belongs to the user and nothing stops them putting
 * a wallpaper collection in it. Both are generous for icons and firm enough
 * that the picker cannot be made to stall.
 */
const MAX_FILE_BYTES = 2_000_000;
const MAX_FILES = 4000;
/**
 * How deep the walk goes.
 *
 * Deep enough for the way collections are actually laid out — author, then
 * pack, then category — and shallow enough that a symlink loop or a stray
 * `node_modules` cannot turn the picker into a filesystem crawl.
 */
const MAX_DEPTH = 4;

export async function listLibraryImages(directory: string): Promise<LibraryImage[]> {
  const images: LibraryImage[] = [];
  await walk(directory, '', 0, images);

  // Grouped first, then by name: a picker showing them in this order needs no
  // sorting of its own, and the same folder never appears twice.
  images.sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
  return images;
}

async function walk(
  directory: string,
  group: string,
  depth: number,
  images: LibraryImage[],
): Promise<void> {
  if (depth > MAX_DEPTH || images.length >= MAX_FILES) return;

  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch {
    // Absent is the normal state until someone opens the folder for the first
    // time; an empty library is the honest answer, not an error.
    return;
  }

  for (const entry of entries.sort((a, b) => a.localeCompare(b))) {
    if (images.length >= MAX_FILES) return;

    const file = join(directory, entry);
    let info;
    try {
      info = await stat(file);
    } catch {
      continue;
    }

    if (info.isDirectory()) {
      await walk(file, group ? posix.join(group, entry) : entry, depth + 1, images);
      continue;
    }

    if (!info.isFile()) continue;

    // A pack is a folder that happens to be one file, and reads as one.
    const pack = await readIconPack(file, MAX_FILES - images.length);
    if (pack) {
      for (const image of pack.images) {
        images.push({ ...image, group: group ? posix.join(group, pack.name) : pack.name });
      }
      continue;
    }

    const type = TYPES[extname(entry).toLowerCase()];
    if (!type || info.size > MAX_FILE_BYTES) continue;

    try {
      const bytes = await readFile(file);
      images.push({
        name: entry.slice(0, entry.length - extname(entry).length),
        source: `data:${type};base64,${bytes.toString('base64')}`,
        bytes: info.size,
        group,
      });
    } catch {
      // One unreadable file must not cost the user the rest of their library.
      continue;
    }
  }
}

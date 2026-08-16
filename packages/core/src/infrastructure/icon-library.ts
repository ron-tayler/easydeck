import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, join, posix } from 'node:path';

import type { LibraryImage } from '@easydeck/protocol';

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
 * a wallpaper collection in it.
 *
 * The per-file limit is sized for animation rather than for icons: a GIF worth
 * putting on a key is routinely several megabytes, and the old two-megabyte
 * cap silently left exactly those out — the picture was in the folder, missing
 * from the picker, with nothing said about why.
 *
 * The budget is what keeps that from costing anything: the whole library
 * travels as one answer, so a folder holding a dozen large animations would
 * otherwise be a hundred megabytes crossing a socket at once. What is left out
 * is reported rather than dropped in silence.
 */
const MAX_FILE_BYTES = 12_000_000;
const MAX_FILES = 4000;
const MAX_TOTAL_BYTES = 96_000_000;
/**
 * How deep the walk goes.
 *
 * Deep enough for the way collections are actually laid out — author, then
 * pack, then category — and shallow enough that a symlink loop or a stray
 * `node_modules` cannot turn the picker into a filesystem crawl.
 */
const MAX_DEPTH = 4;

export interface Library {
  readonly images: readonly LibraryImage[];
  /** Pictures found but left out, for want of room. */
  readonly omitted: number;
}

export async function listLibraryImages(directory: string): Promise<LibraryImage[]> {
  return (await readLibrary(directory)).images as LibraryImage[];
}

export async function readLibrary(directory: string): Promise<Library> {
  const images: LibraryImage[] = [];
  const budget = { left: MAX_TOTAL_BYTES, omitted: 0 };
  await walk(directory, '', 0, images, budget);

  // Grouped first, then by name: a picker showing them in this order needs no
  // sorting of its own, and the same folder never appears twice.
  images.sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
  return { images, omitted: budget.omitted };
}

/** What is left of the library's room, and what has been turned away. */
interface Budget {
  left: number;
  omitted: number;
}

async function walk(
  directory: string,
  group: string,
  depth: number,
  images: LibraryImage[],
  budget: Budget,
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
      await walk(file, group ? posix.join(group, entry) : entry, depth + 1, images, budget);
      continue;
    }

    if (!info.isFile()) continue;

    // A pack is a folder that happens to be one file, and reads as one.
    const pack = await readIconPack(file, MAX_FILES - images.length);
    if (pack) {
      for (const image of pack.images) {
        if (image.bytes > budget.left) {
          budget.omitted++;
          continue;
        }

        budget.left -= image.bytes;
        images.push({ ...image, group: group ? posix.join(group, pack.name) : pack.name });
      }
      continue;
    }

    const type = TYPES[extname(entry).toLowerCase()];
    if (!type) continue;

    if (info.size > MAX_FILE_BYTES || info.size > budget.left) {
      budget.omitted++;
      continue;
    }

    try {
      const bytes = await readFile(file);
      budget.left -= info.size;
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

// Re-exported so nothing that already imports it from here has to move.
export type { LibraryImage };

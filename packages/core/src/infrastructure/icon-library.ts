import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';

/**
 * The user's own icon folder, read as data URLs.
 *
 * Data URLs rather than paths because the configurator may be a browser on
 * another machine talking over the WebSocket API, which can no more read this
 * folder than it can read any other. Sending the bytes is the only answer that
 * works for both transports, and it keeps the picker's two sources — built-in
 * and user — identical from the UI's point of view.
 */

export interface LibraryImage {
  /** File name without its extension: what the user sees under the picture. */
  readonly name: string;
  readonly source: string;
  readonly bytes: number;
}

const TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
};

/**
 * Caps, because this folder belongs to the user and nothing stops them putting
 * a wallpaper collection in it. Both are generous for icons and firm enough
 * that the picker cannot be made to stall.
 */
const MAX_FILE_BYTES = 2_000_000;
const MAX_FILES = 500;

export async function listLibraryImages(directory: string): Promise<LibraryImage[]> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch {
    // Absent is the normal state until someone opens the folder for the first
    // time; an empty library is the honest answer, not an error.
    return [];
  }

  const images: LibraryImage[] = [];

  for (const entry of entries.sort((a, b) => a.localeCompare(b))) {
    if (images.length >= MAX_FILES) break;

    const type = TYPES[extname(entry).toLowerCase()];
    if (!type) continue;

    const file = join(directory, entry);
    try {
      const info = await stat(file);
      if (!info.isFile() || info.size > MAX_FILE_BYTES) continue;

      const bytes = await readFile(file);
      images.push({
        name: entry.slice(0, entry.length - extname(entry).length),
        source: `data:${type};base64,${bytes.toString('base64')}`,
        bytes: info.size,
      });
    } catch {
      // One unreadable file must not cost the user the rest of their library.
      continue;
    }
  }

  return images;
}

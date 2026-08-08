import { readFile } from 'node:fs/promises';

/**
 * A picture source as bytes, whatever form it arrived in.
 *
 * Returns undefined rather than throwing when a path cannot be read: whoever
 * tries to draw it will fail on the same source with a message about the
 * picture itself, which is the more useful error of the two.
 */
export async function readSource(source: string | Uint8Array): Promise<Uint8Array | undefined> {
  if (typeof source !== 'string') return source;

  if (source.startsWith('data:')) {
    const comma = source.indexOf(',');
    if (comma === -1 || !source.slice(0, comma).includes(';base64')) return undefined;
    return Buffer.from(source.slice(comma + 1), 'base64');
  }

  try {
    return await readFile(source);
  } catch {
    return undefined;
  }
}

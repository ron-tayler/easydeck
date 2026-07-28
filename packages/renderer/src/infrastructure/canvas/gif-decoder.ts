import { readFile } from 'node:fs/promises';

import type { AnimationDecoder, AnimationFrame } from '../../application/ports/animation-decoder.js';
import { decodeGif, frameToCanvas, isGif } from './gif-frames.js';

/**
 * Reads GIFs, and says "not an animation" about everything else.
 *
 * Frames come back as PNG data URLs so the rasterizer needs no new entry
 * point: it already knows how to draw an icon from a source string, and a
 * frame is just another picture. The extra encode costs a little, but it
 * happens once when a profile loads rather than while anything is playing.
 */
export class GifAnimationDecoder implements AnimationDecoder {
  /**
   * Decoded frames, kept by source.
   *
   * The case this exists for: a picture stretched over six keys asks six times
   * for the *same* GIF, once per slice. Each ask decodes every frame and
   * re-encodes it as a PNG, so without this the work is done six times over
   * and the panel visibly stalls when the page opens.
   *
   * Small on purpose — one entry is every frame of a GIF, which is megabytes.
   */
  private readonly cache = new Map<string, readonly AnimationFrame[] | null>();
  private static readonly LIMIT = 8;

  async decode(source: Uint8Array | string): Promise<readonly AnimationFrame[] | undefined> {
    // Only string sources are cached: raw bytes have no cheap identity, and
    // hashing them would cost what the cache is meant to save.
    const cacheKey = typeof source === 'string' ? source : undefined;
    if (cacheKey !== undefined && this.cache.has(cacheKey)) {
      const hit = this.cache.get(cacheKey)!;
      this.cache.delete(cacheKey);
      this.cache.set(cacheKey, hit);
      return hit ?? undefined;
    }

    const bytes = await readSource(source);
    const decoded = bytes && isGif(bytes) ? await this.toFrames(bytes) : undefined;

    if (cacheKey !== undefined) {
      this.cache.set(cacheKey, decoded ?? null);
      while (this.cache.size > GifAnimationDecoder.LIMIT) {
        const oldest = this.cache.keys().next().value;
        if (oldest === undefined) break;
        this.cache.delete(oldest);
      }
    }

    return decoded;
  }

  /**
   * Encodes the frames, yielding to the event loop between them.
   *
   * Encoding is synchronous and CPU-bound, so a long GIF would otherwise hold
   * the thread for its whole duration — and everything the deck was in the
   * middle of writing would wait behind it. Handing control back between
   * frames costs a little throughput and buys a panel that keeps responding
   * while a scene loads.
   */
  private async toFrames(bytes: Uint8Array): Promise<readonly AnimationFrame[]> {
    const gif = decodeGif(bytes);
    const frames: AnimationFrame[] = [];

    for (const frame of gif.frames) {
      frames.push({
        image: `data:image/png;base64,${frameToCanvas(frame, gif.width, gif.height)
          .toBuffer('image/png')
          .toString('base64')}`,
        delayMs: frame.delayMs,
      });
      await new Promise((resolve) => setImmediate(resolve));
    }

    return frames;
  }
}

async function readSource(source: Uint8Array | string): Promise<Uint8Array | undefined> {
  if (typeof source !== 'string') return source;

  if (source.startsWith('data:')) {
    const comma = source.indexOf(',');
    if (comma === -1 || !source.slice(0, comma).includes(';base64')) return undefined;
    return Buffer.from(source.slice(comma + 1), 'base64');
  }

  // A path on disk: an icon may still be referenced rather than embedded.
  try {
    return await readFile(source);
  } catch {
    // Not readable is not the decoder's problem to report — the rasterizer
    // will fail on the same source with a message about the picture itself.
    return undefined;
  }
}

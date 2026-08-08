/**
 * A short, stable name for a list of strings.
 *
 * Used where a cache key would otherwise be the concatenation of every tile
 * key in a region — a couple of kilobytes, rebuilt and compared on every
 * frame. Sixty-four bits of FNV-1a, as two independent thirty-two bit passes:
 * one pass would leave a collision plausible enough to matter, and a collision
 * here means showing the wrong picture, not merely missing the cache.
 */

const OFFSET_A = 0x811c9dc5;
const OFFSET_B = 0x01000193;
const PRIME = 0x01000193;

export function digest(parts: readonly string[]): string {
  let a = OFFSET_A;
  let b = OFFSET_B;

  for (const part of parts) {
    for (let index = 0; index < part.length; index++) {
      const code = part.charCodeAt(index);
      a = Math.imul(a ^ code, PRIME);
      // The second pass walks the same characters with a different mixing
      // order, so the two halves do not fail together.
      b = Math.imul(b ^ (code + index), PRIME) ^ (b >>> 7);
    }
    // Fed into the hash so that ['ab','c'] and ['a','bc'] cannot agree.
    a = Math.imul(a ^ 0x1f, PRIME);
    b = Math.imul(b ^ 0x1f, PRIME);
  }

  return ((a >>> 0).toString(36) + (b >>> 0).toString(36)).padStart(2, '0');
}

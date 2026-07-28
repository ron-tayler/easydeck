import type { AnimatedFrame } from './ports/renderer-port.js';

/**
 * Plays animated keys by streaming stills, because that is all the panel can
 * do — a USB capture of the vendor software shows it doing exactly this, with
 * nothing cached on the device.
 *
 * Two decisions shape everything here.
 *
 * The frame to show is computed **from the clock**, never by stepping an
 * index. If a write takes too long, or fifteen keys ask at once, the animation
 * skips ahead instead of falling behind: a late frame is worth less than the
 * right one, and stepping would let the queue grow without bound.
 *
 * Frames arrive already encoded. Compressing while playing is what makes the
 * vendor software stutter on its first pass through a GIF.
 */

export interface Animation {
  readonly frames: readonly AnimatedFrame[];
  /** Cumulative end time of each frame, so a clock reading maps to an index. */
  readonly offsets: readonly number[];
  readonly duration: number;
  /** Which frame is on the key now; -1 until the first one is written. */
  shown: number;
  /** When this animation started, on the same clock as `now`. */
  startedAt: number;
}

export function prepare(frames: readonly AnimatedFrame[], now: number): Animation {
  const offsets: number[] = [];
  let total = 0;
  for (const frame of frames) {
    total += frame.delayMs;
    offsets.push(total);
  }

  return { frames, offsets, duration: total, shown: -1, startedAt: now };
}

/**
 * The frame that should be on screen at `now`.
 *
 * Loops forever: a GIF's own loop count is deliberately ignored. On a deck a
 * key that animates once and then freezes reads as a bug, and there is no way
 * to ask for it to start again.
 */
export function frameAt(animation: Animation, now: number): number {
  if (animation.duration <= 0) return 0;

  const elapsed = (now - animation.startedAt) % animation.duration;
  // Small enough to scan: a GIF with thousands of frames would not fit a key
  // image budget anyway, and a binary search here would earn nothing.
  for (let index = 0; index < animation.offsets.length; index++) {
    if (elapsed < animation.offsets[index]!) return index;
  }
  return animation.offsets.length - 1;
}

/** How long until this animation wants a different frame. */
export function nextChangeMs(animation: Animation, now: number): number {
  if (animation.duration <= 0) return Number.POSITIVE_INFINITY;

  const elapsed = (now - animation.startedAt) % animation.duration;
  for (const offset of animation.offsets) {
    if (elapsed < offset) return offset - elapsed;
  }
  return animation.duration - elapsed;
}

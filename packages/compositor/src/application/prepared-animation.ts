/**
 * An animation as the panel needs it: encoded tiles, per frame, per key.
 *
 * Two decisions from the old engine survive here because they were right, and
 * a third is new.
 *
 * Frames are encoded up front rather than while playing — a capture of the
 * vendor software shows its first pass through a GIF stuttering precisely
 * because it compresses as it goes, with only the second loop running smoothly
 * off its own cache.
 *
 * The frame to show is computed **from the clock**, never by stepping an
 * index. A late frame is worth less than the right one, and stepping lets the
 * queue grow without bound when writes take longer than the delays ask for.
 *
 * What is new is that one region has one timeline. Fifteen keys of a stretched
 * picture used to hold fifteen animations that had to be started at the same
 * instant to stay together; now there is one, and being in step is structural
 * rather than something to keep arranging.
 */
export interface PreparedAnimation {
  /** Panel keys this animation drives, in cell order. */
  readonly keys: readonly number[];
  /** Scene identity of each cell, for skipping writes and planning scenes. */
  readonly tileKeys: readonly string[];
  readonly delaysMs: readonly number[];
  /** Cumulative end time of each frame, so a clock reading maps to an index. */
  readonly offsets: readonly number[];
  /** frames[frame][cell]; undefined until that frame has been prepared. */
  readonly frames: (readonly Uint8Array[] | undefined)[];
  /** How many frames from the start are ready. Grows as work completes. */
  ready: number;
  bytes: number;
}

export function prepareAnimation(
  keys: readonly number[],
  tileKeys: readonly string[],
  delaysMs: readonly number[],
): PreparedAnimation {
  const offsets: number[] = [];
  let total = 0;
  for (const delay of delaysMs) {
    total += delay;
    offsets.push(total);
  }

  return {
    keys,
    tileKeys,
    delaysMs,
    offsets,
    frames: new Array<readonly Uint8Array[] | undefined>(delaysMs.length),
    ready: 0,
    bytes: 0,
  };
}

/**
 * The frame that should be on screen at `now`.
 *
 * Loops forever over the frames prepared **so far**. Playing the ready prefix
 * rather than waiting for the whole animation is deliberate: a picture over
 * fifteen keys takes most of a second to encode in full, and standing still
 * for that long reads as a freeze. The cycle simply lengthens as more frames
 * arrive.
 *
 * A GIF's own loop count is ignored. On a deck a key that animates once and
 * then stops reads as a bug, and there is no way to ask it to start again.
 */
export function frameAt(animation: PreparedAnimation, startedAt: number, now: number): number {
  const ready = animation.ready;
  if (ready <= 1) return 0;

  const duration = animation.offsets[ready - 1]!;
  if (duration <= 0) return 0;

  const elapsed = (now - startedAt) % duration;
  for (let index = 0; index < ready; index++) {
    if (elapsed < animation.offsets[index]!) return index;
  }
  return ready - 1;
}

/** How long until this animation wants a different frame. */
export function nextChangeMs(
  animation: PreparedAnimation,
  startedAt: number,
  now: number,
): number {
  const ready = animation.ready;
  if (ready <= 1) return Number.POSITIVE_INFINITY;

  const duration = animation.offsets[ready - 1]!;
  if (duration <= 0) return Number.POSITIVE_INFINITY;

  const elapsed = (now - startedAt) % duration;
  for (let index = 0; index < ready; index++) {
    const offset = animation.offsets[index]!;
    if (elapsed < offset) return offset - elapsed;
  }
  return duration - elapsed;
}

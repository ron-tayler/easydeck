import { GifReader } from 'omggif';

import { RenderError } from '../../domain/render-target.js';

/**
 * A GIF read one frame at a time.
 *
 * The difference from `decodeGif` is memory, and it is not a small one: a 76
 * frame icon of 374x211 holds 23MB of RGBA if every frame is kept, and that is
 * a modest animated icon. Here exactly one frame exists at a time — the
 * running canvas the next frame is composed onto — because a GIF frame is
 * usually a *patch* over its predecessor, and replaying is cheaper than
 * storing.
 *
 * The price is that frames must be asked for in order. Going backwards means
 * replaying from the start, which the caller pays for only if it asks.
 */

/** Browsers clamp very short delays, and so do we: honouring a 0ms frame would
    spend the whole bus on one key. */
const MIN_DELAY_MS = 20;
const DEFAULT_DELAY_MS = 100;

/** GIF disposal method 2: restore the frame's area to the background. */
const DISPOSE_TO_BACKGROUND = 2;
/** Method 3: restore what was there before this frame. Rare but real. */
const DISPOSE_TO_PREVIOUS = 3;

export interface GifSequence {
  readonly width: number;
  readonly height: number;
  readonly frameCount: number;
  /** Every frame's duration, known without decoding any of them. */
  readonly delaysMs: readonly number[];
  /**
   * Composes frame `index` and returns the running canvas.
   *
   * The returned array is reused by the next call — draw from it before asking
   * for another frame, and never hold on to it.
   */
  frame(index: number): Uint8ClampedArray;
}

export function isGif(bytes: Uint8Array): boolean {
  return (
    bytes.length > 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  );
}

export function openGif(bytes: Uint8Array): GifSequence {
  let reader: GifReader;
  try {
    reader = new GifReader(bytes as Buffer);
  } catch (cause) {
    throw new RenderError('Could not read the GIF', { cause });
  }

  const width = reader.width;
  const height = reader.height;
  const frameCount = reader.numFrames();
  if (frameCount === 0) throw new RenderError('The GIF has no frames');

  const delaysMs: number[] = [];
  for (let index = 0; index < frameCount; index++) {
    const { delay } = reader.frameInfo(index);
    delaysMs.push(Math.max(MIN_DELAY_MS, delay > 0 ? delay * 10 : DEFAULT_DELAY_MS));
  }

  const canvas = new Uint8ClampedArray(width * height * 4);
  /** Frame the canvas is about to receive; -1 means nothing decoded yet. */
  let next = 0;
  let previous: Uint8ClampedArray | undefined;

  const step = (index: number): void => {
    const info = reader.frameInfo(index);
    previous = info.disposal === DISPOSE_TO_PREVIOUS ? new Uint8ClampedArray(canvas) : undefined;

    try {
      reader.decodeAndBlitFrameRGBA(index, canvas as unknown as number[]);
    } catch (cause) {
      throw new RenderError(`Could not decode GIF frame ${index}`, { cause });
    }
  };

  /** Applies the disposal of the frame that was just shown. */
  const dispose = (index: number): void => {
    const info = reader.frameInfo(index);
    if (info.disposal === DISPOSE_TO_BACKGROUND) {
      clearRect(canvas, width, info.x, info.y, info.width, info.height);
    } else if (previous) {
      canvas.set(previous);
    }
  };

  return {
    width,
    height,
    frameCount,
    delaysMs,

    frame(index: number): Uint8ClampedArray {
      if (index < 0 || index >= frameCount) {
        throw new RenderError(`Frame ${index} is outside this GIF (0..${frameCount - 1})`);
      }

      // Going backwards is a replay from the start: the canvas only ever moves
      // forward, so there is nothing to rewind to.
      if (index < next - 1) {
        canvas.fill(0);
        next = 0;
        previous = undefined;
      }

      // Already sitting on the wanted frame — a still asked for twice, or an
      // animation whose clock has not moved on yet.
      if (index === next - 1) return canvas;

      while (next <= index) {
        if (next > 0) dispose(next - 1);
        step(next);
        next++;
      }

      return canvas;
    },
  };
}

function clearRect(
  canvas: Uint8ClampedArray,
  stride: number,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  for (let row = y; row < y + height; row++) {
    const start = (row * stride + x) * 4;
    canvas.fill(0, start, start + width * 4);
  }
}

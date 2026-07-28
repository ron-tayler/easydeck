import { createCanvas, type Canvas } from '@napi-rs/canvas';
import { GifReader } from 'omggif';

import { RenderError } from '../../domain/render-target.js';

/**
 * Splits an animated GIF into finished frames.
 *
 * The deck has no notion of animation: a USB capture of the vendor software
 * shows it streaming one still image per frame, at up to 233 images a second
 * across fifteen keys, with nothing cached on the device. So animation here
 * means producing every frame up front and sending them in turn.
 *
 * Composition is done by hand rather than trusting the decoder's first frame,
 * because a GIF frame is usually a *patch*: it covers part of the canvas and
 * says what to do with the previous one. Ignoring that is what produces the
 * familiar smeared-trails bug.
 */

export interface GifFrame {
  readonly rgba: Uint8ClampedArray;
  /** How long this frame stays on screen. */
  readonly delayMs: number;
}

export interface DecodedGif {
  readonly width: number;
  readonly height: number;
  readonly frames: readonly GifFrame[];
}

/**
 * Browsers clamp very short delays, and so do we: a GIF asking for 0 or 10ms
 * is almost always authored carelessly, and honouring it would spend the
 * whole bus on one key.
 */
const MIN_DELAY_MS = 20;
const DEFAULT_DELAY_MS = 100;

/** GIF disposal method 2: restore the frame's area to the background. */
const DISPOSE_TO_BACKGROUND = 2;
/** Method 3: restore what was there before this frame. Rare but real. */
const DISPOSE_TO_PREVIOUS = 3;

export function isGif(bytes: Uint8Array): boolean {
  return (
    bytes.length > 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  );
}

export function decodeGif(bytes: Uint8Array): DecodedGif {
  let reader: GifReader;
  try {
    reader = new GifReader(bytes as Buffer);
  } catch (cause) {
    throw new RenderError('Could not read the GIF', { cause });
  }

  const width = reader.width;
  const height = reader.height;
  const frames: GifFrame[] = [];

  // The running canvas every frame is composed onto.
  const canvas = new Uint8ClampedArray(width * height * 4);

  for (let index = 0; index < reader.numFrames(); index++) {
    const info = reader.frameInfo(index);
    const before =
      info.disposal === DISPOSE_TO_PREVIOUS ? new Uint8ClampedArray(canvas) : undefined;

    try {
      reader.decodeAndBlitFrameRGBA(index, canvas as unknown as number[]);
    } catch (cause) {
      throw new RenderError(`Could not decode GIF frame ${index}`, { cause });
    }

    frames.push({
      rgba: new Uint8ClampedArray(canvas),
      // GIF delays are in hundredths of a second.
      delayMs: Math.max(MIN_DELAY_MS, info.delay > 0 ? info.delay * 10 : DEFAULT_DELAY_MS),
    });

    if (info.disposal === DISPOSE_TO_BACKGROUND) {
      clearRect(canvas, width, info.x, info.y, info.width, info.height);
    } else if (before) {
      canvas.set(before);
    }
  }

  if (frames.length === 0) throw new RenderError('The GIF has no frames');
  return { width, height, frames };
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

/** A frame as something the rasterizer can draw, since it takes images. */
export function frameToCanvas(frame: GifFrame, width: number, height: number): Canvas {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(width, height);
  image.data.set(frame.rgba);
  ctx.putImageData(image, 0, 0);
  return canvas;
}

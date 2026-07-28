import type { ButtonVisual } from '../domain/button-visual.js';
import { RenderError } from '../domain/render-target.js';
import type { RenderTarget } from '../domain/render-target.js';
import type { AnimationDecoder } from './ports/animation-decoder.js';
import type { JpegEncoder } from './ports/jpeg-encoder.js';
import type { Rasterizer } from './ports/rasterizer.js';

/** One frame of an animation, already encoded for the device. */
export interface RenderedFrame {
  readonly jpeg: Uint8Array;
  readonly delayMs: number;
}

const INITIAL_QUALITY = 90;
const MIN_QUALITY = 10;
const QUALITY_STEP = 10;

/**
 * Application service: ButtonVisual + RenderTarget -> device-ready JPEG.
 *
 * Quality fitting follows Companion's proven approach: start at 90% and step
 * down by 10 until the payload fits the device's byte limit.
 */
export class KeyRenderer {
  constructor(
    private readonly rasterizer: Rasterizer,
    private readonly encoder: JpegEncoder,
    private readonly animations?: AnimationDecoder,
  ) {}

  /**
   * Every frame of an animated visual, ready to send, or undefined when the
   * visual is an ordinary still.
   *
   * Encoded up front rather than while playing. A capture of the vendor
   * software shows exactly why: its first pass through a GIF stutters because
   * it is decoding and compressing as it goes, and only the second loop runs
   * smoothly, off its own cache. Paying that cost once at load makes the first
   * loop as smooth as the rest.
   */
  async renderFrames(
    visual: ButtonVisual,
    target: RenderTarget,
  ): Promise<readonly RenderedFrame[] | undefined> {
    if (!this.animations) return undefined;

    /*
     * The backdrop is asked first, and only one of the two ever animates. A
     * key showing two animations at different rates would need a combined
     * timeline whose length is the lowest common multiple of both — many times
     * the frames, for a result nobody asked for. The backdrop wins because it
     * is the larger picture and the one spanning other keys.
     */
    const animate = async (
      source: Uint8Array | string | undefined,
      rebuild: (image: string) => ButtonVisual,
    ): Promise<readonly RenderedFrame[] | undefined> => {
      if (!source) return undefined;
      const frames = await this.animations!.decode(source);
      if (!frames || frames.length < 2) return undefined;

      const rendered: RenderedFrame[] = [];
      for (const frame of frames) {
        rendered.push({
          jpeg: await this.render(rebuild(frame.image), target),
          delayMs: frame.delayMs,
        });
        // Rasterizing and JPEG-encoding are synchronous; without handing
        // control back, a hundred-frame GIF would block everything else the
        // deck is doing for as long as it takes.
        await new Promise((resolve) => setImmediate(resolve));
      }
      return rendered;
    };

    return (
      (await animate(visual.backdrop?.source, (image) => ({
        ...visual,
        backdrop: { ...visual.backdrop!, source: image },
      }))) ??
      (await animate(visual.icon?.source, (image) => ({
        ...visual,
        icon: { ...visual.icon!, source: image },
      })))
    );
  }

  async render(visual: ButtonVisual, target: RenderTarget): Promise<Uint8Array> {
    const bitmap = await this.rasterizer.rasterize({
      visual,
      width: target.width,
      height: target.height,
      rotationDegrees: target.rotationDegrees,
      ...(target.gap === undefined ? {} : { gap: target.gap }),
    });

    for (let quality = INITIAL_QUALITY; quality >= MIN_QUALITY; quality -= QUALITY_STEP) {
      const jpeg = await this.encoder.encode(bitmap, { quality });
      if (jpeg.byteLength <= target.maxBytes) return jpeg;
    }

    throw new RenderError(
      `Could not fit a ${target.width}x${target.height} key image into ${target.maxBytes} bytes even at quality ${MIN_QUALITY}`,
    );
  }
}

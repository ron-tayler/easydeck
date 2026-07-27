import type { ButtonVisual } from '../domain/button-visual.js';
import { RenderError } from '../domain/render-target.js';
import type { RenderTarget } from '../domain/render-target.js';
import type { JpegEncoder } from './ports/jpeg-encoder.js';
import type { Rasterizer } from './ports/rasterizer.js';

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
  ) {}

  async render(visual: ButtonVisual, target: RenderTarget): Promise<Uint8Array> {
    const bitmap = await this.rasterizer.rasterize({
      visual,
      width: target.width,
      height: target.height,
      rotationDegrees: target.rotationDegrees,
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

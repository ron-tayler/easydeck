import jpeg from 'jpeg-js';

import type { RgbaBitmap } from '../../domain/render-target.js';
import type { JpegEncoder, JpegEncodeOptions } from '../../application/ports/jpeg-encoder.js';

/**
 * Pure-JS fallback encoder (no native dependencies). Slower and 4:4:4 only,
 * but keeps the renderer working on platforms where the libjpeg-turbo
 * prebuild is unavailable. The D6 accepts both subsamplings.
 */
export class JsJpegEncoder implements JpegEncoder {
  async encode(bitmap: RgbaBitmap, options: JpegEncodeOptions): Promise<Uint8Array> {
    const { data } = jpeg.encode(
      { width: bitmap.width, height: bitmap.height, data: Buffer.from(bitmap.data) },
      options.quality,
    );
    return data;
  }
}

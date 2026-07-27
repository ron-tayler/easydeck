import type { RgbaBitmap } from '../../domain/render-target.js';

export interface JpegEncodeOptions {
  /** 1..100 */
  readonly quality: number;
}

/** Outbound port: encodes raw RGBA pixels as a baseline JPEG. */
export interface JpegEncoder {
  encode(bitmap: RgbaBitmap, options: JpegEncodeOptions): Promise<Uint8Array>;
}

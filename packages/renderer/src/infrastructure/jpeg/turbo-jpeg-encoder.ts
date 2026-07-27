import jpegTurbo from '@julusian/jpeg-turbo';

import type { RgbaBitmap } from '../../domain/render-target.js';
import type { JpegEncoder, JpegEncodeOptions } from '../../application/ports/jpeg-encoder.js';

/** Chroma subsampling. See the note on the default below. */
export type ChromaSubsampling = '4:4:4' | '4:2:2' | '4:2:0';

const SAMPLING = {
  '4:4:4': jpegTurbo.SAMP_444,
  '4:2:2': jpegTurbo.SAMP_422,
  '4:2:0': jpegTurbo.SAMP_420,
} as const;

/**
 * libjpeg-turbo encoder.
 *
 * Defaults to 4:2:0, which is what a USB capture shows the vendor software
 * sending. The choice is tied to the frame size: 4:2:0 has a 16x16 MCU and
 * the D6's 112x112 key divides by 16 exactly, so no partial block lands on an
 * edge. Subsampling at a size that is *not* MCU-aligned is what makes an edge
 * column decode with washed-out colour.
 */
export class TurboJpegEncoder implements JpegEncoder {
  constructor(private readonly subsampling: ChromaSubsampling = '4:2:0') {}

  async encode(bitmap: RgbaBitmap, options: JpegEncodeOptions): Promise<Uint8Array> {
    const rgb = rgbaToRgb(bitmap);

    return jpegTurbo.compress(Buffer.from(rgb), {
      format: jpegTurbo.FORMAT_RGB,
      width: bitmap.width,
      height: bitmap.height,
      subsampling: SAMPLING[this.subsampling],
      quality: options.quality,
    });
  }
}

function rgbaToRgb(bitmap: RgbaBitmap): Uint8Array {
  const pixels = bitmap.width * bitmap.height;
  const rgb = new Uint8Array(pixels * 3);
  for (let i = 0; i < pixels; i++) {
    rgb[i * 3] = bitmap.data[i * 4]!;
    rgb[i * 3 + 1] = bitmap.data[i * 4 + 1]!;
    rgb[i * 3 + 2] = bitmap.data[i * 4 + 2]!;
  }
  return rgb;
}

import { RenderError } from '../domain/render-target.js';
import type { RgbaBitmap } from '../domain/render-target.js';
import type { JpegEncoder } from './ports/jpeg-encoder.js';

export interface EncodedTile {
  readonly bytes: Uint8Array;
  /** The quality that fitted, so the next tile can start there. */
  readonly quality: number;
}

export interface EncodeTileRequest {
  readonly maxBytes: number;
  /** Where to start the search. Defaults to the top of the range. */
  readonly startQuality?: number;
}

const MAX_QUALITY = 90;
const MIN_QUALITY = 10;
const QUALITY_STEP = 10;

/**
 * Fits a tile into the device's byte limit, following Companion's proven
 * approach: start high and step down until it fits.
 *
 * `startQuality` exists because the tiles of one animation are alike — what
 * fitted the last frame will fit this one. Worth stating what it is *not*: on
 * a 112x112 tile the search almost always succeeds on the first try, and
 * carrying the hint saves 9ms across 360 tiles. It is kept because it costs
 * nothing, not because it rescues anything.
 */
export class TileEncoder {
  constructor(private readonly encoder: JpegEncoder) {}

  async encode(tile: RgbaBitmap, request: EncodeTileRequest): Promise<EncodedTile> {
    const start = clampQuality(request.startQuality ?? MAX_QUALITY);

    for (let quality = start; quality >= MIN_QUALITY; quality -= QUALITY_STEP) {
      const bytes = await this.encoder.encode(tile, { quality });
      if (bytes.byteLength <= request.maxBytes) return { bytes, quality };
    }

    throw new RenderError(
      `Could not fit a ${tile.width}x${tile.height} tile into ${request.maxBytes} bytes even at quality ${MIN_QUALITY}`,
    );
  }
}

/**
 * Snaps a hint onto the search ladder.
 *
 * A hint off the ladder — 85, say — would walk 85, 75, 65 and never try the
 * qualities the cache was built from, quietly doubling the encodes for tiles
 * that look identical.
 */
function clampQuality(quality: number): number {
  const bounded = Math.min(MAX_QUALITY, Math.max(MIN_QUALITY, Math.round(quality)));
  return Math.ceil(bounded / QUALITY_STEP) * QUALITY_STEP;
}

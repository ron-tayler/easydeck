import type { TileBitmap } from './composer-port.js';

export interface EncodedTile {
  readonly bytes: Uint8Array;
  /** The quality that fitted, so the next tile can start there. */
  readonly quality: number;
}

export interface EncodeRequest {
  readonly maxBytes: number;
  /**
   * Where to begin the search for a quality that fits.
   *
   * Measured, so worth stating plainly: on a 112x112 tile the search almost
   * always succeeds on the first try, and skipping it saves 9ms across 360
   * tiles. It is kept because it is free, not because it is a win — the tiles
   * of one animation are alike, so what fitted the last one will fit this one.
   */
  readonly startQuality?: number;
}

export interface EncoderPort {
  encode(tile: TileBitmap, request: EncodeRequest): Promise<EncodedTile>;
}

/**
 * What the output must satisfy. Structurally compatible with the device
 * zone's `KeyImageFormat`, so a `Surface.keyImage` can be passed straight in —
 * without this package depending on @easydeck/device.
 */
export interface RenderTarget {
  readonly width: number;
  readonly height: number;
  /** Clockwise pre-rotation the device expects (panel mounting). */
  readonly rotationDegrees: 0 | 90 | 180 | 270;
  /** Hard limit for the encoded JPEG. */
  readonly maxBytes: number;
}

/** Raw pixels handed from the rasterizer to the encoder. */
export interface RgbaBitmap {
  readonly width: number;
  readonly height: number;
  /** width * height * 4 bytes, row-major RGBA. */
  readonly data: Uint8Array;
}

export class RenderError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

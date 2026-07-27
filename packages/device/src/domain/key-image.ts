/**
 * Describes what a key display expects to receive.
 *
 * The device zone deliberately does no image processing: callers (the
 * renderer zone) must deliver an already-encoded image that satisfies this
 * format. `rotationDegrees` tells the caller how the panel is mounted — the
 * image must be pre-rotated clockwise by this amount before encoding.
 */
export interface KeyImageFormat {
  readonly encoding: 'jpeg';
  readonly width: number;
  readonly height: number;
  readonly rotationDegrees: 0 | 90 | 180 | 270;
  /** Hard firmware limit for a single encoded image. */
  readonly maxBytes: number;
}

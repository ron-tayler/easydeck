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
  /**
   * Space between two neighbouring key displays, in the same pixels as the
   * image itself.
   *
   * Only a picture stretched across several keys cares. The keys are not
   * touching, so the part of the picture that falls between them is hidden by
   * the bezel and must be *skipped*, not squeezed into the visible strips —
   * otherwise every seam repeats a sliver of the image and the picture looks
   * concertinaed.
   */
  readonly gap: number;
}

/**
 * Outbound port: an animated picture, split into still frames.
 *
 * A port rather than a direct call into the GIF decoder, because deciding
 * *what* to draw belongs to the application layer while knowing how a GIF is
 * laid out does not. It also leaves room for the next format without touching
 * anything above.
 */
export interface AnimationFrame {
  /** A still, as something the rasterizer can already load: a PNG data URL. */
  readonly image: string;
  readonly delayMs: number;
}

export interface AnimationDecoder {
  /**
   * Splits an icon source into frames, or returns undefined when it is an
   * ordinary still picture — which is the common case and must not be an
   * error.
   */
  decode(source: Uint8Array | string): Promise<readonly AnimationFrame[] | undefined>;
}

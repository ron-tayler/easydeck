import type { ButtonVisual } from '../../domain/visual.js';

/**
 * Outbound port: turns a resolved visual into bytes the surface accepts.
 *
 * The target geometry is deliberately absent — whoever wires this up already
 * knows which surface the images are headed for, so the engine never has to
 * carry pixel sizes around.
 */
export interface KeyRendererPort {
  render(visual: ButtonVisual): Promise<Uint8Array>;

  /**
   * Every frame of an animated visual, or undefined for an ordinary still.
   *
   * Optional so a host that cannot decode animations — or a test that has no
   * interest in them — simply leaves it out and gets static keys.
   */
  renderFrames?(visual: ButtonVisual): Promise<readonly AnimatedFrame[] | undefined>;
}

export interface AnimatedFrame {
  readonly image: Uint8Array;
  readonly delayMs: number;
}

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
}

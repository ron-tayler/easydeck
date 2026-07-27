import type { KeyImageFormat } from '@easydeck/device';
import type { KeyRendererPort } from '@easydeck/engine';
import type { KeyRenderer } from '@easydeck/renderer';

/**
 * Binds the renderer zone to the engine's `KeyRendererPort`, closing over the
 * target surface's frame format.
 *
 * The engine's `ButtonVisual` and the renderer's are separate declarations —
 * neither zone depends on the other — so this call is where TypeScript
 * verifies they still describe the same thing.
 */
export function toKeyRendererPort(renderer: KeyRenderer, format: KeyImageFormat): KeyRendererPort {
  const target = {
    width: format.width,
    height: format.height,
    rotationDegrees: format.rotationDegrees,
    maxBytes: format.maxBytes,
  };

  return {
    render: (visual) => renderer.render(visual, target),
  };
}

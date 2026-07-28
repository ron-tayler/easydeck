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
    gap: format.gap,
  };

  return {
    render: (visual) => renderer.render(visual, target),
    /** Renamed on the way across: the engine calls a frame's bytes `image`,
        because it neither knows nor cares that they are JPEG. */
    renderFrames: async (visual) => {
      const frames = await renderer.renderFrames(visual, target);
      return frames?.map((frame) => ({ image: frame.jpeg, delayMs: frame.delayMs }));
    },
  };
}

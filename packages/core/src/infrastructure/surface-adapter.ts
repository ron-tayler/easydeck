import type { Surface } from '@easydeck/device';
import type { SurfacePort } from '@easydeck/engine';

/**
 * Binds the device zone's `Surface` to the engine's `SurfacePort`.
 *
 * The engine deliberately knows nothing about @easydeck/device, so this is
 * one of the two places the two zones meet. It is also where TypeScript
 * catches any drift between them.
 */
export function toSurfacePort(surface: Surface): SurfacePort {
  return {
    layout: surface.layout,

    onKeyDown(listener) {
      const wrapped = (event: { key: number }) => listener(event.key);
      surface.on('keyDown', wrapped);
      return () => surface.off('keyDown', wrapped);
    },

    onKeyUp(listener) {
      const wrapped = (event: { key: number }) => listener(event.key);
      surface.on('keyUp', wrapped);
      return () => surface.off('keyUp', wrapped);
    },

    setKeyImage: (key, image) => surface.setKeyImage(key, image),
    clearKey: (key) => surface.clearKey(key),
  };
}

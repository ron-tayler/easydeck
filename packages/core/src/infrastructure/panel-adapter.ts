import type { EncoderPort, PanelFormat, PanelPort } from '@easydeck/compositor';
import type { KeyImageFormat, Surface } from '@easydeck/device';
import type { PanelCompositor } from '@easydeck/compositor';
import type { PresenterPort, Scene } from '@easydeck/engine';
import type { TileEncoder } from '@easydeck/renderer';

/**
 * The three seams between the compositor and everything around it.
 *
 * Each zone declares what it needs and none of them import each other, so
 * these functions are where TypeScript verifies that the separately written
 * descriptions still describe the same thing.
 */

/** The device's key format, as panel geometry. */
export function toPanelFormat(surface: Surface): PanelFormat {
  const image: KeyImageFormat = surface.keyImage;

  return {
    rows: surface.layout.rows,
    cols: surface.layout.cols,
    tileWidth: image.width,
    tileHeight: image.height,
    gap: image.gap,
    rotationDegrees: image.rotationDegrees,
    maxTileBytes: image.maxBytes,
  };
}

/** The device zone's `Surface`, narrowed to what the compositor writes to. */
export function toPanelPort(surface: Surface): PanelPort {
  return {
    writeKey: (key, image) => surface.setKeyImage(key, image),
    clearKey: (key) => surface.clearKey(key),
  };
}

export function toEncoderPort(encoder: TileEncoder): EncoderPort {
  return {
    encode: (tile, request) =>
      encoder.encode(tile, {
        maxBytes: request.maxBytes,
        ...(request.startQuality === undefined ? {} : { startQuality: request.startQuality }),
      }),
  };
}

/**
 * The engine's view of the panel: presses in, scenes out.
 *
 * The engine's `Scene` and the compositor's are separate declarations —
 * neither zone depends on the other — so this call is where they are checked
 * against each other.
 */
export function toPresenterPort(surface: Surface, compositor: PanelCompositor): PresenterPort {
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

    present: (scene: Scene) => compositor.present(scene),
  };
}

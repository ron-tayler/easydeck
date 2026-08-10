import type { EncoderPort, PanelFormat, PanelPort } from '@easydeck/compositor';
import type { KeyImageFormat, Surface } from '@easydeck/device';
import type { PanelCompositor } from '@easydeck/compositor';
import { GestureRecognizer } from '@easydeck/engine';
import type { ButtonEvent, PresenterPort, Scene } from '@easydeck/engine';
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
 * The engine's view of the panel: gestures in, scenes out.
 *
 * A physical panel can only report that a key went down and came up, so the
 * recogniser lives here — on the surface's side of the seam, where it belongs.
 * A deck that works gestures out for itself, such as a touchscreen across the
 * network, implements this port without one.
 *
 * The engine's `Scene` and the compositor's are separate declarations — neither
 * zone depends on the other — so this call is also where they are checked
 * against each other.
 */
export function toPresenterPort(surface: Surface, compositor: PanelCompositor): PresenterPort {
  const listeners = new Set<(key: number, gesture: ButtonEvent) => void>();
  /** Keys where holding does something; told to us by the engine. */
  let holdable: ReadonlySet<number> = new Set();

  const recognizer = new GestureRecognizer((key, gesture) => {
    /*
     * A hold that fired has been acknowledged by firing.
     *
     * The key came down to say "I felt that", and once the hold has actually
     * run there is nothing left to say — so the key returns to size with the
     * finger still on it, which is also how you can tell a hold happened
     * without lifting off. Where nothing is bound to holding, the shrink is
     * the only feedback there is and it stays until release.
     */
    if (gesture === 'longPress' && holdable.has(key)) void compositor.setPressed(key, false);

    for (const listener of listeners) listener(key, gesture);
  });

  surface.on('keyDown', (event) => {
    recognizer.down(event.key);
    // Contact, not gesture: the key acknowledges the finger before anyone
    // knows whether this will turn out to be a tap, a hold or half a pair.
    void compositor.setPressed(event.key, true);
  });
  surface.on('keyUp', (event) => {
    recognizer.up(event.key);
    void compositor.setPressed(event.key, false);
  });
  // A panel that went away mid-press would otherwise come back holding a
  // gesture nobody is making any more.
  surface.on('disconnected', () => recognizer.reset());

  return {
    layout: surface.layout,

    onGesture(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    setDoublePressKeys: (keys) => recognizer.setDoublePressKeys(keys),
    setLongPressKeys: (keys) => {
      holdable = new Set(keys);
    },

    present: (scene: Scene) => compositor.present(scene),
  };
}

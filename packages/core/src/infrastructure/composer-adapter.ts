import type {
  ComposedRegion,
  ComposerPort,
  CutTileRequest,
  FrameSource,
  OpenRequest,
  PanelFormat,
  ShrinkTileRequest,
  TileBitmap,
} from '@easydeck/compositor';
import { tileOrigin } from '@easydeck/compositor';
import type { PanelComposer } from '@easydeck/renderer';

/**
 * Binds the renderer zone's composer to the compositor's port.
 *
 * The translation is one of vocabulary. The compositor thinks in cells — "the
 * second key of this region" — because that is what a scene is written in; the
 * renderer thinks in pixels, because that is what it draws. Turning one into
 * the other needs the panel's geometry, which is why it happens here, in the
 * one place that knows which panel this is.
 */
export function toComposerPort(composer: PanelComposer, format: PanelFormat): ComposerPort {
  return {
    async open(request: OpenRequest): Promise<FrameSource> {
      const source = await composer.open({
        ...(request.asset ? { source: request.asset.source } : {}),
        ...(request.background === undefined ? {} : { background: request.background }),
        width: request.geometry.width,
        height: request.geometry.height,
      });

      return {
        frameCount: source.frameCount,
        delaysMs: source.delaysMs,
        composeFrame: async (index: number): Promise<ComposedRegion> => source.composeFrame(index),
        close: () => source.close(),
      };
    },

    async cutTile(region: ComposedRegion, request: CutTileRequest): Promise<TileBitmap> {
      const origin = tileOrigin(format, request.col, request.row);

      return composer.cutTile(region, {
        x: origin.x,
        y: origin.y,
        width: format.tileWidth,
        height: format.tileHeight,
        rotationDegrees: format.rotationDegrees,
        corners: request.corners,
        ...(request.cornerRadius === undefined ? {} : { cornerRadius: request.cornerRadius }),
        ...(request.label ? { label: request.label } : {}),
        ...(request.hasPicture ? { hasPicture: true } : {}),
        ...(request.alert ? { alert: true } : {}),
      });
    },

    shrinkTile(tile: Uint8Array, request: ShrinkTileRequest): Promise<TileBitmap> {
      return composer.shrinkTile(tile, request);
    },
  };
}

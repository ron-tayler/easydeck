/**
 * @easydeck/renderer — the rendering zone.
 *
 * Turns a declarative ButtonVisual into a JPEG that satisfies a device's
 * RenderTarget (size, rotation, byte limit). Same zone layout as the rest of
 * the project: domain / application / infrastructure, dependencies inward.
 */

export type { ButtonVisual, BackdropSlice, IconSpec, LabelSpec } from './domain/button-visual.js';
export type { RenderTarget, RgbaBitmap } from './domain/render-target.js';
export { RenderError } from './domain/render-target.js';

export type { Rasterizer, RasterizeRequest } from './application/ports/rasterizer.js';
export type { JpegEncoder, JpegEncodeOptions } from './application/ports/jpeg-encoder.js';
export { KeyRenderer } from './application/key-renderer.js';

export type {
  ComposedRegion,
  PanelComposer,
  RegionRequest,
  RegionSource,
  ShrinkTileRequest,
  TileCorners,
  TileRequest,
} from './application/panel-composer.js';
export { TileEncoder } from './application/tile-encoder.js';
export type { EncodedTile, EncodeTileRequest } from './application/tile-encoder.js';
export { CanvasPanelComposer } from './infrastructure/canvas/canvas-panel-composer.js';
export { isGif, openGif } from './infrastructure/canvas/gif-sequence.js';
export type { GifSequence } from './infrastructure/canvas/gif-sequence.js';

export { NapiCanvasRasterizer } from './infrastructure/canvas/napi-canvas-rasterizer.js';
export { TurboJpegEncoder } from './infrastructure/jpeg/turbo-jpeg-encoder.js';
export type { ChromaSubsampling } from './infrastructure/jpeg/turbo-jpeg-encoder.js';
export { JsJpegEncoder } from './infrastructure/jpeg/js-jpeg-encoder.js';

import { KeyRenderer } from './application/key-renderer.js';
import type { JpegEncoder } from './application/ports/jpeg-encoder.js';
import { NapiCanvasRasterizer } from './infrastructure/canvas/napi-canvas-rasterizer.js';

/**
 * libjpeg-turbo, falling back to the pure-JS encoder if the native prebuild
 * fails to load on this platform.
 */
export async function createJpegEncoder(): Promise<JpegEncoder> {
  try {
    const { TurboJpegEncoder } = await import('./infrastructure/jpeg/turbo-jpeg-encoder.js');
    return new TurboJpegEncoder();
  } catch {
    const { JsJpegEncoder } = await import('./infrastructure/jpeg/js-jpeg-encoder.js');
    return new JsJpegEncoder();
  }
}

/**
 * Convenience composition root for rendering a single visual: skia canvas plus
 * whichever JPEG encoder this platform has.
 *
 * The deck itself no longer goes through here — it composes whole regions
 * through `CanvasPanelComposer` — but rendering one key on its own is still
 * what previews and the examples want.
 */
export async function createKeyRenderer(): Promise<KeyRenderer> {
  return new KeyRenderer(new NapiCanvasRasterizer(), await createJpegEncoder());
}

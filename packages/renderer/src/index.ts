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

export { TurboJpegEncoder } from './infrastructure/jpeg/turbo-jpeg-encoder.js';
export type { ChromaSubsampling } from './infrastructure/jpeg/turbo-jpeg-encoder.js';
export { JsJpegEncoder } from './infrastructure/jpeg/js-jpeg-encoder.js';

import { KeyRenderer } from './application/key-renderer.js';
import type { JpegEncoder } from './application/ports/jpeg-encoder.js';
import { CanvasPanelComposer } from './infrastructure/canvas/canvas-panel-composer.js';

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
 * Convenience composition root for rendering a single visual: the panel
 * composer plus whichever JPEG encoder this platform has.
 *
 * The same composer the deck uses. It used to be a rasterizer of its own,
 * which meant two implementations of one picture — and they drifted, quietly,
 * until a parametric icon drew in one and not the other.
 */
export async function createKeyRenderer(): Promise<KeyRenderer> {
  return new KeyRenderer(new CanvasPanelComposer(), await createJpegEncoder());
}

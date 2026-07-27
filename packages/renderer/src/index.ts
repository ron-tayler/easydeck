/**
 * @easydeck/renderer — the rendering zone.
 *
 * Turns a declarative ButtonVisual into a JPEG that satisfies a device's
 * RenderTarget (size, rotation, byte limit). Same zone layout as the rest of
 * the project: domain / application / infrastructure, dependencies inward.
 */

export type { ButtonVisual, IconSpec, LabelSpec } from './domain/button-visual.js';
export type { RenderTarget, RgbaBitmap } from './domain/render-target.js';
export { RenderError } from './domain/render-target.js';

export type { Rasterizer, RasterizeRequest } from './application/ports/rasterizer.js';
export type { JpegEncoder, JpegEncodeOptions } from './application/ports/jpeg-encoder.js';
export { KeyRenderer } from './application/key-renderer.js';

export { NapiCanvasRasterizer } from './infrastructure/canvas/napi-canvas-rasterizer.js';
export { TurboJpegEncoder } from './infrastructure/jpeg/turbo-jpeg-encoder.js';
export type { ChromaSubsampling } from './infrastructure/jpeg/turbo-jpeg-encoder.js';
export { JsJpegEncoder } from './infrastructure/jpeg/js-jpeg-encoder.js';

import { KeyRenderer } from './application/key-renderer.js';
import type { JpegEncoder } from './application/ports/jpeg-encoder.js';
import { NapiCanvasRasterizer } from './infrastructure/canvas/napi-canvas-rasterizer.js';

/**
 * Convenience composition root: skia canvas + libjpeg-turbo, falling back to
 * the pure-JS encoder if the native prebuild fails to load on this platform.
 */
export async function createKeyRenderer(): Promise<KeyRenderer> {
  let encoder: JpegEncoder;
  try {
    const { TurboJpegEncoder } = await import('./infrastructure/jpeg/turbo-jpeg-encoder.js');
    encoder = new TurboJpegEncoder();
  } catch {
    const { JsJpegEncoder } = await import('./infrastructure/jpeg/js-jpeg-encoder.js');
    encoder = new JsJpegEncoder();
  }
  return new KeyRenderer(new NapiCanvasRasterizer(), encoder);
}

import type { ButtonVisual } from '../../domain/button-visual.js';
import type { RgbaBitmap } from '../../domain/render-target.js';

export interface RasterizeRequest {
  readonly visual: ButtonVisual;
  readonly width: number;
  readonly height: number;
  /** Clockwise rotation baked into the output pixels. */
  readonly rotationDegrees: 0 | 90 | 180 | 270;
  /** Space between neighbouring keys; see RenderTarget.gap. */
  readonly gap?: number;
}

/** Outbound port: draws a ButtonVisual into raw RGBA pixels. */
export interface Rasterizer {
  rasterize(request: RasterizeRequest): Promise<RgbaBitmap>;
}

import { createCanvas, loadImage, type SKRSContext2D } from '@napi-rs/canvas';

import type {
  BackdropSlice,
  ButtonVisual,
  IconSpec,
  LabelSpec,
} from '../../domain/button-visual.js';
import { RenderError } from '../../domain/render-target.js';
import type { RgbaBitmap } from '../../domain/render-target.js';
import type { Rasterizer, RasterizeRequest } from '../../application/ports/rasterizer.js';
import { resolveFontFamily } from './font-registry.js';

const DEFAULT_BACKGROUND = '#000000';
const DEFAULT_LABEL_COLOR = '#ffffff';
const DEFAULT_CORNER_RADIUS = 12;
const MIN_FONT_SIZE = 9;

/** Skia-backed rasterizer (@napi-rs/canvas ships prebuilt binaries for all
 * three platforms and needs no system dependencies). */
export class NapiCanvasRasterizer implements Rasterizer {
  async rasterize(request: RasterizeRequest): Promise<RgbaBitmap> {
    const { visual, width, height, rotationDegrees } = request;
    const swap = rotationDegrees === 90 || rotationDegrees === 270;

    // Draw upright first; bake the rotation in a second pass.
    const upright = createCanvas(swap ? height : width, swap ? width : height);
    const ctx = upright.getContext('2d');
    const w = upright.width;
    const h = upright.height;

    // Scale visual units (specified at 100x100) to the actual key size.
    const unit = Math.min(w, h) / 100;

    ctx.fillStyle = visual.background ?? DEFAULT_BACKGROUND;
    ctx.fillRect(0, 0, w, h);

    if (visual.backdrop) await this.drawBackdrop(ctx, w, h, visual.backdrop, request.gap ?? 0);
    if (visual.icon) await this.drawIcon(ctx, w, h, visual.icon);
    if (visual.label) this.drawLabel(ctx, w, h, visual, unit);

    this.applyRoundedMask(
      ctx,
      w,
      h,
      (visual.cornerRadius ?? DEFAULT_CORNER_RADIUS) * unit,
      visual.backdrop,
    );

    if (rotationDegrees === 0) return this.toBitmap(upright.getContext('2d'), w, h);

    const rotated = createCanvas(width, height);
    const rctx = rotated.getContext('2d');
    rctx.translate(width / 2, height / 2);
    rctx.rotate((rotationDegrees * Math.PI) / 180);
    rctx.drawImage(upright, -w / 2, -h / 2);
    return this.toBitmap(rctx, width, height);
  }

  /**
   * Rounds the corners and puts black behind them.
   *
   * Deliberately not `ctx.clip()`: Skia clips with a hard, non-antialiased
   * edge, which shows up on the device as visible stair-stepping. Masking
   * with `destination-in` against a filled path keeps the edge antialiased.
   */
  private applyRoundedMask(
    ctx: SKRSContext2D,
    w: number,
    h: number,
    radius: number,
    backdrop?: BackdropSlice,
  ): void {
    if (radius > 0) {
      /*
       * Only the region's outer corners are rounded. A key in the middle of a
       * merged picture that rounded all four would bite a notch out of the
       * image at every seam — the corners face the picture, not the panel.
       */
      const corners = backdrop
        ? {
            topLeft: backdrop.col === 0 && backdrop.row === 0,
            topRight: backdrop.col === backdrop.cols - 1 && backdrop.row === 0,
            bottomRight: backdrop.col === backdrop.cols - 1 && backdrop.row === backdrop.rows - 1,
            bottomLeft: backdrop.col === 0 && backdrop.row === backdrop.rows - 1,
          }
        : { topLeft: true, topRight: true, bottomRight: true, bottomLeft: true };

      ctx.save();
      ctx.globalCompositeOperation = 'destination-in';
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.roundRect(0, 0, w, h, [
        corners.topLeft ? radius : 0,
        corners.topRight ? radius : 0,
        corners.bottomRight ? radius : 0,
        corners.bottomLeft ? radius : 0,
      ]);
      ctx.fill();
      ctx.restore();
    }

    // The panel is black around the key, so blend the corners into black.
    ctx.save();
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  /**
   * This key's part of a picture that covers several keys.
   *
   * The whole picture is laid out over the full region first, then the canvas
   * is shifted so that only this key's cell lands on it. Doing the arithmetic
   * on the region rather than cropping a pre-scaled tile is what keeps the
   * seams aligned: every key derives the same layout from the same numbers and
   * simply looks at a different part of it.
   *
   * Drawn edge to edge on purpose — a gap here would be a visible grid line
   * through the middle of someone's picture.
   */
  private async drawBackdrop(
    ctx: SKRSContext2D,
    w: number,
    h: number,
    backdrop: BackdropSlice,
    gap: number,
  ): Promise<void> {
    let image;
    try {
      image = await loadImage(backdrop.source as Parameters<typeof loadImage>[0]);
    } catch (cause) {
      throw new RenderError('Could not load the backdrop image', { cause });
    }

    /*
     * The region is measured across the panel, gaps included, and each key
     * then shows the part of the picture that lands on it. What falls between
     * two displays is simply not drawn — it is behind the bezel. Laying the
     * picture out over the visible strips alone would repeat a sliver of it at
     * every seam and make straight lines step sideways.
     */
    const regionW = w * backdrop.cols + gap * (backdrop.cols - 1);
    const regionH = h * backdrop.rows + gap * (backdrop.rows - 1);

    // Cropped to the region: a picture spread over six keys is meant to fill
    // them, and letterboxing it defeats the point.
    const scale = Math.max(regionW / image.width, regionH / image.height);

    const dw = image.width * scale;
    const dh = image.height * scale;

    ctx.drawImage(
      image,
      (regionW - dw) / 2 - backdrop.col * (w + gap),
      (regionH - dh) / 2 - backdrop.row * (h + gap),
      dw,
      dh,
    );
  }

  /**
   * The picture, over the whole key.
   *
   * No strip is reserved for the label and no size fraction is applied: a key
   * showing a picture shows it edge to edge, and the text goes on top. That
   * makes this preview agree with what the panel does, which is the only
   * reason to have a preview at all.
   */
  private async drawIcon(ctx: SKRSContext2D, w: number, h: number, icon: IconSpec): Promise<void> {
    let image;
    try {
      image = await loadImage(icon.source as Parameters<typeof loadImage>[0]);
    } catch (cause) {
      throw new RenderError('Could not load icon image', { cause });
    }

    const scale = Math.max(w / image.width, h / image.height);
    const dw = image.width * scale;
    const dh = image.height * scale;

    ctx.drawImage(image, (w - dw) / 2, (h - dh) / 2, dw, dh);
  }

  private drawLabel(ctx: SKRSContext2D, w: number, h: number, visual: ButtonVisual, unit: number): void {
    const label: LabelSpec = visual.label!;
    const family = resolveFontFamily(label.fontFamily);
    const maxWidth = w * 0.94;
    let fontSize = (label.fontSize ?? 22) * unit;

    // Shrink until the whole line fits; the engine will handle wrapping later.
    ctx.font = `${fontSize}px ${family}`;
    while (fontSize > MIN_FONT_SIZE && ctx.measureText(label.text).width > maxWidth) {
      fontSize -= 1;
      ctx.font = `${fontSize}px ${family}`;
    }

    // Keep a half-line clear of each edge so descenders are not clipped
    // (textBaseline is 'middle', so y is the visual centre of the line).
    const position = label.position ?? 'bottom';
    const edgePadding = fontSize * 0.62 + 2 * unit;
    const y = position === 'top' ? edgePadding : position === 'bottom' ? h - edgePadding : h / 2;

    ctx.fillStyle = label.color ?? DEFAULT_LABEL_COLOR;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label.text, w / 2, y, maxWidth);
  }

  private toBitmap(ctx: SKRSContext2D, width: number, height: number): RgbaBitmap {
    const image = ctx.getImageData(0, 0, width, height);
    return { width, height, data: new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength) };
  }
}

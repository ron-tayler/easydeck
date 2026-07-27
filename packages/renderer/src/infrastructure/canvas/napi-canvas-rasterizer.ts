import { createCanvas, loadImage, type SKRSContext2D } from '@napi-rs/canvas';

import type { ButtonVisual, IconSpec, LabelSpec } from '../../domain/button-visual.js';
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

    const labelBox = visual.label ? this.measureLabelBox(visual, h, unit) : undefined;
    if (visual.icon) await this.drawIcon(ctx, w, h, visual.icon, labelBox);
    if (visual.label) this.drawLabel(ctx, w, h, visual, unit);

    this.applyRoundedMask(ctx, w, h, (visual.cornerRadius ?? DEFAULT_CORNER_RADIUS) * unit);

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
  private applyRoundedMask(ctx: SKRSContext2D, w: number, h: number, radius: number): void {
    if (radius > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-in';
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.roundRect(0, 0, w, h, radius);
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

  /** Height (in px) the label strip occupies at the top or bottom edge. */
  private measureLabelBox(visual: ButtonVisual, h: number, unit: number): { position: 'top' | 'center' | 'bottom'; height: number } {
    const label = visual.label!;
    const fontSize = (label.fontSize ?? 22) * unit;
    const position = label.position ?? (visual.icon ? 'bottom' : 'center');
    return { position, height: Math.min(h, fontSize * 1.5) };
  }

  private async drawIcon(
    ctx: SKRSContext2D,
    w: number,
    h: number,
    icon: IconSpec,
    labelBox: { position: 'top' | 'center' | 'bottom'; height: number } | undefined,
  ): Promise<void> {
    let image;
    try {
      image = await loadImage(icon.source as Parameters<typeof loadImage>[0]);
    } catch (cause) {
      throw new RenderError('Could not load icon image', { cause });
    }

    // Reserve the label strip so icon and text never overlap.
    const boxTop = labelBox?.position === 'top' ? labelBox.height : 0;
    const boxBottom = labelBox?.position === 'bottom' ? labelBox.height : 0;
    const boxH = (h - boxTop - boxBottom) * (icon.size ?? 1);
    const boxW = w;

    const scale =
      (icon.fit ?? 'contain') === 'cover'
        ? Math.max(boxW / image.width, boxH / image.height)
        : Math.min(boxW / image.width, boxH / image.height);
    const dw = image.width * scale;
    const dh = image.height * scale;
    const dx = (w - dw) / 2;
    const dy = boxTop + (h - boxTop - boxBottom - dh) / 2;

    ctx.drawImage(image, dx, dy, dw, dh);
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
    const position = label.position ?? (visual.icon ? 'bottom' : 'center');
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

import { createCanvas, loadImage, type Canvas, type SKRSContext2D } from '@napi-rs/canvas';

import type {
  ComposedRegion,
  PanelComposer,
  RegionRequest,
  RegionSource,
  TileRequest,
} from '../../application/panel-composer.js';
import type { LabelSpec } from '../../domain/button-visual.js';
import { RenderError } from '../../domain/render-target.js';
import type { RgbaBitmap } from '../../domain/render-target.js';
import { resolveFontFamily } from './font-registry.js';
import { openGif, isGif } from './gif-sequence.js';
import type { GifSequence } from './gif-sequence.js';
import { readSource } from './read-source.js';

const DEFAULT_BACKGROUND = '#000000';
const DEFAULT_LABEL_COLOR = '#ffffff';
const DEFAULT_CORNER_RADIUS = 12;
const DEFAULT_FONT_SIZE = 22;
const MIN_FONT_SIZE = 9;

/** Skia-backed composer: one canvas per region, reused across its frames. */
export class CanvasPanelComposer implements PanelComposer {
  async open(request: RegionRequest): Promise<RegionSource> {
    const canvas = createCanvas(request.width, request.height);
    const ctx = canvas.getContext('2d');

    if (request.source === undefined) return this.openStill(canvas, ctx, request, undefined);

    const bytes = await readSource(request.source);
    if (!bytes) throw new RenderError('Could not read the picture');

    if (isGif(bytes)) return this.openAnimated(canvas, ctx, request, openGif(bytes));

    let image;
    try {
      image = await loadImage(Buffer.from(bytes));
    } catch (cause) {
      throw new RenderError('Could not load the picture', { cause });
    }
    return this.openStill(canvas, ctx, request, image);
  }

  /**
   * One frame, composed on first ask rather than at `open`.
   *
   * Deferred because a region may never be drawn: a page can be replaced
   * before its turn comes round, and composing eagerly would have paid for a
   * picture nobody saw.
   */
  private openStill(
    canvas: Canvas,
    ctx: SKRSContext2D,
    request: RegionRequest,
    image: DrawableImage | undefined,
  ): RegionSource {
    let drawn = false;

    return {
      frameCount: 1,
      delaysMs: [0],
      composeFrame: () => {
        if (!drawn) {
          this.fill(ctx, request);
          if (image) this.drawCovering(ctx, image, image.width, image.height, request);
          drawn = true;
        }
        return { width: canvas.width, height: canvas.height, canvas } satisfies InternalRegion;
      },
      close: () => undefined,
    };
  }

  private openAnimated(
    canvas: Canvas,
    ctx: SKRSContext2D,
    request: RegionRequest,
    gif: GifSequence,
  ): RegionSource {
    // One scratch canvas for the decoded frame, reused: a fresh one per frame
    // is an allocation the size of the picture, seventy-six times over.
    const scratch = createCanvas(gif.width, gif.height);
    const scratchCtx = scratch.getContext('2d');
    const image = scratchCtx.createImageData(gif.width, gif.height);

    return {
      frameCount: gif.frameCount,
      delaysMs: gif.delaysMs,
      composeFrame: (index) => {
        image.data.set(gif.frame(index));
        scratchCtx.putImageData(image, 0, 0);

        this.fill(ctx, request);
        this.drawCovering(ctx, scratch, gif.width, gif.height, request);

        return { width: canvas.width, height: canvas.height, canvas } satisfies InternalRegion;
      },
      close: () => undefined,
    };
  }

  cutTile(region: ComposedRegion, request: TileRequest): RgbaBitmap {
    const source = (region as InternalRegion).canvas;

    const tile = createCanvas(request.width, request.height);
    const ctx = tile.getContext('2d');

    // Shifting the source rather than scaling a crop: the tile is the region
    // seen through a window, so nothing is resampled and the seams stay put.
    ctx.drawImage(source, -request.x, -request.y);

    if (request.label) this.drawLabel(ctx, request.width, request.height, request.label);
    this.roundCorners(ctx, request);

    if (request.rotationDegrees === 0) return toBitmap(ctx, request.width, request.height);

    const rotated = createCanvas(request.width, request.height);
    const rctx = rotated.getContext('2d');
    rctx.translate(request.width / 2, request.height / 2);
    rctx.rotate((request.rotationDegrees * Math.PI) / 180);
    rctx.drawImage(tile, -request.width / 2, -request.height / 2);
    return toBitmap(rctx, request.width, request.height);
  }

  private fill(ctx: SKRSContext2D, request: RegionRequest): void {
    ctx.fillStyle = request.background ?? DEFAULT_BACKGROUND;
    ctx.fillRect(0, 0, request.width, request.height);
  }

  /**
   * The picture over the whole region, edge to edge.
   *
   * `cover` by default and for every region size, a single key included: a
   * picture on a key fills the key. Letterboxing is available through
   * `contain`, but it is the exception now rather than what an icon gets.
   */
  private drawCovering(
    ctx: SKRSContext2D,
    image: DrawableImage,
    width: number,
    height: number,
    request: RegionRequest,
  ): void {
    const scale =
      (request.fit ?? 'cover') === 'contain'
        ? Math.min(request.width / width, request.height / height)
        : Math.max(request.width / width, request.height / height);

    const dw = width * scale;
    const dh = height * scale;
    ctx.drawImage(image, (request.width - dw) / 2, (request.height - dh) / 2, dw, dh);
  }

  /**
   * The label, always on top and never given room of its own.
   *
   * The old path reserved a strip at the top or bottom and shrank the picture
   * out of it. Now the picture keeps the whole tile and the text sits over it,
   * so contrast is the profile author's to choose through `color`.
   */
  private drawLabel(ctx: SKRSContext2D, width: number, height: number, label: LabelSpec): void {
    const unit = Math.min(width, height) / 100;
    const family = resolveFontFamily(label.fontFamily);
    const maxWidth = width * 0.94;
    let fontSize = (label.fontSize ?? DEFAULT_FONT_SIZE) * unit;

    ctx.font = `${fontSize}px ${family}`;
    while (fontSize > MIN_FONT_SIZE && ctx.measureText(label.text).width > maxWidth) {
      fontSize -= 1;
      ctx.font = `${fontSize}px ${family}`;
    }

    // Keep a half-line clear of each edge so descenders are not clipped
    // (textBaseline is 'middle', so y is the visual centre of the line).
    const position = label.position ?? 'bottom';
    const edgePadding = fontSize * 0.62 + 2 * unit;
    const y = position === 'top' ? edgePadding : position === 'bottom' ? height - edgePadding : height / 2;

    ctx.fillStyle = label.color ?? DEFAULT_LABEL_COLOR;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label.text, width / 2, y, maxWidth);
  }

  /**
   * Rounds the outer corners and puts black behind them.
   *
   * Deliberately not `ctx.clip()`: Skia clips with a hard, non-antialiased
   * edge that shows up on the device as visible stair-stepping. Masking with
   * `destination-in` against a filled path keeps the edge antialiased.
   */
  private roundCorners(ctx: SKRSContext2D, request: TileRequest): void {
    const unit = Math.min(request.width, request.height) / 100;
    const radius = (request.cornerRadius ?? DEFAULT_CORNER_RADIUS) * unit;
    const { corners } = request;

    if (radius > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-in';
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.roundRect(0, 0, request.width, request.height, [
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
    ctx.fillRect(0, 0, request.width, request.height);
    ctx.restore();
  }
}

/** The canvas behind a `ComposedRegion`, which only this file may look at. */
interface InternalRegion extends ComposedRegion {
  readonly canvas: Canvas;
}

/** Whatever this canvas implementation accepts as a source to draw from. */
type DrawableImage = Parameters<SKRSContext2D['drawImage']>[0];

function toBitmap(ctx: SKRSContext2D, width: number, height: number): RgbaBitmap {
  const image = ctx.getImageData(0, 0, width, height);
  return {
    width,
    height,
    data: new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength),
  };
}

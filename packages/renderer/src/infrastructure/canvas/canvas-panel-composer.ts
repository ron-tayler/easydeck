import { createCanvas, loadImage, type Canvas, type SKRSContext2D } from '@napi-rs/canvas';

import type {
  ComposedRegion,
  PanelComposer,
  RegionRequest,
  RegionSource,
  ShrinkTileRequest,
  TileRequest,
} from '../../application/panel-composer.js';
import type { LabelSpec } from '../../domain/button-visual.js';
import { RenderError } from '../../domain/render-target.js';
import { rasterizeSvg } from './svg-rasterizer.js';
import type { RgbaBitmap } from '../../domain/render-target.js';
import { layoutLabel } from '@easydeck/engine/label';

import { resolveFontFamily } from './font-registry.js';
import { openGif, isGif } from './gif-sequence.js';
import type { GifSequence } from './gif-sequence.js';
import { readSource } from './read-source.js';

/** A third of the key, tucked into a corner: seen at a glance, in the way of nothing. */
const ALERT_SIZE = 0.34;
const ALERT_MARGIN = 0.06;
const ALERT_FILL = '#f5c518';
const ALERT_EDGE = '#1a1a1a';

const DEFAULT_BACKGROUND = '#000000';
const DEFAULT_LABEL_COLOR = '#ffffff';
const DEFAULT_CORNER_RADIUS = 12;

/**
 * Whether these bytes are markup rather than a compressed picture.
 *
 * Looks at the start of the file: an SVG begins with `<svg` or an XML
 * declaration, possibly after whitespace or a byte-order mark. Cheaper and
 * more honest than trusting a file extension, which a data URL does not have.
 */
function isSvg(bytes: Uint8Array): boolean {
  const head = decodeUtf8(bytes.subarray(0, 200)).replace(/^﻿/, '').trimStart();
  return head.startsWith('<svg') || head.startsWith('<?xml');
}

const decodeUtf8 = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

/** Skia-backed composer: one canvas per region, reused across its frames. */
export class CanvasPanelComposer implements PanelComposer {
  async open(request: RegionRequest): Promise<RegionSource> {
    const canvas = createCanvas(request.width, request.height);
    const ctx = canvas.getContext('2d');

    if (request.source === undefined) return this.openStill(canvas, ctx, request, undefined);

    const bytes = await readSource(request.source);
    if (!bytes) throw new RenderError('Could not read the picture');

    if (isGif(bytes)) return this.openAnimated(canvas, ctx, request, openGif(bytes));

    /*
     * SVG goes through librsvg, everything else through the canvas library.
     *
     * The canvas library draws an SVG's presentation attributes and ignores
     * its `<style>` block outright — a class that sets a fill draws black, a
     * transform in a rule moves nothing. That is exactly how a parametric
     * icon is written, so a bar that filled correctly in the window arrived
     * on the panel as an empty outline.
     */
    const rendered = isSvg(bytes)
      ? await rasterizeSvg(decodeUtf8(bytes), request.width, request.height)
      : undefined;

    let image;
    try {
      image = await loadImage(Buffer.from(rendered ?? bytes));
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

    if (request.label) {
      // Whether there is a picture under the text decides where it goes by
      // default, and only the caller knows.
      this.drawLabel(ctx, request.width, request.height, request.label, request.hasPicture === true);
    }
    if (request.alert) this.drawAlert(ctx, request.width, request.height);
    this.roundCorners(ctx, request);

    if (request.rotationDegrees === 0) return toBitmap(ctx, request.width, request.height);

    const rotated = createCanvas(request.width, request.height);
    const rctx = rotated.getContext('2d');
    rctx.translate(request.width / 2, request.height / 2);
    rctx.rotate((request.rotationDegrees * Math.PI) / 180);
    rctx.drawImage(tile, -request.width / 2, -request.height / 2);
    return toBitmap(rctx, request.width, request.height);
  }

  /**
   * Redraws an encoded tile at a fraction of its size, centred on black.
   *
   * Decoding our own JPEG is the cheap way round: a couple of milliseconds
   * against reopening a GIF and replaying it to the frame currently on the
   * key, which is what any other route would cost.
   */
  async shrinkTile(tile: Uint8Array, request: ShrinkTileRequest): Promise<RgbaBitmap> {
    let image;
    try {
      image = await loadImage(Buffer.from(tile));
    } catch (cause) {
      throw new RenderError('Could not read the tile to shrink it', { cause });
    }

    const canvas = createCanvas(request.width, request.height);
    const ctx = canvas.getContext('2d');

    // Black rather than transparent: the key has no backdrop of its own, and
    // the panel around it is black anyway.
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, request.width, request.height);

    const width = request.width * request.scale;
    const height = request.height * request.scale;
    ctx.drawImage(image, (request.width - width) / 2, (request.height - height) / 2, width, height);

    return toBitmap(ctx, request.width, request.height);
  }

  /**
   * A yellow warning triangle, over everything.
   *
   * Drawn rather than composed from a font: the panel has no glyph for it, and
   * three lines and a bang cost nothing next to loading an icon. Sized against
   * the tile so it is the same mark on any panel, and outlined in black so it
   * reads on a light picture as well as a dark one.
   */
  private drawAlert(ctx: SKRSContext2D, width: number, height: number): void {
    const size = Math.min(width, height) * ALERT_SIZE;
    const x = width - size - Math.min(width, height) * ALERT_MARGIN;
    const y = Math.min(width, height) * ALERT_MARGIN;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x + size / 2, y);
    ctx.lineTo(x + size, y + size);
    ctx.lineTo(x, y + size);
    ctx.closePath();

    ctx.fillStyle = ALERT_FILL;
    ctx.fill();
    ctx.lineWidth = Math.max(1, size * 0.08);
    ctx.strokeStyle = ALERT_EDGE;
    ctx.stroke();

    // The bang: a bar and a dot, both in the dark edge colour.
    ctx.fillStyle = ALERT_EDGE;
    const barWidth = size * 0.12;
    ctx.fillRect(x + size / 2 - barWidth / 2, y + size * 0.34, barWidth, size * 0.34);
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size * 0.82, barWidth * 0.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private fill(ctx: SKRSContext2D, request: RegionRequest): void {
    ctx.fillStyle = request.background ?? DEFAULT_BACKGROUND;
    ctx.fillRect(0, 0, request.width, request.height);
  }

  /**
   * The picture over the whole region, edge to edge, cropped to fit.
   *
   * The one behaviour there is, for every region size and a single key
   * included: a picture on a key fills the key. Letterboxing used to be
   * available as an option, and it was the wrong kind of choice — a setting
   * that changed how a picture met the key's edge, offered on every icon,
   * where what people wanted was for the picture to fill the key.
   */
  private drawCovering(
    ctx: SKRSContext2D,
    image: DrawableImage,
    width: number,
    height: number,
    request: RegionRequest,
  ): void {
    const scale = Math.max(request.width / width, request.height / height);

    const dw = width * scale;
    const dh = height * scale;
    ctx.drawImage(image, (request.width - dw) / 2, (request.height - dh) / 2, dw, dh);
  }

  /**
   * Draws the label where the shared layout says, not where this file decides.
   *
   * The arithmetic — wrapping, shrinking, which end of the key the block sits
   * at — belongs to both surfaces and lives in one place; what is left here is
   * the part only a canvas can do: measuring glyphs and putting them down.
   */
  private drawLabel(
    ctx: SKRSContext2D,
    width: number,
    height: number,
    label: LabelSpec,
    hasPicture: boolean,
  ): void {
    const family = resolveFontFamily(label.fontFamily);

    const laid = layoutLabel(
      label,
      { width, height },
      (text, fontSize) => {
        ctx.font = `${fontSize}px ${family}`;
        const measured = ctx.measureText(text);
        return {
          width: measured.width,
          ascent: measured.actualBoundingBoxAscent,
          descent: measured.actualBoundingBoxDescent,
          fontAscent: measured.fontBoundingBoxAscent,
        };
      },
      { hasPicture },
    );

    ctx.font = `${laid.fontSize}px ${family}`;
    ctx.fillStyle = label.color ?? DEFAULT_LABEL_COLOR;
    ctx.textAlign = 'center';
    // Drawn from the baseline, which is what the layout hands over: every
    // other origin puts the font's empty room into the measurement.
    ctx.textBaseline = 'alphabetic';

    laid.lines.forEach((line, index) => {
      ctx.fillText(line, width / 2, laid.baselines[index] ?? 0);
    });
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

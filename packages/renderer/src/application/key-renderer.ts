import type { ButtonVisual } from '../domain/button-visual.js';
import { RenderError } from '../domain/render-target.js';
import type { RenderTarget } from '../domain/render-target.js';
import type { JpegEncoder } from './ports/jpeg-encoder.js';
import type { PanelComposer } from './panel-composer.js';

const INITIAL_QUALITY = 90;
const MIN_QUALITY = 10;
const QUALITY_STEP = 10;

/** All four, because a key on its own has no neighbours to keep square. */
const ALL_CORNERS = {
  topLeft: true,
  topRight: true,
  bottomRight: true,
  bottomLeft: true,
} as const;

/**
 * One key: a visual and a target in, a device-ready JPEG out.
 *
 * A convenience over the composer rather than a second way of drawing.
 * Previews and the examples want one key; the deck wants a region cut into
 * tiles; both now go through the same code, because the alternative was two
 * implementations of the same picture that could — and did — disagree. A
 * parametric icon drew correctly through one of them and came out as an empty
 * outline through the other, for a fortnight, before anybody noticed.
 *
 * Quality fitting follows Companion's proven approach: start at 90% and step
 * down by 10 until the payload fits the device's byte limit.
 */
export class KeyRenderer {
  constructor(
    private readonly composer: PanelComposer,
    private readonly encoder: JpegEncoder,
  ) {}

  async render(visual: ButtonVisual, target: RenderTarget): Promise<Uint8Array> {
    const region = await this.composer.open({
      ...(visual.icon ? { source: visual.icon.source } : {}),
      ...(visual.background === undefined ? {} : { background: visual.background }),
      width: target.width,
      height: target.height,
    });

    try {
      const composed = region.composeFrame(0);
      const tile = this.composer.cutTile(composed, {
        x: 0,
        y: 0,
        width: target.width,
        height: target.height,
        rotationDegrees: target.rotationDegrees,
        corners: ALL_CORNERS,
        ...(visual.cornerRadius === undefined ? {} : { cornerRadius: visual.cornerRadius }),
        ...(visual.label ? { label: visual.label } : {}),
        ...(visual.icon ? { hasPicture: true } : {}),
      });

      for (let quality = INITIAL_QUALITY; quality >= MIN_QUALITY; quality -= QUALITY_STEP) {
        const jpeg = await this.encoder.encode(tile, { quality });
        if (jpeg.byteLength <= target.maxBytes) return jpeg;
      }
    } finally {
      region.close();
    }

    throw new RenderError(
      `Could not fit a ${target.width}x${target.height} key image into ${target.maxBytes} bytes even at quality ${MIN_QUALITY}`,
    );
  }
}

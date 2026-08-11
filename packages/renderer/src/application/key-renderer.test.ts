import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { JpegEncoder, JpegEncodeOptions } from './ports/jpeg-encoder.js';
import type {
  ComposedRegion,
  PanelComposer,
  RegionRequest,
  RegionSource,
  ShrinkTileRequest,
  TileRequest,
} from './panel-composer.js';
import type { RgbaBitmap } from '../domain/render-target.js';
import { KeyRenderer } from './key-renderer.js';

const TARGET = { width: 100, height: 100, rotationDegrees: 180 as const, maxBytes: 1000 };

/** Records what it was asked for, which is what a single key ought to ask. */
class FakeComposer implements PanelComposer {
  regions: RegionRequest[] = [];
  tiles: TileRequest[] = [];
  closed = 0;

  async open(request: RegionRequest): Promise<RegionSource> {
    this.regions.push(request);

    return {
      frameCount: 1,
      delaysMs: [0],
      composeFrame: () => ({ width: request.width, height: request.height }),
      close: () => {
        this.closed += 1;
      },
    };
  }

  cutTile(_region: ComposedRegion, request: TileRequest): RgbaBitmap {
    this.tiles.push(request);
    return { width: request.width, height: request.height, data: new Uint8Array(4) };
  }

  async shrinkTile(_tile: Uint8Array, request: ShrinkTileRequest): Promise<RgbaBitmap> {
    return { width: request.width, height: request.height, data: new Uint8Array(4) };
  }
}

/** Produces `bytesAtQuality(q)` bytes so we can steer the fitting loop. */
class FakeEncoder implements JpegEncoder {
  qualities: number[] = [];

  constructor(private readonly bytesAtQuality: (quality: number) => number) {}

  async encode(_bitmap: RgbaBitmap, options: JpegEncodeOptions): Promise<Uint8Array> {
    this.qualities.push(options.quality);
    return new Uint8Array(this.bytesAtQuality(options.quality));
  }
}

describe('KeyRenderer', () => {
  it('asks the composer for one region and cuts the whole of it', async () => {
    const composer = new FakeComposer();
    const renderer = new KeyRenderer(composer, new FakeEncoder(() => 10));

    await renderer.render({ background: '#f00', cornerRadius: 12 }, TARGET);

    assert.deepEqual(composer.regions[0], { background: '#f00', width: 100, height: 100 });
    assert.deepEqual(composer.tiles[0], {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotationDegrees: 180,
      corners: { topLeft: true, topRight: true, bottomRight: true, bottomLeft: true },
      cornerRadius: 12,
    });
  });

  it('tells the tile there is a picture under the text', async () => {
    // Which is what decides where an unpositioned label goes; a key with a
    // picture drops it to the bottom, where it covers the least.
    const composer = new FakeComposer();
    const renderer = new KeyRenderer(composer, new FakeEncoder(() => 10));

    await renderer.render({ icon: { source: 'data:image/png;base64,AA' } }, TARGET);

    assert.equal(composer.regions[0]?.source, 'data:image/png;base64,AA');
    assert.equal(composer.tiles[0]?.hasPicture, true);
  });

  it('returns the first encoding that fits the byte limit', async () => {
    const encoder = new FakeEncoder(() => 500);
    const renderer = new KeyRenderer(new FakeComposer(), encoder);

    const jpeg = await renderer.render({}, TARGET);

    assert.equal(jpeg.byteLength, 500);
    assert.deepEqual(encoder.qualities, [90]);
  });

  it('steps quality down by 10 until the image fits', async () => {
    const encoder = new FakeEncoder((q) => (q > 60 ? 5000 : 900));
    const renderer = new KeyRenderer(new FakeComposer(), encoder);

    const jpeg = await renderer.render({}, TARGET);

    assert.equal(jpeg.byteLength, 900);
    assert.deepEqual(encoder.qualities, [90, 80, 70, 60]);
  });

  it('throws when even the minimum quality cannot fit', async () => {
    const encoder = new FakeEncoder(() => 99999);
    const renderer = new KeyRenderer(new FakeComposer(), encoder);

    await assert.rejects(renderer.render({}, TARGET), /Could not fit/);
    assert.equal(encoder.qualities.at(-1), 10);
  });

  it('closes the region whether the encoding worked or not', async () => {
    // A region holds a canvas and, for an animation, a decoder; leaking one
    // per failed render is how a long session runs out of memory.
    const composer = new FakeComposer();

    await new KeyRenderer(composer, new FakeEncoder(() => 10)).render({}, TARGET);
    await assert.rejects(
      new KeyRenderer(composer, new FakeEncoder(() => 99999)).render({}, TARGET),
    );

    assert.equal(composer.closed, 2);
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { JpegEncoder, JpegEncodeOptions } from './ports/jpeg-encoder.js';
import type { Rasterizer, RasterizeRequest } from './ports/rasterizer.js';
import type { RgbaBitmap } from '../domain/render-target.js';
import { KeyRenderer } from './key-renderer.js';

const TARGET = { width: 100, height: 100, rotationDegrees: 180 as const, maxBytes: 1000 };

class FakeRasterizer implements Rasterizer {
  requests: RasterizeRequest[] = [];

  async rasterize(request: RasterizeRequest): Promise<RgbaBitmap> {
    this.requests.push(request);
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
  it('passes target geometry and rotation to the rasterizer', async () => {
    const rasterizer = new FakeRasterizer();
    const renderer = new KeyRenderer(rasterizer, new FakeEncoder(() => 10));

    await renderer.render({ background: '#f00' }, TARGET);

    assert.deepEqual(rasterizer.requests[0], {
      visual: { background: '#f00' },
      width: 100,
      height: 100,
      rotationDegrees: 180,
    });
  });

  it('returns the first encoding that fits the byte limit', async () => {
    const encoder = new FakeEncoder(() => 500);
    const renderer = new KeyRenderer(new FakeRasterizer(), encoder);

    const jpeg = await renderer.render({}, TARGET);

    assert.equal(jpeg.byteLength, 500);
    assert.deepEqual(encoder.qualities, [90]);
  });

  it('steps quality down by 10 until the image fits', async () => {
    const encoder = new FakeEncoder((q) => (q > 60 ? 5000 : 900));
    const renderer = new KeyRenderer(new FakeRasterizer(), encoder);

    const jpeg = await renderer.render({}, TARGET);

    assert.equal(jpeg.byteLength, 900);
    assert.deepEqual(encoder.qualities, [90, 80, 70, 60]);
  });

  it('throws when even the minimum quality cannot fit', async () => {
    const encoder = new FakeEncoder(() => 99999);
    const renderer = new KeyRenderer(new FakeRasterizer(), encoder);

    await assert.rejects(renderer.render({}, TARGET), /Could not fit/);
    assert.equal(encoder.qualities.at(-1), 10);
  });
});

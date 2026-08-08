import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { RgbaBitmap } from '../domain/render-target.js';
import type { JpegEncoder } from './ports/jpeg-encoder.js';
import { TileEncoder } from './tile-encoder.js';

const TILE: RgbaBitmap = { width: 4, height: 4, data: new Uint8Array(4 * 4 * 4) };

/** Encoder whose output shrinks as quality drops, and which records its calls. */
function fakeEncoder(bytesAtQuality: (quality: number) => number): {
  encoder: JpegEncoder;
  calls: number[];
} {
  const calls: number[] = [];
  return {
    calls,
    encoder: {
      encode: async (_bitmap, options) => {
        calls.push(options.quality);
        return new Uint8Array(bytesAtQuality(options.quality));
      },
    },
  };
}

test('the first quality that fits is the one used', async () => {
  const { encoder, calls } = fakeEncoder((quality) => quality * 100);
  const result = await new TileEncoder(encoder).encode(TILE, { maxBytes: 6500 });

  assert.equal(result.quality, 60);
  assert.equal(result.bytes.byteLength, 6000);
  assert.deepEqual(calls, [90, 80, 70, 60]);
});

test('a hint starts the search where the last tile ended', async () => {
  const { encoder, calls } = fakeEncoder((quality) => quality * 100);
  const result = await new TileEncoder(encoder).encode(TILE, { maxBytes: 6500, startQuality: 60 });

  assert.equal(result.quality, 60);
  assert.deepEqual(calls, [60], 'the frames of one animation are alike; do not re-search');
});

test('a hint off the ladder is snapped up onto it', async () => {
  // Walking 85, 75, 65 would never try the qualities everything else was
  // encoded at, quietly doubling the work for tiles that look identical.
  const { encoder, calls } = fakeEncoder(() => 10);
  await new TileEncoder(encoder).encode(TILE, { maxBytes: 100, startQuality: 85 });

  assert.deepEqual(calls, [90]);
});

test('a hint outside the range is brought back into it', async () => {
  const { encoder, calls } = fakeEncoder(() => 10);
  const encoderService = new TileEncoder(encoder);

  await encoderService.encode(TILE, { maxBytes: 100, startQuality: 500 });
  await encoderService.encode(TILE, { maxBytes: 100, startQuality: -5 });

  assert.deepEqual(calls, [90, 10]);
});

test('a tile that cannot be made to fit is an error, not a broken image', async () => {
  const { encoder } = fakeEncoder(() => 999_999);

  await assert.rejects(() => new TileEncoder(encoder).encode(TILE, { maxBytes: 1024 }), /10240|1024/);
});

test('the search stops at the floor rather than going below it', async () => {
  const { encoder, calls } = fakeEncoder(() => 999_999);
  await new TileEncoder(encoder).encode(TILE, { maxBytes: 1 }).catch(() => undefined);

  assert.deepEqual(calls, [90, 80, 70, 60, 50, 40, 30, 20, 10]);
});

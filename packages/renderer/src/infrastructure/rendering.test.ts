import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decode as jpegDecode } from 'jpeg-js';

import { KeyRenderer } from '../application/key-renderer.js';
import { NapiCanvasRasterizer } from './canvas/napi-canvas-rasterizer.js';
import { JsJpegEncoder } from './jpeg/js-jpeg-encoder.js';
import { TurboJpegEncoder } from './jpeg/turbo-jpeg-encoder.js';

const D6_TARGET = { width: 100, height: 100, rotationDegrees: 180 as const, maxBytes: 10240 };

const rasterizer = new NapiCanvasRasterizer();

describe('NapiCanvasRasterizer', () => {
  it('fills the background color (center pixel) and masks rounded corners to black', async () => {
    const bitmap = await rasterizer.rasterize({
      visual: { background: '#ff0000', cornerRadius: 20 },
      width: 100,
      height: 100,
      rotationDegrees: 0,
    });

    const px = (x: number, y: number) => [...bitmap.data.subarray((y * 100 + x) * 4, (y * 100 + x) * 4 + 3)];
    assert.deepEqual(px(50, 50), [255, 0, 0]);
    assert.deepEqual(px(0, 0), [0, 0, 0]); // outside the rounded corner
  });

  // Regression: ctx.clip() rounds corners with a hard edge, which reads as
  // visible stair-stepping on the device. The mask must be antialiased, i.e.
  // the corner arc must produce partially-blended pixels.
  it('antialiases the rounded corners', async () => {
    const bitmap = await rasterizer.rasterize({
      visual: { background: '#ff0000', cornerRadius: 20 },
      width: 100,
      height: 100,
      rotationDegrees: 0,
    });

    let blended = 0;
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 20; x++) {
        const red = bitmap.data[(y * 100 + x) * 4]!;
        if (red > 10 && red < 245) blended++;
      }
    }
    assert.ok(blended > 8, `expected antialiased corner pixels, found ${blended}`);
  });

  it('bakes in the 180 degree rotation', async () => {
    // Top-positioned white label on black: after rotation the bright pixels
    // must sit in the bottom half.
    const bitmap = await rasterizer.rasterize({
      visual: { label: { text: 'AAAA', position: 'top' }, cornerRadius: 0 },
      width: 100,
      height: 100,
      rotationDegrees: 180,
    });

    const rowBrightness = (y: number) => {
      let sum = 0;
      for (let x = 0; x < 100; x++) sum += bitmap.data[(y * 100 + x) * 4]!;
      return sum;
    };
    let top = 0;
    let bottom = 0;
    for (let y = 0; y < 50; y++) top += rowBrightness(y);
    for (let y = 50; y < 100; y++) bottom += rowBrightness(y);

    assert.ok(bottom > top, `expected label pixels in the bottom half after rotation (top=${top}, bottom=${bottom})`);
  });

  // Regression: Skia does not resolve the generic CSS families, so labels
  // used to render as nothing at all. Assert on actual glyph pixels.
  const countLabelPixels = async (text: string, fontFamily?: string): Promise<number> => {
    const bitmap = await rasterizer.rasterize({
      visual: { background: '#000000', cornerRadius: 0, label: { text, color: '#ffffff', fontSize: 20, fontFamily } },
      width: 100,
      height: 100,
      rotationDegrees: 0,
    });
    let lit = 0;
    for (let i = 0; i < bitmap.data.length; i += 4) if (bitmap.data[i]! > 128) lit++;
    return lit;
  };

  it('actually draws Latin glyph pixels', async () => {
    assert.ok((await countLabelPixels('Scene 1')) > 50);
  });

  it('actually draws Cyrillic glyph pixels', async () => {
    assert.ok((await countLabelPixels('Мик вкл')) > 50);
  });

  it('draws glyphs even when an unknown font family is requested', async () => {
    assert.ok((await countLabelPixels('Fallback', 'No Such Font 12345')) > 50);
  });

  it('keeps bottom-positioned descenders inside the key', async () => {
    const bitmap = await rasterizer.rasterize({
      // "ру" has descenders; they must not touch the last pixel rows.
      visual: { background: '#000000', cornerRadius: 0, label: { text: 'ару', color: '#ffffff', fontSize: 20, position: 'bottom' } },
      width: 100,
      height: 100,
      rotationDegrees: 0,
    });

    const rowIsLit = (y: number): boolean => {
      for (let x = 0; x < 100; x++) if (bitmap.data[(y * 100 + x) * 4]! > 128) return true;
      return false;
    };
    assert.ok(!rowIsLit(99), 'text must not reach the bottom edge');
    assert.ok(!rowIsLit(98), 'text must leave padding at the bottom edge');
  });
});

describe('jpeg encoders', () => {
  const redBitmap = {
    width: 100,
    height: 100,
    data: new Uint8Array(100 * 100 * 4).map((_, i) => (i % 4 === 0 ? 255 : i % 4 === 3 ? 255 : 0)),
  };

  it('JsJpegEncoder produces a JPEG', async () => {
    const jpeg = await new JsJpegEncoder().encode(redBitmap, { quality: 90 });
    assert.deepEqual([jpeg[0], jpeg[1]], [0xff, 0xd8]);
  });

  it('TurboJpegEncoder produces a JPEG (skipped if prebuild unavailable)', async (t) => {
    let encoder: TurboJpegEncoder;
    try {
      encoder = new TurboJpegEncoder();
      await encoder.encode(redBitmap, { quality: 90 });
    } catch {
      t.skip('libjpeg-turbo prebuild not available on this platform');
      return;
    }
    const jpeg = await encoder.encode(redBitmap, { quality: 90 });
    assert.deepEqual([jpeg[0], jpeg[1]], [0xff, 0xd8]);
  });

  // Regression: subsampled chroma is averaged over an MCU, so an edge that
  // falls inside a partial MCU decodes washed out. The device frame size is
  // chosen to be MCU-aligned (112 = 7 x 16 at 4:2:0) precisely to avoid this.
  it('TurboJpegEncoder keeps edge column color exact at an MCU-aligned size', async (t) => {
    // Left half red, right half blue: the vertical seam and the right edge
    // are exactly where subsampled chroma smears.
    const width = 112;
    const height = 112;
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        data[i] = x < width / 2 ? 255 : 0;
        data[i + 2] = x < width / 2 ? 0 : 255;
        data[i + 3] = 255;
      }
    }

    let encoded: Uint8Array;
    try {
      encoded = await new TurboJpegEncoder().encode({ width, height, data }, { quality: 90 });
    } catch {
      t.skip('libjpeg-turbo prebuild not available on this platform');
      return;
    }

    const decoded = jpegDecode(Buffer.from(encoded));
    const px = (x: number, y: number): [number, number, number] => {
      const i = (y * width + x) * 4;
      return [decoded.data[i]!, decoded.data[i + 1]!, decoded.data[i + 2]!];
    };

    // Rightmost column sits in the partial MCU; blue must stay blue.
    const [r, , b] = px(width - 1, 50);
    assert.ok(b > 200, `right edge blue channel washed out: ${b}`);
    assert.ok(r < 60, `right edge picked up red bleed: ${r}`);
  });
});

describe('end-to-end render', () => {
  it('a busy visual still fits the D6 byte limit', async () => {
    const renderer = new KeyRenderer(rasterizer, new JsJpegEncoder());

    // Noise background stresses the encoder more than any realistic button.
    const noise = {
      background: '#336699',
      label: { text: 'Stream ON', fontSize: 24 },
    };
    const jpeg = await renderer.render(noise, D6_TARGET);

    assert.ok(jpeg.byteLength <= D6_TARGET.maxBytes);
    assert.deepEqual([jpeg[0], jpeg[1]], [0xff, 0xd8]);
  });
});

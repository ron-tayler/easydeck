import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GifWriter } from 'omggif';

import { decodeGif, isGif } from './gif-frames.js';

/** Two 2x2 frames: solid red, then solid blue, 60ms apart. */
function twoFrameGif(): Uint8Array {
  const buffer = Buffer.alloc(4096);
  const writer = new GifWriter(buffer, 2, 2, { loop: 0 });
  const palette = [0xff0000, 0x0000ff];

  writer.addFrame(0, 0, 2, 2, [0, 0, 0, 0], { palette, delay: 6 });
  writer.addFrame(0, 0, 2, 2, [1, 1, 1, 1], { palette, delay: 6 });

  return buffer.subarray(0, writer.end());
}

describe('GIF frames', () => {
  it('recognises a GIF by its header and nothing else by it', () => {
    assert.equal(isGif(twoFrameGif()), true);
    assert.equal(isGif(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0])), false, 'a PNG is not a GIF');
    assert.equal(isGif(new Uint8Array(3)), false, 'too short to tell');
  });

  it('returns every frame with its own delay', () => {
    const gif = decodeGif(twoFrameGif());

    assert.equal(gif.width, 2);
    assert.equal(gif.height, 2);
    assert.equal(gif.frames.length, 2);

    // Hundredths of a second in the file, milliseconds out.
    assert.equal(gif.frames[0]!.delayMs, 60);
    assert.equal(gif.frames[1]!.delayMs, 60);
  });

  it('composes each frame fully, so a patch never shows the frame before it', () => {
    const gif = decodeGif(twoFrameGif());

    const first = gif.frames[0]!.rgba;
    const second = gif.frames[1]!.rgba;

    assert.deepEqual([first[0], first[1], first[2]], [255, 0, 0], 'first frame is red');
    assert.deepEqual([second[0], second[1], second[2]], [0, 0, 255], 'second frame is blue');
  });

  /** A delay of zero is authored carelessly all the time; honouring it would
      spend the whole bus on one key. */
  it('raises implausibly short delays to a floor', () => {
    const buffer = Buffer.alloc(4096);
    const writer = new GifWriter(buffer, 1, 1, { loop: 0 });
    writer.addFrame(0, 0, 1, 1, [0], { palette: [0x00ff00, 0x000000], delay: 0 });
    writer.addFrame(0, 0, 1, 1, [1], { palette: [0x00ff00, 0x000000], delay: 0 });

    const gif = decodeGif(buffer.subarray(0, writer.end()));
    assert.ok(gif.frames[0]!.delayMs >= 20, `got ${gif.frames[0]!.delayMs}ms`);
  });
});

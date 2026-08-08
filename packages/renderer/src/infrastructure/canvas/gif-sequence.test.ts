import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GifWriter } from 'omggif';

import { isGif, openGif } from './gif-sequence.js';

const WIDTH = 8;
const HEIGHT = 4;

/** A GIF whose every frame is one flat colour, so a frame is identifiable. */
function buildGif(frames: number, delayCentiseconds = 5): Uint8Array {
  const buffer = Buffer.alloc(64 * 1024);
  const palette = [0x000000, 0xff0000, 0x00ff00, 0x0000ff, 0xffffff, 0xffff00, 0x00ffff, 0xff00ff];
  const writer = new GifWriter(buffer, WIDTH, HEIGHT, { loop: 0, palette });

  for (let frame = 0; frame < frames; frame++) {
    const pixels = new Uint8Array(WIDTH * HEIGHT).fill((frame % (palette.length - 1)) + 1);
    writer.addFrame(0, 0, WIDTH, HEIGHT, pixels as unknown as number[], {
      delay: delayCentiseconds,
      palette,
    });
  }

  return buffer.subarray(0, writer.end());
}

function firstPixel(rgba: Uint8ClampedArray): string {
  return `${rgba[0]},${rgba[1]},${rgba[2]}`;
}

test('a GIF is recognised by its header', () => {
  assert.equal(isGif(buildGif(2)), true);
  assert.equal(isGif(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0])), false);
  assert.equal(isGif(new Uint8Array([0x47])), false);
});

test('delays are known without decoding a single frame', () => {
  const sequence = openGif(buildGif(3, 7));

  assert.equal(sequence.frameCount, 3);
  assert.deepEqual([...sequence.delaysMs], [70, 70, 70]);
});

test('a careless delay is clamped rather than honoured', () => {
  // A GIF asking for 0ms would spend the whole bus on one key.
  assert.deepEqual([...openGif(buildGif(2, 0)).delaysMs], [100, 100]);
  assert.deepEqual([...openGif(buildGif(2, 1)).delaysMs], [20, 20]);
});

test('a frame that is only a patch is composed over the one before it', () => {
  // A GIF frame is usually a patch covering part of the canvas, with a rule
  // for what to do with its predecessor. Ignoring that is what produces the
  // familiar smeared-trails bug.
  const buffer = Buffer.alloc(64 * 1024);
  const palette = [0x000000, 0xff0000, 0x00ff00, 0x0000ff];
  const writer = new GifWriter(buffer, WIDTH, HEIGHT, { loop: 0, palette });

  // A full red frame, then a single green pixel painted into its top-left.
  writer.addFrame(0, 0, WIDTH, HEIGHT, new Uint8Array(WIDTH * HEIGHT).fill(1) as unknown as number[], {
    delay: 5,
    palette,
  });
  writer.addFrame(0, 0, 1, 1, new Uint8Array([2]) as unknown as number[], { delay: 5, palette });

  const sequence = openGif(buffer.subarray(0, writer.end()));
  const patched = sequence.frame(1);

  assert.equal(firstPixel(patched), '0,255,0', 'the patch itself');
  assert.equal(
    `${patched[4]},${patched[5]},${patched[6]}`,
    '255,0,0',
    'everything the patch did not cover must survive from the frame before',
  );
});

test('asking for the same frame twice does not advance', () => {
  const sequence = openGif(buildGif(3));

  const once = firstPixel(sequence.frame(1));
  assert.equal(firstPixel(sequence.frame(1)), once);
});

test('going backwards replays from the start', () => {
  const sequence = openGif(buildGif(4));

  const first = firstPixel(sequence.frame(0));
  sequence.frame(3);

  // Looping is the normal case for a deck: an animation that played once and
  // froze reads as a bug, so rewinding has to be correct, not merely allowed.
  assert.equal(firstPixel(sequence.frame(0)), first);
});

test('skipping ahead lands on the same pixels as walking there', () => {
  // The animation is driven by the clock, so a busy panel skips frames — the
  // frame it lands on must not depend on how it got there.
  const bytes = buildGif(5);
  const walked = openGif(bytes);
  for (let index = 0; index <= 4; index++) walked.frame(index);

  const skipped = openGif(bytes);

  assert.deepEqual([...skipped.frame(4)], [...walked.frame(4)]);
});

test('a frame outside the GIF is refused', () => {
  const sequence = openGif(buildGif(2));

  assert.throws(() => sequence.frame(2));
  assert.throws(() => sequence.frame(-1));
});

test('only one frame is held at a time', () => {
  // The whole point of this reader: a 76-frame icon costs one frame of memory,
  // not seventy-six. The returned array is the running canvas itself.
  const sequence = openGif(buildGif(3));

  assert.equal(sequence.frame(0), sequence.frame(1));
});

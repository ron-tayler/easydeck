import assert from 'node:assert/strict';
import { test } from 'node:test';

import { frameAt, nextChangeMs, prepareAnimation } from './prepared-animation.js';

function animation(delays: number[], ready = delays.length) {
  const prepared = prepareAnimation([0, 1], ['tile-0', 'tile-1'], delays);
  prepared.ready = ready;
  return prepared;
}

test('the frame is taken from the clock, not stepped', () => {
  const prepared = animation([100, 100, 100]);

  assert.equal(frameAt(prepared, 0, 0), 0);
  assert.equal(frameAt(prepared, 0, 99), 0);
  assert.equal(frameAt(prepared, 0, 100), 1);
  assert.equal(frameAt(prepared, 0, 250), 2);
});

test('a panel that fell behind skips ahead instead of catching up', () => {
  // A late frame is worth less than the right one, and stepping would let the
  // queue grow without bound.
  const prepared = animation([100, 100, 100]);

  // 900_000 is a whole number of 300ms cycles, so this lands 150ms in.
  assert.equal(frameAt(prepared, 0, 900_000 + 150), 1);
});

test('playback loops forever, whatever the GIF asked for', () => {
  // A key that animates once and then freezes reads as a bug, and there is no
  // way to ask it to start again.
  const prepared = animation([100, 100]);

  assert.equal(frameAt(prepared, 0, 200), 0);
  assert.equal(frameAt(prepared, 0, 300), 1);
});

test('only the frames prepared so far are played', () => {
  // Standing still until every frame is encoded reads as a freeze; the loop
  // lengthens as frames arrive.
  const prepared = animation([100, 100, 100, 100], 2);

  assert.equal(frameAt(prepared, 0, 150), 1);
  assert.equal(frameAt(prepared, 0, 250), 0, 'the ready prefix should loop');
});

test('a single ready frame is simply held', () => {
  const prepared = animation([100, 100, 100], 1);

  assert.equal(frameAt(prepared, 0, 5_000), 0);
  assert.equal(nextChangeMs(prepared, 0, 5_000), Number.POSITIVE_INFINITY);
});

test('the next change is when the current frame runs out', () => {
  const prepared = animation([100, 50, 100]);

  assert.equal(nextChangeMs(prepared, 0, 0), 100);
  assert.equal(nextChangeMs(prepared, 0, 60), 40);
  assert.equal(nextChangeMs(prepared, 0, 120), 30);
});

test('per-frame delays are honoured rather than averaged', () => {
  // A GIF carries its own timings and the vendor software honours them: keys
  // run at 12.8 and 21 frames a second side by side in the capture.
  const prepared = animation([20, 300]);

  assert.equal(frameAt(prepared, 0, 10), 0);
  assert.equal(frameAt(prepared, 0, 30), 1);
  assert.equal(frameAt(prepared, 0, 319), 1);
  assert.equal(frameAt(prepared, 0, 320), 0);
});

test('a still has no timeline to speak of', () => {
  const prepared = animation([0], 1);

  assert.equal(frameAt(prepared, 0, 1_000), 0);
  assert.equal(nextChangeMs(prepared, 0, 1_000), Number.POSITIVE_INFINITY);
});

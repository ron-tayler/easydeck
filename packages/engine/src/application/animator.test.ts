import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { frameAt, nextChangeMs, prepare } from './animator.js';
import type { AnimatedFrame } from './ports/renderer-port.js';

const frames: AnimatedFrame[] = [
  { image: new Uint8Array([1]), delayMs: 100 },
  { image: new Uint8Array([2]), delayMs: 50 },
  { image: new Uint8Array([3]), delayMs: 250 },
];

describe('animation timing', () => {
  it('picks the frame the clock is inside, honouring each delay', () => {
    const animation = prepare(frames, 1000);

    assert.equal(frameAt(animation, 1000), 0);
    assert.equal(frameAt(animation, 1099), 0);
    assert.equal(frameAt(animation, 1100), 1, 'the first frame lasts its 100ms');
    assert.equal(frameAt(animation, 1149), 1);
    assert.equal(frameAt(animation, 1150), 2);
    assert.equal(frameAt(animation, 1399), 2);
  });

  it('loops for ever, whatever the GIF says', () => {
    const animation = prepare(frames, 0);

    // A key that animates once and then freezes reads as a bug, and there is
    // no way for anyone to ask it to start again.
    assert.equal(frameAt(animation, 400), 0, 'wraps to the start');
    assert.equal(frameAt(animation, 550), 2);
    assert.equal(frameAt(animation, 4000), 0);
  });

  /**
   * The reason the frame is computed rather than stepped: when writes fall
   * behind, the animation must jump to where it should be instead of playing
   * every frame late for ever.
   */
  it('skips ahead after a long stall instead of falling behind', () => {
    const animation = prepare(frames, 0);
    animation.shown = frameAt(animation, 0);
    assert.equal(animation.shown, 0);

    // Two whole cycles plus a bit went by while one write was stuck.
    const late = 400 * 2 + 120;
    assert.equal(frameAt(animation, late), 1, 'lands where the clock says, not at frame 1');
  });

  it('reports when the next frame is due, so the loop can sleep exactly that long', () => {
    const animation = prepare(frames, 0);

    assert.equal(nextChangeMs(animation, 0), 100);
    assert.equal(nextChangeMs(animation, 60), 40);
    assert.equal(nextChangeMs(animation, 100), 50);
    assert.equal(nextChangeMs(animation, 390), 10, 'counts to the end of the cycle');
  });

  it('survives a single-frame animation without dividing by zero', () => {
    const still = prepare([{ image: new Uint8Array([1]), delayMs: 0 }], 0);
    assert.equal(frameAt(still, 12_345), 0);
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ButtonEvent } from '../domain/action.js';
import { GestureRecognizer } from './gesture-recognizer.js';
import type { ClockPort, TimerHandle } from './ports/clock-port.js';

const LONG_PRESS_MS = 500;
const DOUBLE_PRESS_MS = 300;

/** Honours delays, so the hold timer and the double-press window differ. */
class TestClock implements ClockPort {
  private time = 0;
  private sequence = 0;
  private readonly timers = new Map<number, { at: number; run: () => void }>();

  now(): number {
    return this.time;
  }

  setTimeout(handler: () => void, delayMs: number): TimerHandle {
    const handle = ++this.sequence;
    this.timers.set(handle, { at: this.time + delayMs, run: handler });
    return handle as unknown as TimerHandle;
  }

  clearTimeout(handle: TimerHandle): void {
    this.timers.delete(handle as unknown as number);
  }

  advance(ms: number): void {
    this.time += ms;
    for (const [handle, timer] of [...this.timers]) {
      if (timer.at > this.time) continue;
      this.timers.delete(handle);
      timer.run();
    }
  }

  get armed(): number {
    return this.timers.size;
  }
}

function build(doublePressKeys: number[] = []) {
  const seen: string[] = [];
  const clock = new TestClock();
  const recognizer = new GestureRecognizer(
    (key: number, gesture: ButtonEvent) => seen.push(`${gesture}:${key}`),
    { clock, longPressMs: LONG_PRESS_MS, doublePressMs: DOUBLE_PRESS_MS },
  );
  recognizer.setDoublePressKeys(doublePressKeys);
  return { seen, clock, recognizer };
}

describe('recognising gestures', () => {
  it('reports an ordinary press on release, not on contact', () => {
    // Until the key comes back up it might still become a hold or the first
    // half of a double press, so nothing can be reported while it is down.
    const { seen, recognizer } = build();

    recognizer.down(0);
    assert.deepEqual(seen, []);

    recognizer.up(0);
    assert.deepEqual(seen, ['press:0']);
  });

  it('does not make a key wait for a double press it never binds', () => {
    // The delay is the price of the feature; nobody who skipped it should pay.
    const { seen, clock, recognizer } = build();

    recognizer.down(0);
    recognizer.up(0);

    assert.deepEqual(seen, ['press:0']);
    assert.equal(clock.armed, 0, 'nothing should still be waiting');
  });

  it('holds an ordinary press back while a second one is possible', () => {
    const { seen, clock, recognizer } = build([0]);

    recognizer.down(0);
    recognizer.up(0);
    assert.deepEqual(seen, [], 'reported before the window closed');

    clock.advance(DOUBLE_PRESS_MS);
    assert.deepEqual(seen, ['press:0']);
  });

  it('reports a double press on the second release, and no single one', () => {
    const { seen, recognizer } = build([0]);

    recognizer.down(0);
    recognizer.up(0);
    recognizer.down(0);
    assert.deepEqual(seen, [], 'nothing until the second key comes up');

    recognizer.up(0);
    assert.deepEqual(seen, ['doublePress:0']);
  });

  it('lets two taps too far apart be two ordinary presses', () => {
    const { seen, clock, recognizer } = build([0]);

    recognizer.down(0);
    recognizer.up(0);
    clock.advance(DOUBLE_PRESS_MS);
    recognizer.down(0);
    recognizer.up(0);
    clock.advance(DOUBLE_PRESS_MS);

    assert.deepEqual(seen, ['press:0', 'press:0']);
  });

  it('reports a hold while the key is still down, and ignores its release', () => {
    const { seen, clock, recognizer } = build([0]);

    recognizer.down(0);
    clock.advance(LONG_PRESS_MS);
    assert.deepEqual(seen, ['longPress:0']);

    recognizer.up(0);
    clock.advance(DOUBLE_PRESS_MS);
    assert.deepEqual(seen, ['longPress:0'], 'the release after a hold must do nothing');
  });

  it('a hold after a tap is still just a hold', () => {
    // Tap, then press and keep holding. Holding means the same thing wherever
    // it happens, and the tap that was waiting is abandoned rather than
    // reported alongside it.
    const { seen, clock, recognizer } = build([0]);

    recognizer.down(0);
    recognizer.up(0);
    recognizer.down(0);
    clock.advance(LONG_PRESS_MS);
    assert.deepEqual(seen, ['longPress:0']);

    recognizer.up(0);
    clock.advance(DOUBLE_PRESS_MS);
    assert.deepEqual(seen, ['longPress:0'], 'neither a tap nor a double press should follow');
  });

  it('a quick tap never fires the hold', () => {
    const { seen, clock, recognizer } = build([0]);

    recognizer.down(0);
    recognizer.up(0);
    clock.advance(LONG_PRESS_MS);

    assert.deepEqual(seen, ['press:0']);
  });

  it('survives a lost release report', () => {
    // The D6 tracks one key at a time and can drop a release; a second press
    // with none in between must not leave a phantom hold armed.
    const { seen, clock, recognizer } = build();

    recognizer.down(0);
    recognizer.down(0);
    recognizer.up(0);

    assert.deepEqual(seen, ['press:0']);
    assert.equal(clock.armed, 0);
  });

  it('treats keys independently, so several can be held at once', () => {
    // The one-key-at-a-time limit is the D6's matrix, not a rule of the model:
    // a touchscreen has no such limit and must not be forced into one.
    const { seen, clock, recognizer } = build([1]);

    recognizer.down(0);
    recognizer.down(1);
    recognizer.up(0);

    // Key 1 is still down while key 0 has already finished its own gesture.
    clock.advance(LONG_PRESS_MS);
    recognizer.up(1);

    assert.deepEqual(seen, ['press:0', 'longPress:1']);
  });

  it('follows the keys it is told bind a double press', () => {
    const { seen, clock, recognizer } = build([]);

    recognizer.setDoublePressKeys([0]);
    recognizer.down(0);
    recognizer.up(0);
    assert.deepEqual(seen, [], 'key 0 now waits');

    clock.advance(DOUBLE_PRESS_MS);
    assert.deepEqual(seen, ['press:0']);

    // A state change removes the binding, and the key stops waiting.
    recognizer.setDoublePressKeys([]);
    recognizer.down(0);
    recognizer.up(0);
    assert.deepEqual(seen, ['press:0', 'press:0']);
  });

  it('reset cancels everything left mid-gesture', () => {
    const { seen, clock, recognizer } = build([0]);

    recognizer.down(0);
    recognizer.up(0);
    recognizer.reset();
    clock.advance(LONG_PRESS_MS);

    assert.deepEqual(seen, []);
    assert.equal(clock.armed, 0);
  });
});

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';

import type { Surface } from '@easydeck/device';

import { toPresenterPort } from './panel-adapter.js';

/**
 * What the panel does with a finger on it.
 *
 * The key shrinks on contact, because a deck has no travel and no click: the
 * picture changing is the only acknowledgement there is. What happens next
 * depends on whether holding the key means anything.
 */

class FakeSurface extends EventEmitter {
  readonly layout = { rows: 3, cols: 5 } as const;

  async setBrightness(): Promise<void> {}
  async writeKey(): Promise<void> {}
  async clearKey(): Promise<void> {}
  async close(): Promise<void> {}
}

function build() {
  const surface = new FakeSurface();
  const pressed: { key: number; held: boolean }[] = [];

  const compositor = {
    setPressed: async (key: number, held: boolean) => {
      pressed.push({ key, held });
    },
    present: async () => undefined,
  };

  const port = toPresenterPort(surface as unknown as Surface, compositor as never);
  return { surface, port, pressed };
}

/** Holds a key for longer than the recogniser's hold window. */
async function hold(surface: FakeSurface, key: number): Promise<void> {
  surface.emit('keyDown', { key });
  await new Promise((resolve) => setTimeout(resolve, 600));
}

describe('a finger on a panel key', () => {
  it('shrinks the key on contact and restores it on release', async () => {
    const { surface, pressed } = build();

    surface.emit('keyDown', { key: 4 });
    surface.emit('keyUp', { key: 4 });

    assert.deepEqual(pressed, [
      { key: 4, held: true },
      { key: 4, held: false },
    ]);
  });

  it('lets a key back up once its hold has fired', async () => {
    // The shrink says "I felt that". Once the hold has actually run there is
    // nothing left to acknowledge, and coming back up is how you can tell it
    // happened without lifting off.
    const { surface, port, pressed } = build();
    port.setLongPressKeys?.([4]);

    await hold(surface, 4);

    assert.deepEqual(pressed, [
      { key: 4, held: true },
      { key: 4, held: false },
    ]);
  });

  it('keeps a key down where holding it does nothing', async () => {
    // There the shrink is the whole of the feedback, and taking it away mid
    // press would look like the key had let go of the finger.
    const { surface, port, pressed } = build();
    port.setLongPressKeys?.([1]);

    await hold(surface, 4);

    assert.deepEqual(pressed, [{ key: 4, held: true }]);
  });
});

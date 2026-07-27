import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ButtonVisual } from '../domain/visual.js';
import type { ProfileDefinition } from '../domain/profile.js';
import { ActionRegistry } from './action-registry.js';
import { registerBuiltinActions } from './builtin-actions.js';
import { DeckController } from './deck-controller.js';
import type { ClockPort, TimerHandle } from './ports/clock-port.js';
import type { KeyRendererPort } from './ports/renderer-port.js';
import type { SurfacePort } from './ports/surface-port.js';

class FakeSurface implements SurfacePort {
  readonly layout = { rows: 1, cols: 3 };
  readonly writes: Array<{ key: number; text: string }> = [];
  readonly cleared: number[] = [];

  private downListeners = new Set<(key: number) => void>();
  private upListeners = new Set<(key: number) => void>();

  onKeyDown(listener: (key: number) => void): () => void {
    this.downListeners.add(listener);
    return () => this.downListeners.delete(listener);
  }

  onKeyUp(listener: (key: number) => void): () => void {
    this.upListeners.add(listener);
    return () => this.upListeners.delete(listener);
  }

  async setKeyImage(key: number, image: Uint8Array): Promise<void> {
    this.writes.push({ key, text: Buffer.from(image).toString('utf8') });
  }

  async clearKey(key: number): Promise<void> {
    this.cleared.push(key);
  }

  press(key: number): void {
    for (const listener of this.downListeners) listener(key);
  }

  release(key: number): void {
    for (const listener of this.upListeners) listener(key);
  }

  /** What each key currently shows, by last write. */
  lastText(key: number): string | undefined {
    return [...this.writes].reverse().find((w) => w.key === key)?.text;
  }
}

/** Encodes the visual as readable text, so assertions stay legible. */
const fakeRenderer: KeyRendererPort = {
  async render(visual: ButtonVisual): Promise<Uint8Array> {
    return Buffer.from(`${visual.background ?? '-'}|${visual.label?.text ?? '-'}`, 'utf8');
  },
};

class ManualClock implements ClockPort {
  private pending = new Map<number, () => void>();
  private next = 1;

  setTimeout(callback: () => void): TimerHandle {
    const handle = this.next++;
    this.pending.set(handle, callback);
    return handle;
  }

  clearTimeout(handle: TimerHandle): void {
    this.pending.delete(handle as number);
  }

  /** Fires every timer currently scheduled. */
  fire(): void {
    for (const [handle, callback] of [...this.pending]) {
      this.pending.delete(handle);
      callback();
    }
  }

  get pendingCount(): number {
    return this.pending.size;
  }
}

const micProfile: ProfileDefinition = {
  id: 'test',
  name: 'Test',
  layout: { rows: 1, cols: 3 },
  variables: { micOn: 'on', viewers: 0 },
  pages: [
    {
      id: 'main',
      buttons: [
        {
          id: 'mic',
          key: 0,
          stateFrom: 'micOn',
          states: [
            {
              id: 'on',
              visual: { background: '#0f0', label: { text: 'Мик вкл' } },
              actions: { down: [{ type: 'set-variable', params: { name: 'micOn', value: 'off' } }] },
            },
            {
              id: 'off',
              visual: { background: '#f00', label: { text: 'Мик выкл' } },
              actions: { down: [{ type: 'set-variable', params: { name: 'micOn', value: 'on' } }] },
            },
          ],
        },
        {
          id: 'counter',
          key: 1,
          states: [
            {
              id: 'default',
              visual: { background: '#222', label: { text: 'Зрителей: {{viewers}}' } },
              actions: {
                down: [{ type: 'increment-variable', params: { name: 'viewers' } }],
                longPress: [{ type: 'set-variable', params: { name: 'viewers', value: 0 } }],
              },
            },
          ],
        },
        {
          id: 'nav',
          key: 2,
          states: [
            {
              id: 'default',
              visual: { background: '#00f', label: { text: 'Вторая' } },
              actions: { up: [{ type: 'go-to-page', params: { pageId: 'second' } }] },
            },
          ],
        },
      ],
    },
    {
      id: 'second',
      buttons: [
        { id: 'back', key: 0, states: [{ id: 'default', visual: { label: { text: 'Назад' } } }] },
      ],
    },
  ],
};

async function setup(profile = micProfile) {
  const surface = new FakeSurface();
  const clock = new ManualClock();
  const registry = registerBuiltinActions(new ActionRegistry());
  const controller = new DeckController(surface, fakeRenderer, registry, {
    clock,
    longPressMs: 400,
  });
  controller.load(profile);
  await controller.start();
  return { surface, clock, controller };
}

/** Lets the controller's queued repaint finish. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('DeckController', () => {
  it('paints every button of the initial page, with variables substituted', async () => {
    const { surface } = await setup();

    assert.equal(surface.lastText(0), '#0f0|Мик вкл');
    assert.equal(surface.lastText(1), '#222|Зрителей: 0');
    assert.equal(surface.lastText(2), '#00f|Вторая');
  });

  it('refuses a profile authored for a different layout', async () => {
    const surface = new FakeSurface();
    const controller = new DeckController(surface, fakeRenderer, new ActionRegistry());

    assert.throws(
      () => controller.load({ ...micProfile, layout: { rows: 3, cols: 5 } }),
      /authored for 3x5, but the surface is 1x3/,
    );
  });

  it('follows a variable-bound state, whichever way the variable changes', async () => {
    const { surface, controller } = await setup();

    surface.press(0);
    await settle();
    assert.equal(surface.lastText(0), '#f00|Мик выкл');

    // Something outside the deck mutes the mic: the button must follow.
    controller.variables.set('micOn', 'on');
    await settle();
    assert.equal(surface.lastText(0), '#0f0|Мик вкл');
  });

  it('repaints only the keys whose appearance actually changed', async () => {
    const { surface } = await setup();
    surface.writes.length = 0;

    surface.press(1);
    await settle();

    assert.deepEqual(
      surface.writes.map((w) => w.key),
      [1],
    );
    assert.equal(surface.lastText(1), '#222|Зрителей: 1');
  });

  it('fires longPress only after the threshold, and not on a quick tap', async () => {
    const { surface, clock } = await setup();

    surface.press(1);
    await settle();
    surface.press(1);
    await settle();
    assert.equal(surface.lastText(1), '#222|Зрителей: 2');

    // Released before the timer fires: no longPress.
    surface.release(1);
    assert.equal(clock.pendingCount, 0);

    surface.press(1);
    clock.fire();
    await settle();
    assert.equal(surface.lastText(1), '#222|Зрителей: 0');
  });

  it('swallows the release that follows a long press', async () => {
    // Otherwise hold-to-reset would reset the counter and then count the
    // release as a click, leaving it at 1.
    const { surface, clock } = await setup();

    surface.press(1);
    clock.fire();
    await settle();
    surface.release(1);
    await settle();

    assert.equal(surface.lastText(1), '#222|Зрителей: 0');
  });

  it('runs up actions and clears keys the new page does not use', async () => {
    const { surface, controller } = await setup();

    surface.press(2);
    surface.release(2);
    await settle();

    assert.equal(controller.pageId, 'second');
    assert.equal(surface.lastText(0), '-|Назад');
    assert.deepEqual(surface.cleared, [1, 2]);
  });

  it('keeps running when an action fails, and reports it', async () => {
    const surface = new FakeSurface();
    const registry = new ActionRegistry();
    registry.register('boom', () => {
      throw new Error('nope');
    });
    const controller = new DeckController(surface, fakeRenderer, registry);
    controller.load({
      ...micProfile,
      pages: [
        {
          id: 'main',
          buttons: [
            {
              id: 'b',
              key: 0,
              states: [
                { id: 'default', visual: { label: { text: 'x' } }, actions: { down: [{ type: 'boom' }] } },
              ],
            },
          ],
        },
      ],
    });

    const errors: Error[] = [];
    controller.on('error', (error) => errors.push(error));
    await controller.start();

    surface.press(0);
    await settle();

    assert.equal(errors.length, 1);
    assert.match(errors[0]!.message, /Action 'boom' on button 'b' failed/);
    await controller.stop();
  });

  it('stops listening after stop()', async () => {
    const { surface, controller } = await setup();
    await controller.stop();
    surface.writes.length = 0;

    surface.press(1);
    await settle();

    assert.equal(surface.writes.length, 0);
  });
});

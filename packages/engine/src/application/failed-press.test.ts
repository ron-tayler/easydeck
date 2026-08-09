import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PROFILE_FORMAT_VERSION } from '../domain/profile.js';
import type { ProfileDefinition } from '../domain/profile.js';
import { ActionRegistry } from './action-registry.js';
import { DeckController } from './deck-controller.js';
import type { ClockPort, TimerHandle } from './ports/clock-port.js';
import { FakePresenter } from './test-doubles.js';

/**
 * What a key does when its press fails.
 *
 * A deck has no window to put an error in — on the D6 the keys are the whole
 * display — so the key that failed wears a warning sign for a few seconds. It
 * has to reach both surfaces: the panel draws it into the tile, and a browser
 * deck draws the same mark from the key's description.
 */

/** Time by hand, so three seconds cost nothing. */
class HandClock implements ClockPort {
  private time = 0;
  private next = 1;
  private readonly waiting = new Map<number, { at: number; run: () => void }>();

  setTimeout(callback: () => void, milliseconds: number): TimerHandle {
    const handle = this.next++;
    this.waiting.set(handle, { at: this.time + milliseconds, run: callback });
    return handle;
  }

  clearTimeout(handle: TimerHandle): void {
    this.waiting.delete(handle as number);
  }

  now(): number {
    return this.time;
  }

  advance(milliseconds: number): void {
    this.time += milliseconds;
    for (const [handle, entry] of [...this.waiting]) {
      if (entry.at > this.time) continue;
      this.waiting.delete(handle);
      entry.run();
    }
  }
}

const PROFILE: ProfileDefinition = {
  formatVersion: PROFILE_FORMAT_VERSION,
  id: 'failing',
  name: 'Failing',
  layout: { rows: 3, cols: 5 },
  root: {
    id: 'root',
    name: 'Root',
    pages: [
      {
        id: 'main',
        buttons: [
          {
            id: 'bad',
            key: 6,
            states: [
              {
                id: 'default',
                visual: { label: { text: 'boom' } },
                actions: { press: [{ type: 'explode' }] },
              },
            ],
          },
          {
            id: 'fine',
            key: 7,
            states: [{ id: 'default', visual: { label: { text: 'ok' } } }],
          },
        ],
      },
    ],
  },
};

function registry(): ActionRegistry {
  const actions = new ActionRegistry();
  actions.register('explode', () => {
    throw new Error('the macro is broken');
  });
  return actions;
}

async function deck(clock: ClockPort) {
  const presenter = new FakePresenter({ rows: 3, cols: 5 });
  const controller = new DeckController(presenter, registry(), { clock });
  // Someone always listens in production — the registry forwards it to the UI —
  // and an EventEmitter with no listener for 'error' throws it instead.
  const failures: Error[] = [];
  controller.on('error', (error) => failures.push(error));
  controller.load(PROFILE);
  await controller.start();
  return { presenter, controller, failures };
}

/**
 * Waits for the press to be dispatched and the repaint it asks for to run.
 *
 * A handful of microtask turns, because the controller chains its paint onto
 * a promise rather than a timer — and a real delay here would only be a slower
 * way of guessing.
 */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 20; turn++) await Promise.resolve();
}

/** Whether the scene marks this key, wherever its region happens to start. */
function marked(presenter: FakePresenter, key: number): boolean {
  return (presenter.scene?.regions ?? []).some((region) => {
    const left = region.key % 5;
    const top = Math.floor(region.key / 5);
    return (region.alerts ?? []).some(
      (cell) => (top + cell.row) * 5 + left + cell.col === key,
    );
  });
}

describe('a press that failed', () => {
  it('marks the key it happened on, and only that key', async () => {
    const clock = new HandClock();
    const { presenter, controller, failures } = await deck(clock);

    controller.simulatePress(6);
    await settle();

    assert.equal(marked(presenter, 6), true);
    assert.equal(marked(presenter, 7), false, 'a key that did nothing must not accuse itself');
    assert.equal(failures.length, 1, 'the failure is still reported, not swallowed by the sign');

    await controller.stop();
  });

  it('says so in the key description too, which is what a browser deck draws', async () => {
    const clock = new HandClock();
    const { controller } = await deck(clock);

    controller.simulatePress(6);
    await settle();

    const view = controller.view().find((key) => key.key === 6);
    assert.equal(view?.visual.alert, true);

    await controller.stop();
  });

  it('takes the mark off again a few seconds later', async () => {
    // A sign that stays is a sign nobody reads: it has to mean "that press,
    // just now".
    const clock = new HandClock();
    const { presenter, controller } = await deck(clock);

    controller.simulatePress(6);
    await settle();
    assert.equal(marked(presenter, 6), true);

    clock.advance(3000);
    await settle();

    assert.equal(marked(presenter, 6), false);
    await controller.stop();
  });

  it('a second failure restarts the clock rather than stacking', async () => {
    const clock = new HandClock();
    const { presenter, controller } = await deck(clock);

    controller.simulatePress(6);
    await settle();
    clock.advance(2000);
    controller.simulatePress(6);
    await settle();

    // Two seconds of the first mark's life have gone; the second press must
    // still leave it there for its own full three.
    clock.advance(2000);
    await settle();
    assert.equal(marked(presenter, 6), true);

    await controller.stop();
  });
});

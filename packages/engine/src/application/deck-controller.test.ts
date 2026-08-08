import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PROFILE_FORMAT_VERSION } from '../domain/profile.js';
import type { ProfileDefinition } from '../domain/profile.js';
import { ActionRegistry } from './action-registry.js';
import { registerBuiltinActions } from './builtin-actions.js';
import { DeckController } from './deck-controller.js';
import type { ClockPort, TimerHandle } from './ports/clock-port.js';
import { FakePresenter } from './test-doubles.js';

class ManualClock implements ClockPort {
  private pending = new Map<number, () => void>();
  private next = 1;
  /** Advanced by hand, so animation timing is asserted rather than waited on. */
  time = 0;

  now(): number {
    return this.time;
  }

  setTimeout(callback: () => void): TimerHandle {
    const handle = this.next++;
    this.pending.set(handle, callback);
    return handle;
  }

  clearTimeout(handle: TimerHandle): void {
    this.pending.delete(handle as number);
  }

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

/**
 * Root scene with two pages and a child scene, exercising both ways of
 * organising a profile at once.
 */
const testProfile: ProfileDefinition = {
  formatVersion: PROFILE_FORMAT_VERSION,
  id: 'test',
  name: 'Test',
  layout: { rows: 1, cols: 3 },
  variables: [
    { name: 'micOn', type: 'string', initial: 'on' },
    { name: 'viewers', type: 'number', initial: 0 },
  ],
  root: {
    id: 'root',
    name: 'Root',
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
                actions: {
                  down: [{ type: 'easydeck.set-variable', params: { name: 'micOn', value: 'off' } }],
                },
              },
              {
                id: 'off',
                visual: { background: '#f00', label: { text: 'Мик выкл' } },
                actions: {
                  down: [{ type: 'easydeck.set-variable', params: { name: 'micOn', value: 'on' } }],
                },
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
                  down: [{ type: 'easydeck.increment-variable', params: { name: 'viewers' } }],
                  longPress: [
                    { type: 'easydeck.set-variable', params: { name: 'viewers', value: 0 } },
                  ],
                },
              },
            ],
          },
          {
            id: 'to-page-2',
            key: 2,
            states: [
              {
                id: 'default',
                visual: { background: '#00f', label: { text: 'Стр. 2' } },
                actions: {
                  up: [{ type: 'easydeck.go-to-page', params: { pageId: 'main-2' } }],
                },
              },
            ],
          },
        ],
      },
      {
        id: 'main-2',
        buttons: [
          {
            id: 'to-tools',
            key: 0,
            states: [
              {
                id: 'default',
                visual: { label: { text: 'Инструменты' } },
                actions: { up: [{ type: 'easydeck.open-folder', params: { folderId: 'tools' } }] },
              },
            ],
          },
        ],
      },
    ],
    folders: [
      {
        id: 'tools',
        name: 'Tools',
        pages: [
          {
            id: 'tools-main',
            buttons: [
              {
                id: 'back',
                key: 0,
                states: [
                  {
                    id: 'default',
                    visual: { label: { text: 'Наверх' } },
                    actions: { up: [{ type: 'easydeck.go-up' }] },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
};

async function setup(profile = testProfile) {
  const surface = new FakePresenter();
  const clock = new ManualClock();
  const registry = registerBuiltinActions(new ActionRegistry());
  const controller = new DeckController(surface, registry, {
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
  it('starts on the root folderial first page and paints it', async () => {
    const { surface, controller } = await setup();

    assert.deepEqual(controller.currentLocation, { folderId: 'root', pageId: 'main' });
    assert.equal(surface.lastText(0), '#0f0|Мик вкл');
    assert.equal(surface.lastText(1), '#222|Зрителей: 0');
  });

  it('refuses a profile authored for a different layout', async () => {
    const surface = new FakePresenter();
    const controller = new DeckController(surface, new ActionRegistry());

    assert.throws(
      () => controller.load({ ...testProfile, layout: { rows: 3, cols: 5 } }),
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

    surface.release(1);
    assert.equal(clock.pendingCount, 0);

    surface.press(1);
    clock.fire();
    await settle();
    assert.equal(surface.lastText(1), '#222|Зрителей: 0');
  });

  it('swallows the release that follows a long press', async () => {
    const { surface, clock } = await setup();

    surface.press(1);
    clock.fire();
    await settle();
    surface.release(1);
    await settle();

    assert.equal(surface.lastText(1), '#222|Зрителей: 0');
  });

  it('moves between pages of a folder and clears keys the new page does not use', async () => {
    const { surface, controller } = await setup();

    surface.press(2);
    surface.release(2);
    await settle();

    assert.deepEqual(controller.currentLocation, { folderId: 'root', pageId: 'main-2' });
    assert.equal(surface.lastText(0), '-|Инструменты');
    assert.deepEqual(surface.cleared, [1, 2]);
  });

  it('enters a child folder and comes back up', async () => {
    const { surface, controller } = await setup();

    controller.goToPage('main-2');
    await settle();
    surface.press(0);
    surface.release(0);
    await settle();

    assert.deepEqual(controller.currentLocation, { folderId: 'tools', pageId: 'tools-main' });
    assert.deepEqual(
      controller.folderPath.map((f) => f.id),
      ['root', 'tools'],
    );

    surface.press(0);
    surface.release(0);
    await settle();
    assert.equal(controller.currentLocation?.folderId, 'root');
  });

  // A "back" button on the top level should be inert, not throw: the profile
  // author cannot know where the user will be when they press it.
  it('treats going up from the root as a no-op', async () => {
    const { controller } = await setup();

    assert.doesNotThrow(() => controller.goUp());
    assert.equal(controller.currentLocation?.folderId, 'root');
  });

  it('retraces visited locations with goBack', async () => {
    const { controller } = await setup();

    controller.goToPage('main-2');
    controller.openFolder('tools');
    await settle();

    controller.goBack();
    assert.equal(controller.currentLocation?.pageId, 'main-2');

    controller.goBack();
    assert.equal(controller.currentLocation?.pageId, 'main');

    // Exhausted history is silent, for the same reason goUp is.
    assert.doesNotThrow(() => controller.goBack());
  });

  it('reports the pages of the current folder for a page strip', async () => {
    const { controller } = await setup();

    assert.deepEqual(
      controller.currentFolderPages.map((page) => page.id),
      ['main', 'main-2'],
    );

    controller.openFolder('tools');
    assert.deepEqual(
      controller.currentFolderPages.map((page) => page.id),
      ['tools-main'],
    );
  });

  it('rejects navigating to something that does not exist', async () => {
    const { controller } = await setup();

    assert.throws(() => controller.openFolder('nope'), /No folder 'nope'/);
    assert.throws(() => controller.goToPage('nope'), /No page 'nope'/);
  });

  it('keeps running when an action fails, and reports it', async () => {
    const surface = new FakePresenter();
    const registry = new ActionRegistry();
    registry.register('boom', () => {
      throw new Error('nope');
    });
    const controller = new DeckController(surface, registry);
    controller.load({
      ...testProfile,
      root: {
        id: 'root',
        name: 'Root',
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
      },
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

  // Regression: loading a profile used to empty the painted-keys map to force
  // a full repaint. That also forgot which keys held an image, so a key whose
  // button had just been moved away or deleted was never cleared and kept
  // showing the old picture on the device.
  it('clears a key whose button was removed by an edit', async () => {
    const { surface, controller } = await setup();
    surface.cleared.length = 0;

    const page = testProfile.root.pages[0]!;
    const edited: ProfileDefinition = {
      ...testProfile,
      root: {
        ...testProfile.root,
        pages: [
          { ...page, buttons: page.buttons.filter((button) => button.key !== 1) },
          ...testProfile.root.pages.slice(1),
        ],
      },
    };

    controller.load(edited);
    controller.invalidate();
    await settle();

    assert.ok(surface.cleared.includes(1), `expected key 1 to be cleared, got ${surface.cleared}`);
  });

  it('clears the key a button was moved away from', async () => {
    const { surface, controller } = await setup();
    surface.cleared.length = 0;

    const page = testProfile.root.pages[0]!;
    const moved: ProfileDefinition = {
      ...testProfile,
      root: {
        ...testProfile.root,
        pages: [
          {
            ...page,
            // The counter moves off key 1 onto key 2, whose own button goes
            // away — the test grid has three keys and all of them are taken.
            buttons: page.buttons
              .filter((button) => button.key !== 2)
              .map((button) => (button.key === 1 ? { ...button, key: 2 } : button)),
          },
          ...testProfile.root.pages.slice(1),
        ],
      },
    };

    controller.load(moved);
    controller.invalidate();
    await settle();

    assert.ok(surface.cleared.includes(1), `expected key 1 to be cleared, got ${surface.cleared}`);
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

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PROFILE_FORMAT_VERSION } from '../domain/profile.js';
import type { ProfileDefinition } from '../domain/profile.js';
import { VariableStore } from '../domain/variables.js';
import { ActionRegistry } from './action-registry.js';
import { registerBuiltinActions } from './builtin-actions.js';
import { DeckController } from './deck-controller.js';
import { FakePresenter } from './test-doubles.js';

const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** One key showing the variable, one key changing it. */
function profileWith(id: string): ProfileDefinition {
  return {
    formatVersion: PROFILE_FORMAT_VERSION,
    id,
    name: id,
    layout: { rows: 1, cols: 3 },
    variables: [{ name: 'micOn', type: 'boolean', initial: false }],
    root: {
      id: 'root',
      name: 'Root',
      pages: [
        {
          id: 'main',
          buttons: [
            {
              id: 'shows',
              key: 0,
              states: [{ id: 'default', visual: { label: { text: '{{micOn}}' } } }],
            },
            {
              id: 'toggles',
              key: 1,
              states: [
                {
                  id: 'default',
                  visual: { label: { text: 'toggle' } },
                  actions: {
                    press: [{ type: 'vars.toggle-variable', params: { name: 'micOn' } }],
                  },
                },
              ],
            },
          ],
        },
        {
          id: 'second',
          buttons: [
            {
              id: 'also-shows',
              key: 0,
              states: [{ id: 'default', visual: { label: { text: 'page two: {{micOn}}' } } }],
            },
          ],
        },
      ],
    },
  };
}

async function deck(variables: VariableStore, deckId: string, profileId = deckId) {
  const surface = new FakePresenter({ rows: 1, cols: 3 });
  const controller = new DeckController(surface, registerBuiltinActions(new ActionRegistry()), {
    variables,
    deckId,
  });
  controller.load(profileWith(profileId));
  await controller.start();
  return { surface, controller };
}

describe('several decks, one world', () => {
  it('a variable changed on one deck is seen by the other', async () => {
    // The whole point of sharing the store: mute the mic on the tablet and the
    // button on the panel goes with it, because there is one truth about the
    // mic and both decks are reading it.
    const variables = new VariableStore();
    const panel = await deck(variables, 'panel');
    const tablet = await deck(variables, 'tablet');

    tablet.surface.gesture(1, 'press');
    await settle();

    assert.equal(panel.surface.lastText(0), '-|true');
    assert.equal(tablet.surface.lastText(0), '-|true');
  });

  it('decks with their own stores stay strangers', async () => {
    const panel = await deck(new VariableStore(), 'panel');
    const tablet = await deck(new VariableStore(), 'tablet');

    tablet.surface.gesture(1, 'press');
    await settle();

    assert.equal(tablet.surface.lastText(0), '-|true');
    assert.equal(panel.surface.lastText(0), '-|false');
  });

  it('one profile, two decks, different pages', async () => {
    // The scenario the whole design is for: locations are private to a deck
    // even when the profile and the variables are shared, so "not fully in
    // sync" needs no synchronisation feature at all.
    const variables = new VariableStore();
    const panel = await deck(variables, 'panel', 'shared');
    const tablet = await deck(variables, 'tablet', 'shared');

    tablet.controller.goToPage('second');
    await settle();

    assert.equal(tablet.controller.currentLocation?.pageId, 'second');
    assert.equal(panel.controller.currentLocation?.pageId, 'main', 'the panel followed the tablet');
    assert.equal(tablet.surface.lastText(0), '-|page two: false');
    assert.equal(panel.surface.lastText(0), '-|false');
  });

  it('a shared variable reaches a deck sitting on another page', async () => {
    const variables = new VariableStore();
    const panel = await deck(variables, 'panel', 'shared');
    const tablet = await deck(variables, 'tablet', 'shared');

    tablet.controller.goToPage('second');
    await settle();
    panel.surface.gesture(1, 'press');
    await settle();

    assert.equal(tablet.surface.lastText(0), '-|page two: true');
  });

  it('an action is told which deck it came from', async () => {
    const variables = new VariableStore();
    const seen: string[] = [];
    const registry = registerBuiltinActions(new ActionRegistry());
    registry.register('test.whoami', (_params, context) => {
      seen.push(context.deckId);
    });

    const surface = new FakePresenter({ rows: 1, cols: 3 });
    const controller = new DeckController(surface, registry, { variables, deckId: 'tablet' });
    controller.load({
      ...profileWith('who'),
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
                  { id: 'default', visual: {}, actions: { press: [{ type: 'test.whoami' }] } },
                ],
              },
            ],
          },
        ],
      },
    });
    await controller.start();

    surface.gesture(0, 'press');
    await settle();

    assert.deepEqual(seen, ['tablet']);
  });

  it('a deck with no store of its own still works alone', async () => {
    const solo = await deck(new VariableStore(), 'solo');

    solo.surface.gesture(1, 'press');
    await settle();

    assert.equal(solo.surface.lastText(0), '-|true');
  });
});

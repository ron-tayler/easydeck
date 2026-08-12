import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, it } from 'node:test';

import { CORE_ON } from '../domain/action.js';
import type { ActionDescriptor } from '../domain/action.js';
import { PROFILE_FORMAT_VERSION } from '../domain/profile.js';
import type { ProfileDefinition } from '../domain/profile.js';
import { VariableStore } from '../domain/variables.js';
import { ActionRegistry } from './action-registry.js';
import { registerBuiltinActions } from './builtin-actions.js';
import { DeckController } from './deck-controller.js';
import { FakePresenter } from './test-doubles.js';

/**
 * A profile whose first button watches something.
 *
 * The handler lives on the *second* page in one of the tests below on purpose:
 * automation that only works while you happen to be looking at the right page
 * is automation you cannot rely on.
 */
function profileWith(handlers: ActionDescriptor[], onSecondPage = false): ProfileDefinition {
  const button = {
    id: 'watcher',
    key: 0,
    states: [{ id: 'default', visual: {}, actions: { event: handlers } }],
  };

  return {
    formatVersion: PROFILE_FORMAT_VERSION,
    id: 'events',
    name: 'Events',
    layout: { rows: 1, cols: 2 },
    root: {
      id: 'root',
      name: 'Root',
      pages: onSecondPage
        ? [
            { id: 'main', buttons: [] },
            { id: 'second', buttons: [button] },
          ]
        : [{ id: 'main', buttons: [button] }],
    },
  };
}

const when = (name: string, operator: string, value: unknown): Record<string, unknown> => ({
  when: { source: 'variable', name, operator, value },
});

/** A handler that counts how often it ran, by adding to a variable. */
const bump = (name = 'ran'): ActionDescriptor => ({
  type: 'vars.increment-variable',
  params: { name, by: 1 },
});

async function bench(profile: ProfileDefinition) {
  const variables = new VariableStore();
  const registry = registerBuiltinActions(new ActionRegistry());
  const deck = new DeckController(new FakePresenter({ rows: 1, cols: 2 }), registry, { variables });

  const errors: Error[] = [];
  deck.on('error', (error) => errors.push(error));

  deck.load(profile);
  await deck.start();

  return {
    variables,
    errors,
    deck,
    /** Variables settle asynchronously; this is where the handlers run. */
    async settle() {
      await delay(30);
    },
    async dispose() {
      await deck.stop();
    },
  };
}

describe('handlers that watch instead of waiting for a finger', () => {
  it('runs when its condition becomes true, and not again while it stays true', async () => {
    /*
     * On the edge, not the level. A handler watching "processor over 90"
     * should act when it climbs past ninety — once a second for as long as it
     * is busy would be a different feature, and a worse one.
     */
    const bed = await bench(
      profileWith([{ type: CORE_ON, params: when('cpu', '>=', 90), branches: { do: [bump()] } }]),
    );

    bed.variables.set('cpu', 95);
    await bed.settle();
    assert.equal(bed.variables.get('ran'), 1);

    bed.variables.set('cpu', 97);
    await bed.settle();
    assert.equal(bed.variables.get('ran'), 1, 'still true is not newly true');

    bed.variables.set('cpu', 10);
    await bed.settle();
    bed.variables.set('cpu', 99);
    await bed.settle();
    assert.equal(bed.variables.get('ran'), 2, 'it climbed past ninety again');

    await bed.dispose();
  });

  it('does not fire for a condition that was already true when the deck started', async () => {
    // Otherwise every handler goes off at once on launch, which is the worst
    // possible moment: the deck has just appeared and something ran.
    const variables = new VariableStore();
    variables.set('cpu', 95);

    const registry = registerBuiltinActions(new ActionRegistry());
    const deck = new DeckController(new FakePresenter({ rows: 1, cols: 2 }), registry, { variables });
    deck.load(profileWith([{ type: CORE_ON, params: when('cpu', '>=', 90), branches: { do: [bump()] } }]));
    await deck.start();

    variables.set('cpu', 96);
    await delay(30);

    assert.equal(variables.get('ran'), undefined);
    await deck.stop();
  });

  it('watches from any page of the profile, not just the one on screen', async () => {
    // "When the scene changes, mute the mic" that worked only while you were
    // looking at the right page would be automation you cannot rely on.
    const bed = await bench(
      profileWith([{ type: CORE_ON, params: when('scene', '==', 'Game'), branches: { do: [bump()] } }], true),
    );

    bed.variables.set('scene', 'Game');
    await bed.settle();

    assert.equal(bed.variables.get('ran'), 1);
    await bed.dispose();
  });

  it('lets one handler arm another', async () => {
    const bed = await bench(
      profileWith([
        {
          type: CORE_ON,
          params: when('cpu', '>=', 90),
          branches: { do: [{ type: 'vars.set-variable', params: { name: 'hot', value: true } }] },
        },
        {
          type: CORE_ON,
          params: when('hot', '==', true),
          branches: { do: [bump('alerted')] },
        },
      ]),
    );

    bed.variables.set('cpu', 95);
    await bed.settle();

    assert.equal(bed.variables.get('hot'), true);
    assert.equal(bed.variables.get('alerted'), 1);

    await bed.dispose();
  });

  it('settles when two handlers keep undoing each other', async () => {
    /*
     * Two handlers, each setting off the other, which is the shape a runaway
     * would take. It does not run away, and the reason is worth knowing: a
     * handler fires on the edge, and its edge is judged once per round — so a
     * value flipped twice inside a round is a value that never appears to have
     * changed, and the chain has nothing left to do by the second pass.
     *
     * The round limit stands behind that as a guard rather than as the
     * mechanism. What this test is really asserting is that the deck is still
     * answering afterwards.
     */
    const bed = await bench(
      profileWith([
        {
          type: CORE_ON,
          params: when('ping', '==', 1),
          branches: { do: [{ type: 'vars.set-variable', params: { name: 'pong', value: 1 } }] },
        },
        {
          type: CORE_ON,
          params: when('pong', '==', 1),
          branches: {
            do: [
              { type: 'vars.set-variable', params: { name: 'ping', value: 0 } },
              { type: 'vars.set-variable', params: { name: 'ping', value: 1 } },
            ],
          },
        },
      ]),
    );

    bed.variables.set('ping', 1);
    await delay(200);

    // Settled rather than still going, and the deck answers.
    const settled = bed.variables.get('ping');
    await delay(100);
    assert.equal(bed.variables.get('ping'), settled, 'nothing is still flipping');
    assert.equal(bed.deck.view().length, 1);

    await bed.dispose();
  });

  it('says nothing and does nothing for a handler nobody filled in', async () => {
    const bed = await bench(profileWith([{ type: CORE_ON, branches: { do: [bump()] } }]));

    bed.variables.set('anything', 1);
    await bed.settle();

    assert.equal(bed.variables.get('ran'), undefined);
    assert.deepEqual(bed.errors, []);

    await bed.dispose();
  });
});

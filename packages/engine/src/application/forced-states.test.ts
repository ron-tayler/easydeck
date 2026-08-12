import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { THIS_BUTTON } from '../domain/action.js';
import { PROFILE_FORMAT_VERSION } from '../domain/profile.js';
import type { ButtonDefinition, ProfileDefinition } from '../domain/profile.js';
import { ActionRegistry } from './action-registry.js';
import { registerBuiltinActions } from './builtin-actions.js';
import { DeckController } from './deck-controller.js';
import { FakePresenter } from './test-doubles.js';

/** A press runs its script and repaints later, not in the same tick. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));

/**
 * A state set by an action lives in memory and nowhere else.
 *
 * The profile has no field for "which state this key happens to be showing",
 * and should not: it is a fact about this moment rather than about the
 * document. Which is exactly why a reload used to forget it, and why editing
 * one key reset every other key on the page.
 */

function twoStates(key: number, id: string, bound?: string): ButtonDefinition {
  return {
    id,
    key,
    ...(bound ? { stateFrom: bound } : {}),
    states: [
      { id: 'off', visual: { label: { text: 'off' } } },
      { id: 'on', visual: { label: { text: 'on' } } },
    ],
  };
}

function profileWith(buttons: readonly ButtonDefinition[], name = 'Same'): ProfileDefinition {
  return {
    formatVersion: PROFILE_FORMAT_VERSION,
    id: 'p',
    name,
    layout: { rows: 3, cols: 5 },
    root: { id: 'root', name: 'Root', pages: [{ id: 'main', buttons }] },
  };
}

async function deck(buttons: readonly ButtonDefinition[]) {
  const presenter = new FakePresenter({ rows: 3, cols: 5 });
  const controller = new DeckController(presenter, new ActionRegistry());
  controller.load(profileWith(buttons));
  await controller.start();
  return { presenter, controller };
}

const showing = (controller: DeckController, id: string): string | undefined =>
  controller.view().find((view) => view.buttonId === id)?.stateId;

describe('a state forced by an action', () => {
  it('survives the reload an edit to another key causes', async () => {
    const { controller } = await deck([twoStates(0, 'a'), twoStates(1, 'b')]);

    controller.setButtonState('a', 'on');
    assert.equal(showing(controller, 'a'), 'on');

    // What saving from the configurator does: the same profile, one key
    // changed, handed back to the deck.
    const kept = controller.forcedStates;
    controller.load(profileWith([twoStates(0, 'a'), twoStates(1, 'b')]));
    controller.restoreForcedStates(kept);

    assert.equal(showing(controller, 'a'), 'on', 'the key that was not edited');
    assert.equal(showing(controller, 'b'), 'off', 'and the one that was never forced');
  });

  it('is dropped when the button it belonged to is gone', async () => {
    const { controller } = await deck([twoStates(0, 'a'), twoStates(1, 'b')]);
    controller.setButtonState('b', 'on');

    const kept = controller.forcedStates;
    controller.load(profileWith([twoStates(0, 'a')]));
    controller.restoreForcedStates(kept);

    assert.equal(showing(controller, 'b'), undefined);
  });

  it('is dropped when the state it named was renamed under it', async () => {
    const { controller } = await deck([twoStates(0, 'a')]);
    controller.setButtonState('a', 'on');

    const kept = controller.forcedStates;
    controller.load(
      profileWith([
        {
          id: 'a',
          key: 0,
          states: [
            { id: 'off', visual: {} },
            { id: 'lit', visual: {} },
          ],
        },
      ]),
    );
    controller.restoreForcedStates(kept);

    // Back to the first state rather than to nothing, and without throwing.
    assert.equal(showing(controller, 'a'), 'off');
  });

  it('is not what a bound button uses, so nothing is kept for one', async () => {
    /*
     * Forcing a bound button writes its variable instead — otherwise the
     * override and the variable would disagree about the same key. Variables
     * outlive a reload on their own, so there is nothing here to restore.
     */
    const { controller } = await deck([twoStates(0, 'a', 'lamp')]);
    controller.setButtonState('a', 'on');

    assert.deepEqual([...controller.forcedStates], []);
    assert.equal(showing(controller, 'a'), 'on');

    controller.load(profileWith([twoStates(0, 'a', 'lamp')]));
    controller.restoreForcedStates(controller.forcedStates);

    assert.equal(showing(controller, 'a'), 'on', 'the variable carried it');
  });

  it('hands back a copy, not the map about to be cleared', async () => {
    // Held across the load, so it must not be the live one the load empties.
    const { controller } = await deck([twoStates(0, 'a')]);
    controller.setButtonState('a', 'on');

    const kept = controller.forcedStates;
    controller.load(profileWith([twoStates(0, 'a')]));

    assert.deepEqual([...kept], [['a', 'on']]);
  });

  it('is what an `if` naming `this_btn` reads', async () => {
    /*
     * The two ways of saying "the key I am on" must agree. Leaving the name
     * empty always meant it, but a select cannot offer a blank as a choice —
     * it reads as "nobody has answered yet" — so the lists say "this button"
     * and store `this_btn`. Read literally, that is a button id belonging to
     * nobody, and a key toggling itself takes the same branch forever.
     */
    const presenter = new FakePresenter({ rows: 3, cols: 5 });
    const controller = new DeckController(presenter, registerBuiltinActions(new ActionRegistry()));

    controller.load(
      profileWith([
        {
          id: 'a',
          key: 0,
          states: ['off', 'on'].map((id) => ({
            id,
            visual: { label: { text: id } },
            actions: {
              press: [
                {
                  type: 'core.if',
                  params: {
                    when: {
                      source: 'button-state',
                      name: THIS_BUTTON,
                      operator: '==',
                      value: 'off',
                    },
                  },
                  branches: {
                    then: [
                      { type: 'vars.set-button-state', params: { buttonId: THIS_BUTTON, stateId: 'on' } },
                    ],
                    else: [
                      { type: 'vars.set-button-state', params: { buttonId: THIS_BUTTON, stateId: 'off' } },
                    ],
                  },
                },
              ],
            },
          })),
        },
      ]),
    );
    await controller.start();

    controller.simulatePress(0);
    await settle();
    assert.equal(showing(controller, 'a'), 'on');

    controller.simulatePress(0);
    await settle();
    assert.equal(showing(controller, 'a'), 'off');
  });
});

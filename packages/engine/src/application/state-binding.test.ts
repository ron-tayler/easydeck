import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PLUGIN_API_VERSION } from '../domain/plugin.js';
import { PROFILE_FORMAT_VERSION } from '../domain/profile.js';
import type { ButtonStateDefinition, ProfileDefinition } from '../domain/profile.js';
import type { VariableDeclaration } from '../domain/variables.js';
import { ActionRegistry } from './action-registry.js';
import { DeckController } from './deck-controller.js';
import { silentPresenter } from './test-doubles.js';

const presenter = silentPresenter(1, 1);


function state(id: string, when?: unknown): ButtonStateDefinition {
  return {
    id,
    visual: { label: { text: id } },
    ...(when === undefined ? {} : { when: when as never }),
  };
}

function profileWith(
  variables: readonly VariableDeclaration[],
  states: readonly ButtonStateDefinition[],
): ProfileDefinition {
  return {
    formatVersion: PROFILE_FORMAT_VERSION,
    id: 'binding',
    name: 'Binding',
    layout: { rows: 1, cols: 1 },
    variables,
    root: {
      id: 'root',
      name: 'Root',
      pages: [{ id: 'main', buttons: [{ id: 'b', key: 0, stateFrom: 'v', states }] }],
    },
  };
}

function controllerFor(
  variables: readonly VariableDeclaration[],
  states: readonly ButtonStateDefinition[],
  registry = new ActionRegistry(),
): DeckController {
  const controller = new DeckController(presenter, registry);
  controller.load(profileWith(variables, states));
  return controller;
}

const shown = (controller: DeckController): string => controller.view()[0]!.stateId;

describe('binding a state to a variable', () => {
  it('matches a state that declares the value, whatever the type', () => {
    const controller = controllerFor(
      [{ name: 'v', type: 'enum', initial: 'idle', options: [{ value: 'idle' }, { value: 'live' }] }],
      [state('grey', 'idle'), state('red', 'live')],
    );

    assert.equal(shown(controller), 'grey');
    controller.variables.set('v', 'live');
    assert.equal(shown(controller), 'red');
  });

  /**
   * The whole reason `when` sits above the type rules: profiles written before
   * it existed bind by state id, and none of them may change behaviour just
   * because their variables acquired declared types.
   */
  it('still matches a state by its id when no value is declared', () => {
    const controller = controllerFor(
      [{ name: 'v', type: 'string', initial: 'off' }],
      [state('on'), state('off')],
    );

    assert.equal(shown(controller), 'off');
    controller.variables.set('v', 'on');
    assert.equal(shown(controller), 'on');
  });

  it('walks states in order for a number, wrapping round', () => {
    const controller = controllerFor(
      [{ name: 'v', type: 'number', initial: 0 }],
      [state('a'), state('b'), state('c')],
    );

    assert.equal(shown(controller), 'a');
    controller.variables.set('v', 2);
    assert.equal(shown(controller), 'c');
    controller.variables.set('v', 3);
    assert.equal(shown(controller), 'a', 'wraps back to the start');
    controller.variables.set('v', -1);
    assert.equal(shown(controller), 'c', 'counts backwards from the end');
  });

  it('reads a boolean as first state off, second state on', () => {
    const controller = controllerFor(
      [{ name: 'v', type: 'boolean', initial: false }],
      [state('quiet'), state('loud')],
    );

    assert.equal(shown(controller), 'quiet');
    controller.variables.set('v', true);
    assert.equal(shown(controller), 'loud');
  });

  it('takes the first state when several claim the same value', () => {
    const controller = controllerFor(
      [{ name: 'v', type: 'string', initial: 'x' }],
      [state('first', 'x'), state('second', 'x')],
    );

    assert.equal(shown(controller), 'first');
  });

  /** Forcing a state has to write the value that selects it, not its name. */
  it('writes back the value that selects the state it was told to show', () => {
    const boolean = controllerFor(
      [{ name: 'v', type: 'boolean', initial: false }],
      [state('quiet'), state('loud')],
    );
    boolean.setButtonState('b', 'loud');
    assert.equal(boolean.variables.get('v'), true);
    assert.equal(shown(boolean), 'loud');

    const carousel = controllerFor(
      [{ name: 'v', type: 'number', initial: 0 }],
      [state('a'), state('b'), state('c')],
    );
    carousel.setButtonState('b', 'c');
    assert.equal(carousel.variables.get('v'), 2);
    assert.equal(shown(carousel), 'c');
  });

  it('leaves the button alone when a value matches nothing', () => {
    const controller = controllerFor(
      [{ name: 'v', type: 'string', initial: 'on' }],
      [state('on'), state('off')],
    );

    controller.variables.set('v', 'nonsense');
    assert.equal(shown(controller), 'on', 'keeps showing the initial state');
  });
});

describe('binding a state to a band of numbers', () => {
  /** Bands in order, the way a gauge is written. */
  const gauge = () =>
    controllerFor(
      [{ name: 'v', type: 'number', initial: 0 }],
      [
        state('calm', { max: 49 }),
        state('busy', { min: 50, max: 89 }),
        state('hot', { min: 90 }),
      ],
    );

  it('shows the band the value falls inside', () => {
    const controller = gauge();

    assert.equal(shown(controller), 'calm');
    controller.variables.set('v', 50);
    assert.equal(shown(controller), 'busy');
    controller.variables.set('v', 90);
    assert.equal(shown(controller), 'hot');
    controller.variables.set('v', 100);
    assert.equal(shown(controller), 'hot', 'an open top end has no upper limit');
  });

  it('takes both ends as inclusive', () => {
    const controller = gauge();

    controller.variables.set('v', 49);
    assert.equal(shown(controller), 'calm');
    controller.variables.set('v', 89);
    assert.equal(shown(controller), 'busy');
  });

  /**
   * The reason bands exist at all. Without them a number falls through to the
   * carousel, where a processor at 42% shows whichever state 42 happens to
   * index — which is right for a counter and nonsense for a gauge.
   */
  it('beats the carousel a bare number would otherwise get', () => {
    const controller = gauge();

    controller.variables.set('v', 42);
    assert.equal(shown(controller), 'calm');
    controller.variables.set('v', 43);
    assert.equal(shown(controller), 'calm', 'and does not walk to the next state');
  });

  it('lets an exact value win over a band that also covers it', () => {
    // Both are the author speaking, and the more specific of the two is the
    // one they can only have meant deliberately.
    const controller = controllerFor(
      [{ name: 'v', type: 'number', initial: 0 }],
      [state('any', { min: 0, max: 100 }), state('exactly-fifty', 50)],
    );

    controller.variables.set('v', 50);
    assert.equal(shown(controller), 'exactly-fifty');
    controller.variables.set('v', 51);
    assert.equal(shown(controller), 'any');
  });

  it('takes the first band when two overlap', () => {
    const controller = controllerFor(
      [{ name: 'v', type: 'number', initial: 95 }],
      [state('warn', { min: 80 }), state('hot', { min: 90 })],
    );

    assert.equal(shown(controller), 'warn');
  });
});

describe('variables declared by a plugin', () => {
  const registryWith = (variables: readonly VariableDeclaration[]): ActionRegistry =>
    new ActionRegistry().installPlugin(
      {
        id: 'obs',
        name: { en: 'OBS' },
        version: '1.0.0',
        apiVersion: PLUGIN_API_VERSION,
        actions: [],
        variables,
      },
      {},
    );

  it('exist and hold their initial value before anything writes to them', () => {
    const controller = controllerFor([], [state('a')], registryWith([
      { name: 'obs.live', type: 'boolean', initial: true },
    ]));

    assert.equal(controller.variables.get('obs.live'), true);
  });

  it('are reported as owned, so a configurator can refuse to delete them', () => {
    const controller = controllerFor([], [state('a')], registryWith([
      { name: 'obs.scene', type: 'string' },
    ]));

    const declared = controller.variableDeclarations.find((v) => v.name === 'obs.scene');
    assert.equal(declared?.pluginId, 'obs');
  });

  /**
   * A profile may give a plugin variable a starting value, but it may not
   * change what the variable *is* — the plugin writes to it either way.
   */
  it('keep their type when a profile restates them', () => {
    const controller = controllerFor(
      [{ name: 'obs.live', type: 'string', initial: 'yes' }],
      [state('a')],
      registryWith([{ name: 'obs.live', type: 'boolean' }]),
    );

    const declared = controller.variableDeclarations.find((v) => v.name === 'obs.live');
    assert.equal(declared?.type, 'boolean');
    assert.equal(declared?.pluginId, 'obs');
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CORE_ON } from '../domain/action.js';
import { PROFILE_FORMAT_VERSION } from '../domain/profile.js';
import type { ButtonDefinition, ProfileDefinition } from '../domain/profile.js';
import type { SurfaceFrame, SurfaceRequest } from '../domain/surface-spec.js';
import { ActionRegistry } from './action-registry.js';
import { registerBuiltinActions } from './builtin-actions.js';
import { DeckController } from './deck-controller.js';
import { FakePresenter } from './test-doubles.js';

/**
 * A repaint is scheduled rather than immediate; this waits for it.
 *
 * Two turns of the loop, because a change asks for a paint through a promise
 * chain and the paint itself awaits the plugins.
 */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));

/**
 * A page whose appearance depends on `shown` and on nothing else.
 *
 * The second button is the one that matters: it has a widget, so every pass
 * over this page asks the plugin — which is what makes "did a pass happen at
 * all" something a test can see.
 */
function profileWith(buttons: readonly ButtonDefinition[]): ProfileDefinition {
  return {
    formatVersion: PROFILE_FORMAT_VERSION,
    id: 'demand',
    name: 'Demand',
    layout: { rows: 1, cols: 3 },
    root: { id: 'root', name: 'Root', pages: [{ id: 'main', buttons }] },
  };
}

const LABELLED: ButtonDefinition = {
  id: 'labelled',
  key: 0,
  states: [{ id: 'default', visual: { label: { text: 'зрителей {{viewers}}' } } }],
};

const WIDGET: ButtonDefinition = {
  id: 'widget',
  key: 1,
  states: [{ id: 'default', visual: { surface: { type: 'demo.graph', params: {} } } }],
};

async function run(buttons: readonly ButtonDefinition[] = [LABELLED, WIDGET]) {
  const asked: SurfaceRequest[] = [];
  const presenter = new FakePresenter();
  const actions = new ActionRegistry();
  registerBuiltinActions(actions);

  const controller = new DeckController(presenter, actions, {
    surfaces: async (request: SurfaceRequest): Promise<SurfaceFrame | undefined> => {
      asked.push(request);
      return undefined;
    },
  });

  controller.load(profileWith(buttons));
  await controller.start();
  await settle();

  return { asked, presenter, controller };
}

describe('what a page bothers to repaint for', () => {
  it('repaints when a variable it shows moves', async () => {
    const { asked, controller } = await run();
    const before = asked.length;

    controller.variables.set('viewers', 42);
    await settle();

    assert.ok(asked.length > before, 'the page never repainted for its own label');
  });

  it('does not repaint for a variable nothing on the page reads', async () => {
    /*
     * The whole point of the filter. Discord's microphone moving while a
     * soundboard is on screen used to rebuild the scene of every key —
     * gathering pictures from plugins on the way — only to compare the result
     * against the last one and find it identical.
     *
     * Measured by whether the plugins were asked, because that is the visible
     * half of a pass and the expensive half.
     */
    const { asked, controller } = await run();
    const before = asked.length;

    controller.variables.set('somebody.elses.microphone', true);
    await settle();

    assert.equal(asked.length, before, 'a page repainted for a variable it never reads');
  });

  it('repaints for the variable a state is bound to', async () => {
    const bound: ButtonDefinition = {
      id: 'bound',
      key: 0,
      stateFrom: 'micOn',
      states: [
        { id: 'off', visual: { label: { text: 'выкл' } } },
        { id: 'on', visual: { label: { text: 'вкл' } } },
      ],
    };

    const { asked, controller } = await run([bound, WIDGET]);
    const before = asked.length;

    controller.variables.set('micOn', true);
    await settle();

    assert.ok(asked.length > before, 'a bound state did not follow its variable');
  });

  it('repaints for the variable a picture binds a parameter to', async () => {
    const gauge: ButtonDefinition = {
      id: 'gauge',
      key: 0,
      states: [
        {
          id: 'default',
          visual: {
            icon: {
              source: 'data:image/svg+xml;base64,PHN2Zy8+',
              params: { angle: { variable: 'hw.cpu', from: 0, to: 100 } },
            },
          },
        },
      ],
    };

    const { asked, controller } = await run([gauge, WIDGET]);
    const before = asked.length;

    controller.variables.set('hw.cpu', 70);
    await settle();

    assert.ok(asked.length > before, 'a needle did not follow its variable');
  });

  it('still runs the handlers of a page nobody is looking at', async () => {
    /*
     * The line the filter must not cross. Handlers belong to the profile, not
     * to the page on screen: a key in another folder may be waiting for
     * exactly the variable this page has no use for, and filtering those the
     * same way would arm nothing until somebody navigated to it.
     */
    const waiting: ButtonDefinition = {
      id: 'waiting',
      key: 2,
      states: [
        {
          id: 'default',
          visual: {},
          actions: {
            event: [
              {
                type: CORE_ON,
                params: {
                  when: { source: 'variable', name: 'elsewhere', operator: '==', value: true },
                },
                branches: {
                  do: [{ type: 'vars.set-variable', params: { name: 'fired', value: 'yes' } }],
                },
              },
            ],
          },
        },
      ],
    };

    const { controller } = await run([LABELLED, WIDGET, waiting]);

    controller.variables.set('elsewhere', true);
    await settle();

    assert.equal(controller.variables.get('fired'), 'yes');
  });
});

describe('what a repaint tells the world', () => {
  it('hands the keys over with it, rather than an invitation to ask', async () => {
    const { controller } = await run();

    const seen: { keys: readonly number[]; views: readonly { key: number; stateId: string }[] }[] = [];
    controller.on('painted', (keys, views) => seen.push({ keys, views }));

    controller.variables.set('viewers', 7);
    await settle();

    const last = seen.at(-1);
    assert.ok(last, 'nothing was reported');
    // The label as it now reads, not a note that something moved.
    assert.equal(
      (last.views.find((view) => view.key === 0) as { visual?: { label?: { text?: string } } })
        ?.visual?.label?.text,
      'зрителей 7',
    );
  });

  it('reports a state that changed without changing the picture', async () => {
    /*
     * Two states that look the same and do different things: pressing the key
     * runs a different script, and a window showing which state a key is in
     * has to follow that. The scene's signature cannot — the picture is
     * identical — so the state ids are compared beside it.
     */
    const twin: ButtonDefinition = {
      id: 'twin',
      key: 0,
      stateFrom: 'mode',
      states: [
        { id: 'first', when: 'a', visual: { label: { text: 'одно и то же' } } },
        { id: 'second', when: 'b', visual: { label: { text: 'одно и то же' } } },
      ],
    };

    const { controller } = await run([twin, WIDGET]);
    controller.variables.set('mode', 'a');
    await settle();

    const seen: string[] = [];
    controller.on('painted', (_keys, views) => {
      const found = views.find((view) => view.key === 0);
      if (found) seen.push(found.stateId);
    });

    controller.variables.set('mode', 'b');
    await settle();

    assert.deepEqual(seen, ['second']);
  });
});

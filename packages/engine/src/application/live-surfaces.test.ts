import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PROFILE_FORMAT_VERSION } from '../domain/profile.js';
import type { ButtonDefinition, ProfileDefinition } from '../domain/profile.js';
import type { SurfaceFrame, SurfaceRequest } from '../domain/surface-spec.js';
import { ActionRegistry } from './action-registry.js';
import { DeckController } from './deck-controller.js';
import { FakePresenter } from './test-doubles.js';

const STILL = 'data:image/png;base64,AAAA';
const DRAWN = 'data:image/svg+xml;base64,PHN2Zy8+';

function button(key: number, visual: object, overrides: Partial<ButtonDefinition> = {}): ButtonDefinition {
  return {
    id: `b${key}`,
    key,
    states: [{ id: 'default', visual: { label: { text: `k${key}` }, ...visual } }],
    ...overrides,
  };
}

function profileWith(buttons: readonly ButtonDefinition[]): ProfileDefinition {
  return {
    formatVersion: PROFILE_FORMAT_VERSION,
    id: 'live',
    name: 'Live',
    layout: { rows: 3, cols: 5 },
    root: { id: 'root', name: 'Root', pages: [{ id: 'main', buttons }] },
  };
}

/** A plugin that answers, and a record of what it was asked. */
function plugin(answer: SurfaceFrame | null = { source: DRAWN }) {
  const asked: SurfaceRequest[] = [];
  return {
    asked,
    draw: async (request: SurfaceRequest): Promise<SurfaceFrame | undefined> => {
      asked.push(request);
      if (!answer || request.type !== 'demo.graph') return undefined;
      return answer;
    },
  };
}

/**
 * A plugin that draws nothing: paused, closed, nothing playing.
 *
 * `null` rather than `undefined`, because passing `undefined` to a parameter
 * with a default gets the default — which is how this file first claimed a
 * silent plugin still produced a picture.
 */
const silent = () => plugin(null);

async function run(buttons: readonly ButtonDefinition[], surfaces = plugin()) {
  const presenter = new FakePresenter({ rows: 3, cols: 5 });
  const controller = new DeckController(presenter, new ActionRegistry(), {
    surfaces: surfaces.draw,
  });
  controller.load(profileWith(buttons));
  await controller.start();
  return { presenter, controller, surfaces };
}

describe('a picture a plugin draws', () => {
  const widget = { surface: { type: 'demo.graph', params: { reading: 'cpu' } } };

  it('reaches the panel', async () => {
    const { presenter } = await run([button(3, widget)]);

    assert.equal(presenter.scene?.regions[0]?.image?.asset.source, DRAWN);
  });

  /*
   * The one this file was written for. Substituting the frame only into the
   * scene left the panel showing a graph while the configurator and the web
   * deck showed a key with a background and a label and nothing else — both of
   * them read `keys`, not the scene.
   */
  it('reaches a window and a tablet, which read the key views instead', async () => {
    const { controller } = await run([button(3, widget)]);

    assert.equal(controller.view().find((view) => view.key === 3)?.visual.icon?.source, DRAWN);
  });

  it('is asked for in keys, so a merged widget knows how wide it is', async () => {
    const { surfaces } = await run([button(5, widget, { colSpan: 3, rowSpan: 2 })]);

    assert.deepEqual(
      surfaces.asked.map((request) => [request.cols, request.rows]),
      [[3, 2]],
    );
  });

  it('asks once for two keys wanting the same picture', async () => {
    // Same type, same parameters: one graph, not two.
    const { surfaces } = await run([button(1, widget), button(2, widget)]);

    assert.equal(surfaces.asked.length, 1);
  });

  it('asks again when the parameters differ', async () => {
    const other = { surface: { type: 'demo.graph', params: { reading: 'gpu' } } };
    const { surfaces } = await run([button(1, widget), button(2, other)]);

    assert.equal(surfaces.asked.length, 2);
  });

  it('falls back to the still it was given when the plugin answers nothing', async () => {
    // Not a fault: the player is paused, OBS is closed. The key shows whatever
    // it was given to show meanwhile.
    const { presenter } = await run([button(3, { ...widget, icon: { source: STILL } })], silent());

    assert.equal(presenter.scene?.regions[0]?.image?.asset.source, STILL);
  });

  it('shows nothing rather than failing when there is no still either', async () => {
    const { presenter, controller } = await run([button(3, widget)], silent());

    assert.equal(presenter.scene?.regions[0]?.image, undefined);
    assert.equal(controller.view().find((view) => view.key === 3)?.visual.icon, undefined);
    // The background and label are untouched, which is the point of a widget
    // being one layer of the face rather than the whole of it.
    assert.equal(presenter.scene?.regions[0]?.labels?.[0]?.text, 'k3');
  });

  it('never asks for a page nobody is looking at', async () => {
    /*
     * The thrift `onWatched` had to be built for variables falls out here for
     * free: only the page being painted is gathered, so a graph on another
     * folder is never drawn.
     */
    const presenter = new FakePresenter({ rows: 3, cols: 5 });
    const surfaces = plugin();
    const controller = new DeckController(presenter, new ActionRegistry(), {
      surfaces: surfaces.draw,
    });

    controller.load({
      formatVersion: PROFILE_FORMAT_VERSION,
      id: 'two',
      name: 'Two',
      layout: { rows: 3, cols: 5 },
      root: {
        id: 'root',
        name: 'Root',
        pages: [{ id: 'main', buttons: [button(0, {})] }],
        folders: [
          { id: 'away', name: 'Away', pages: [{ id: 'other', buttons: [button(1, widget)] }] },
        ],
      },
    });
    await controller.start();

    assert.deepEqual(surfaces.asked, []);
  });

  it('lets a plugin that throws leave the key blank rather than stop the deck', async () => {
    const presenter = new FakePresenter({ rows: 3, cols: 5 });
    const controller = new DeckController(presenter, new ActionRegistry(), {
      surfaces: async () => {
        throw new Error('the graph is on fire');
      },
    });
    // Nothing listens for `error` here on purpose: an EventEmitter with no
    // listener throws on emit, and a deck that dies because a picture failed
    // is the failure this is about.
    controller.on('error', () => undefined);

    controller.load(profileWith([button(3, widget)]));
    await controller.start();

    assert.equal(presenter.scene?.regions[0]?.image, undefined);
    assert.equal(presenter.scene?.regions[0]?.labels?.[0]?.text, 'k3');
  });
});

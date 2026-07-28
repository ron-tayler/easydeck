import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { InvalidProfileError } from '../domain/errors.js';
import { PROFILE_FORMAT_VERSION } from '../domain/profile.js';
import type { ButtonDefinition, ProfileDefinition } from '../domain/profile.js';
import { validateProfile } from '../domain/validate-profile.js';
import { ActionRegistry } from './action-registry.js';
import { DeckController } from './deck-controller.js';
import type { KeyRendererPort } from './ports/renderer-port.js';
import type { SurfacePort } from './ports/surface-port.js';

const GIF = 'data:image/gif;base64,AAAA';

const surface: SurfacePort = {
  layout: { rows: 3, cols: 5 },
  onKeyDown: () => () => {},
  onKeyUp: () => () => {},
  setKeyImage: async () => {},
  clearKey: async () => {},
};

const renderer: KeyRendererPort = { render: async () => new Uint8Array() };

/** A plain button: its own label, its own picture, one key. */
function plain(key: number, label: string, extras: Partial<ButtonDefinition> = {}): ButtonDefinition {
  return {
    id: `b${key}`,
    key,
    states: [
      { id: 'default', visual: { background: '#111111', icon: { source: 'own.png' }, label: { text: label } } },
    ],
    ...extras,
  };
}

function profileWith(buttons: readonly ButtonDefinition[]): ProfileDefinition {
  return {
    formatVersion: PROFILE_FORMAT_VERSION,
    id: 'm',
    name: 'M',
    layout: { rows: 3, cols: 5 },
    root: { id: 'root', name: 'Root', pages: [{ id: 'main', buttons }] },
  };
}

function controllerFor(buttons: readonly ButtonDefinition[]): DeckController {
  const controller = new DeckController(surface, renderer, new ActionRegistry());
  controller.load(profileWith(buttons));
  return controller;
}

/** The merged button sits at key 5 and covers three across, two down. */
const merged: ButtonDefinition = {
  id: 'big',
  key: 5,
  colSpan: 3,
  rowSpan: 2,
  states: [
    { id: 'default', visual: { background: '#004400', icon: { source: GIF }, label: { text: 'big' } } },
  ],
};

describe('a button merged across several keys', () => {
  it('gives every covered key its own cell of one picture', () => {
    const views = new Map(
      controllerFor([merged]).view().map((view) => [view.key, view.visual.backdrop]),
    );

    assert.deepEqual({ col: views.get(5)!.col, row: views.get(5)!.row }, { col: 0, row: 0 });
    assert.deepEqual({ col: views.get(7)!.col, row: views.get(7)!.row }, { col: 2, row: 0 });
    assert.deepEqual({ col: views.get(11)!.col, row: views.get(11)!.row }, { col: 1, row: 1 });

    // Every cell must agree on the region's size, or the seams move.
    for (const key of [5, 6, 7, 10, 11, 12]) {
      assert.deepEqual(
        { cols: views.get(key)!.cols, rows: views.get(key)!.rows, source: views.get(key)!.source },
        { cols: 3, rows: 2, source: GIF },
      );
    }
  });

  /** The whole reason for merging only the picture. */
  it('keeps the buttons underneath, with their own labels and actions', () => {
    const controller = controllerFor([merged, plain(6, 'six'), plain(11, 'eleven')]);
    const views = new Map(controller.view().map((view) => [view.key, view]));

    assert.equal(views.get(6)!.visual.label?.text, 'six');
    assert.equal(views.get(11)!.visual.label?.text, 'eleven');
    assert.equal(views.get(6)!.buttonId, 'b6', 'the key still belongs to its own button');
  });

  it('overrides the covered buttons’ own picture and fill', () => {
    const controller = controllerFor([merged, plain(6, 'six')]);
    const covered = controller.view().find((view) => view.key === 6)!;

    assert.equal(covered.visual.icon, undefined, 'its own picture is ignored');
    assert.equal(covered.visual.backdrop?.source, GIF, 'it shows the merged one instead');
    assert.equal(covered.visual.background, '#004400', 'the fill comes from the merged button');
  });

  it('covers keys that hold no button at all', () => {
    const views = controllerFor([merged]).view();
    const keys = views.map((view) => view.key).sort((a, b) => a - b);

    assert.deepEqual(keys, [5, 6, 7, 10, 11, 12]);
    assert.equal(views.find((view) => view.key === 12)!.buttonId, 'big');
  });

  it('leaves keys outside the region untouched', () => {
    const controller = controllerFor([merged, plain(0, 'zero'), plain(13, 'thirteen')]);
    const views = new Map(controller.view().map((view) => [view.key, view]));

    assert.equal(views.get(0)!.visual.backdrop, undefined);
    assert.equal(views.get(0)!.visual.icon?.source, 'own.png', 'keeps its own picture');
    assert.equal(views.get(13)!.visual.backdrop, undefined);
  });

  /** A merged button has states like any other, so the region can change. */
  it('repaints the whole region when the merged button changes state', () => {
    const twoState: ButtonDefinition = {
      id: 'big',
      key: 0,
      colSpan: 2,
      rowSpan: 1,
      stateFrom: 'mode',
      states: [
        { id: 'calm', visual: { icon: { source: 'calm.gif' } } },
        { id: 'loud', visual: { icon: { source: 'loud.gif' } } },
      ],
    };

    const controller = controllerFor([twoState]);
    controller.variables.set('mode', 'calm');
    let views = new Map(controller.view().map((view) => [view.key, view.visual.backdrop?.source]));
    assert.deepEqual([views.get(0), views.get(1)], ['calm.gif', 'calm.gif']);

    controller.variables.set('mode', 'loud');
    views = new Map(controller.view().map((view) => [view.key, view.visual.backdrop?.source]));
    assert.deepEqual([views.get(0), views.get(1)], ['loud.gif', 'loud.gif']);
  });
});

describe('validating a merge', () => {
  const check = (button: ButtonDefinition) => () => validateProfile(profileWith([button]));

  it('refuses a region running past the right edge', () => {
    assert.throws(check({ ...merged, key: 3, colSpan: 3, rowSpan: 1 }), InvalidProfileError);
  });

  it('refuses a region running past the bottom', () => {
    assert.throws(check({ ...merged, key: 10, colSpan: 1, rowSpan: 2 }), InvalidProfileError);
  });

  /** A spreadsheet refuses to merge over a merge, and for the same reason. */
  it('refuses two merges that overlap', () => {
    assert.throws(
      () =>
        validateProfile(
          profileWith([
            { ...merged, id: 'a', key: 0, colSpan: 3, rowSpan: 1 },
            { ...merged, id: 'b', key: 2, colSpan: 3, rowSpan: 1 },
          ]),
        ),
      /both span key 2/,
    );
  });

  it('accepts a region that fits exactly', () => {
    assert.doesNotThrow(check({ ...merged, key: 5, colSpan: 5, rowSpan: 2 }));
  });
});

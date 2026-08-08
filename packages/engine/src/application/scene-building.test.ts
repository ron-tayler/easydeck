import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PROFILE_FORMAT_VERSION } from '../domain/profile.js';
import type { ButtonDefinition, ProfileDefinition } from '../domain/profile.js';
import { ActionRegistry } from './action-registry.js';
import { DeckController } from './deck-controller.js';
import { FakePresenter } from './test-doubles.js';

const GIF = 'data:image/gif;base64,AAAA';

function button(key: number, overrides: Partial<ButtonDefinition> = {}, visual = {}): ButtonDefinition {
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
    id: 'scene',
    name: 'Scene',
    layout: { rows: 3, cols: 5 },
    root: { id: 'root', name: 'Root', pages: [{ id: 'main', buttons }] },
  };
}

async function present(buttons: readonly ButtonDefinition[]): Promise<FakePresenter> {
  const presenter = new FakePresenter({ rows: 3, cols: 5 });
  const controller = new DeckController(presenter, new ActionRegistry());
  controller.load(profileWith(buttons));
  await controller.start();
  return presenter;
}

describe('building a scene', () => {
  it('gives an ordinary button a region of one key', async () => {
    const presenter = await present([button(7)]);

    assert.deepEqual(presenter.scene?.regions.map((region) => [region.key, region.cols, region.rows]), [
      [7, 1, 1],
    ]);
  });

  it('gives a merged picture one region rather than a slice per key', async () => {
    // The whole reason the scene is written in regions: the compositor lays
    // the picture out once across the rectangle instead of once per key.
    const presenter = await present([
      button(5, { colSpan: 3, rowSpan: 2 }, { icon: { source: GIF }, background: '#004400' }),
    ]);

    const [region] = presenter.scene!.regions;
    assert.deepEqual([region!.key, region!.cols, region!.rows], [5, 3, 2]);
    assert.equal(region!.image?.asset.source, GIF);
    assert.equal(region!.background, '#004400');
  });

  it('carries a picture by name, never by its bytes', async () => {
    // Scene comparison happens on every variable change; a data URL taking
    // part in it is what cost 31ms per repaint on the old path.
    const presenter = await present([button(0, {}, { icon: { source: GIF } })]);
    const asset = presenter.scene!.regions[0]!.image!.asset;

    assert.ok(asset.id.length < 32, `expected a short name, got ${asset.id.length} characters`);
    assert.notEqual(asset.id, asset.source);
  });

  it('the same picture gets the same name, a different one does not', async () => {
    const shared = await present([
      button(0, {}, { icon: { source: GIF } }),
      button(1, {}, { icon: { source: GIF } }),
      button(2, {}, { icon: { source: 'data:image/gif;base64,BBBB' } }),
    ]);

    const [first, second, third] = shared.scene!.regions;
    assert.equal(first!.image!.asset.id, second!.image!.asset.id);
    assert.notEqual(first!.image!.asset.id, third!.image!.asset.id);
  });

  it('keeps every covered key label inside the merged region', async () => {
    // One picture across six keys, each still saying what it does.
    const presenter = await present([
      button(5, { colSpan: 3, rowSpan: 2 }, { icon: { source: GIF } }),
      button(6),
      button(11),
    ]);

    const labels = presenter.scene!.regions[0]!.labels ?? [];
    assert.deepEqual(
      labels.map((label) => [label.col, label.row, label.text]).sort(),
      [[0, 0, 'k5'], [1, 0, 'k6'], [1, 1, 'k11']].sort(),
    );
  });

  it('does not give a covered key a region of its own', async () => {
    const presenter = await present([
      button(5, { colSpan: 3, rowSpan: 2 }, { icon: { source: GIF } }),
      button(6),
    ]);

    assert.equal(presenter.scene!.regions.length, 1);
  });

  it('hands the scene over again only when something changed', async () => {
    const presenter = new FakePresenter({ rows: 3, cols: 5 });
    const controller = new DeckController(presenter, new ActionRegistry());
    controller.load(profileWith([button(0, {}, { label: { text: '{{n}}' } })]));
    await controller.start();

    const presented = presenter.scenes.length;
    controller.variables.set('n', 1);
    await new Promise((resolve) => setImmediate(resolve));
    const afterChange = presenter.scenes.length;

    controller.variables.set('n', 1); // same value, same scene
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(afterChange, presented + 1, 'a changed label should reach the panel');
    assert.equal(presenter.scenes.length, afterChange, 'an unchanged scene should not');
  });
});

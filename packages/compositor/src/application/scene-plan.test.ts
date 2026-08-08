import assert from 'node:assert/strict';
import { test } from 'node:test';

import { regionKey, tileKey } from '../domain/keys.js';
import type { PanelFormat } from '../domain/panel-format.js';
import type { Scene, SceneRegion } from '../domain/scene.js';
import { needsWork, planScene } from './scene-plan.js';

const FORMAT: PanelFormat = {
  rows: 3,
  cols: 5,
  tileWidth: 112,
  tileHeight: 112,
  gap: 14,
  rotationDegrees: 180,
  maxTileBytes: 10240,
};

const ASSET = { id: 'sha1-cat', source: 'cat.gif' };

/** What the panel would hold after this scene was fully painted. */
function painted(scene: Scene): Map<number, string> {
  const state = new Map<number, string>();
  for (const planned of planScene(FORMAT, scene, new Map()).regions) {
    for (const tile of planned.tiles) state.set(tile.key, tile.tileKey);
  }
  return state;
}

const STRETCHED: Scene = {
  regions: [{ key: 0, cols: 3, rows: 2, image: { asset: ASSET } }],
};

test('an empty panel needs every tile written', () => {
  const plan = planScene(FORMAT, STRETCHED, new Map());

  assert.equal(plan.regions.length, 1);
  assert.equal(plan.regions[0]!.tiles.length, 6);
  assert.equal(plan.regions[0]!.stale.length, 6);
  assert.deepEqual(plan.cleared, []);
});

test('a panel already showing the scene needs nothing written', () => {
  const plan = planScene(FORMAT, STRETCHED, painted(STRETCHED));

  assert.equal(plan.regions[0]!.stale.length, 0);
  assert.equal(needsWork(plan.regions[0]!), false);
});

test('a region with nothing stale is still live', () => {
  // "Nothing to redraw" is not "nothing to do": an animating region keeps
  // animating, and dropping it from `live` would freeze it.
  const plan = planScene(FORMAT, STRETCHED, painted(STRETCHED));

  assert.ok(plan.live.has(regionKey(FORMAT, STRETCHED.regions[0]!)));
});

test('one changed label leaves the rest of the region alone', () => {
  const before = painted(STRETCHED);
  const relabelled: Scene = {
    regions: [{ ...STRETCHED.regions[0]!, labels: [{ col: 1, row: 0, text: '42' }] }],
  };

  const plan = planScene(FORMAT, relabelled, before);
  const stale = plan.regions[0]!.stale;

  assert.equal(stale.length, 1);
  assert.equal(stale[0]!.key, 1);
});

test('a key the new scene does not cover is cleared', () => {
  const before = painted(STRETCHED);
  const smaller: Scene = { regions: [{ key: 0, cols: 1, rows: 1, image: { asset: ASSET } }] };

  const plan = planScene(FORMAT, smaller, before);

  assert.deepEqual(plan.cleared, [1, 2, 5, 6, 7]);
});

test('a panel that lost its picture is repainted even though the scene is unchanged', () => {
  // A reconnected device is blank however many scenes it was shown. Planning
  // against the previous scene would call this "unchanged" and leave it blank.
  const plan = planScene(FORMAT, STRETCHED, new Map());

  assert.equal(plan.regions[0]!.stale.length, 6);
});

test('a single failed key is retried without redoing the region', () => {
  const before = painted(STRETCHED);
  before.delete(5); // this one key never made it to the panel

  const plan = planScene(FORMAT, STRETCHED, before);

  assert.equal(plan.regions[0]!.stale.length, 1);
  assert.equal(plan.regions[0]!.stale[0]!.key, 5);
});

test('the same picture in the same geometry survives a page change', () => {
  // Paging away and back must not cancel work in flight, so the region key has
  // to match across scenes that happen to show the same thing.
  const elsewhere: Scene = {
    regions: [{ key: 5, cols: 3, rows: 2, image: { asset: ASSET } } satisfies SceneRegion],
  };

  const first = planScene(FORMAT, STRETCHED, new Map());
  const second = planScene(FORMAT, elsewhere, new Map());

  assert.deepEqual([...first.live], [...second.live]);
});

test('tile keys are unique across the whole scene', () => {
  const scene: Scene = {
    regions: [
      { key: 0, cols: 3, rows: 2, image: { asset: ASSET } },
      { key: 3, cols: 2, rows: 2, image: { asset: ASSET } },
      { key: 10, cols: 5, rows: 1 },
    ],
  };

  const plan = planScene(FORMAT, scene, new Map());
  const keys = plan.regions.flatMap((planned) => planned.tiles.map((tile) => tile.key));

  assert.equal(new Set(keys).size, keys.length);
});

test('a plan describes every key of the panel it touches', () => {
  const full: Scene = { regions: [{ key: 0, cols: 5, rows: 3, image: { asset: ASSET } }] };
  const plan = planScene(FORMAT, full, new Map());

  assert.equal(plan.regions[0]!.tiles.length, 15);
  assert.equal(
    tileKey(regionKey(FORMAT, full.regions[0]!), full.regions[0]!, 4, 2),
    plan.regions[0]!.tiles[14]!.tileKey,
  );
});

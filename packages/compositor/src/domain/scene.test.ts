import assert from 'node:assert/strict';
import { test } from 'node:test';

import { InvalidSceneError } from './errors.js';
import type { PanelFormat } from './panel-format.js';
import { regionGeometry, tileOrigin } from './panel-format.js';
import { cellOf, cornersOf, labelAt, regionKeys, validateScene } from './scene.js';
import type { SceneRegion } from './scene.js';

const FORMAT: PanelFormat = {
  rows: 3,
  cols: 5,
  tileWidth: 112,
  tileHeight: 112,
  gap: 14,
  rotationDegrees: 180,
  maxTileBytes: 10240,
};

test('a region covers its keys in row-major order', () => {
  const region: SceneRegion = { key: 6, cols: 3, rows: 2 };
  assert.deepEqual(regionKeys(FORMAT, region), [6, 7, 8, 11, 12, 13]);
});

test('a single key is a region like any other', () => {
  assert.deepEqual(regionKeys(FORMAT, { key: 7, cols: 1, rows: 1 }), [7]);
});

test('cells are found only inside the region', () => {
  const region: SceneRegion = { key: 6, cols: 3, rows: 2 };

  assert.deepEqual(cellOf(FORMAT, region, 6), { col: 0, row: 0 });
  assert.deepEqual(cellOf(FORMAT, region, 13), { col: 2, row: 1 });
  assert.equal(cellOf(FORMAT, region, 5), undefined);
  assert.equal(cellOf(FORMAT, region, 14), undefined);
});

test('the region is measured across the panel, gaps included', () => {
  // What falls between two displays is behind the bezel and must be skipped,
  // not squeezed into the visible strips.
  const geometry = regionGeometry(FORMAT, 3, 2);

  assert.equal(geometry.width, 112 * 3 + 14 * 2);
  assert.equal(geometry.height, 112 * 2 + 14);
});

test('tiles sit a full key plus a gap apart', () => {
  assert.deepEqual(tileOrigin(FORMAT, 0, 0), { x: 0, y: 0 });
  assert.deepEqual(tileOrigin(FORMAT, 2, 1), { x: 2 * 126, y: 126 });
});

test('only the outer corners of a region are rounded', () => {
  const region: SceneRegion = { key: 0, cols: 3, rows: 2 };

  assert.deepEqual(cornersOf(region, 0, 0), {
    topLeft: true, topRight: false, bottomRight: false, bottomLeft: false,
  });
  assert.deepEqual(cornersOf(region, 2, 1), {
    topLeft: false, topRight: false, bottomRight: true, bottomLeft: false,
  });
  // A middle cell faces the picture on every side.
  assert.deepEqual(cornersOf(region, 1, 0), {
    topLeft: false, topRight: false, bottomRight: false, bottomLeft: false,
  });
});

test('a lone key rounds all four corners', () => {
  assert.deepEqual(cornersOf({ key: 0, cols: 1, rows: 1 }, 0, 0), {
    topLeft: true, topRight: true, bottomRight: true, bottomLeft: true,
  });
});

test('labels belong to a cell', () => {
  const region: SceneRegion = {
    key: 0,
    cols: 2,
    rows: 1,
    labels: [{ col: 1, row: 0, text: 'right' }],
  };

  assert.equal(labelAt(region, 1, 0)?.text, 'right');
  assert.equal(labelAt(region, 0, 0), undefined);
});

test('two regions cannot claim the same key', () => {
  assert.throws(
    () =>
      validateScene(FORMAT, {
        regions: [
          { key: 0, cols: 3, rows: 2 },
          { key: 7, cols: 1, rows: 1 },
        ],
      }),
    InvalidSceneError,
  );
});

test('a region cannot run off the edge of the panel', () => {
  assert.throws(() => validateScene(FORMAT, { regions: [{ key: 3, cols: 3, rows: 1 }] }), InvalidSceneError);
  assert.throws(() => validateScene(FORMAT, { regions: [{ key: 11, cols: 1, rows: 2 }] }), InvalidSceneError);
  assert.throws(() => validateScene(FORMAT, { regions: [{ key: 15, cols: 1, rows: 1 }] }), InvalidSceneError);
});

test('a region covers at least one key', () => {
  assert.throws(() => validateScene(FORMAT, { regions: [{ key: 0, cols: 0, rows: 1 }] }), InvalidSceneError);
});

test('a scene filling the panel exactly is valid', () => {
  validateScene(FORMAT, {
    regions: [
      { key: 0, cols: 5, rows: 2 },
      { key: 10, cols: 5, rows: 1 },
    ],
  });
});

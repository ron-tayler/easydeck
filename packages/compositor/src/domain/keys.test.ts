import assert from 'node:assert/strict';
import { test } from 'node:test';

import { regionKey, tileKey } from './keys.js';
import type { PanelFormat } from './panel-format.js';
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

const ASSET = { id: 'sha1-abc', source: 'data:image/gif;base64,AAAA' };

function region(overrides: Partial<SceneRegion> = {}): SceneRegion {
  return { key: 0, cols: 3, rows: 2, image: { asset: ASSET }, ...overrides };
}

test('a region key never contains the picture itself', () => {
  const bulky = { id: 'sha1-abc', source: `data:image/gif;base64,${'A'.repeat(100_000)}` };
  const key = regionKey(FORMAT, region({ image: { asset: bulky } }));

  assert.ok(key.length < 100, `expected a short key, got ${key.length} characters`);
  assert.ok(!key.includes('AAAA'));
  assert.ok(key.includes('sha1-abc'));
});

test('the same picture on a different panel is a different region', () => {
  const same = regionKey(FORMAT, region());
  assert.equal(regionKey({ ...FORMAT, tileWidth: 100 }, region()), regionKey({ ...FORMAT, tileWidth: 100 }, region()));
  assert.notEqual(same, regionKey({ ...FORMAT, tileWidth: 100 }, region()));
  assert.notEqual(same, regionKey({ ...FORMAT, gap: 0 }, region()));
  assert.notEqual(same, regionKey({ ...FORMAT, rotationDegrees: 0 }, region()));
  assert.notEqual(same, regionKey({ ...FORMAT, maxTileBytes: 8192 }, region()));
});

test('everything that changes the composed pixels changes the region key', () => {
  const base = regionKey(FORMAT, region());

  assert.notEqual(base, regionKey(FORMAT, region({ cols: 2 })));
  assert.notEqual(base, regionKey(FORMAT, region({ rows: 3 })));
  assert.notEqual(base, regionKey(FORMAT, region({ background: '#ff0000' })));
  assert.notEqual(base, regionKey(FORMAT, region({ cornerRadius: 0 })));
  assert.notEqual(base, regionKey(FORMAT, region({ image: { asset: ASSET, fit: 'contain' } })));
  assert.notEqual(base, regionKey(FORMAT, region({ image: undefined })));
});

test('labels do not take part in the region key', () => {
  // Two regions differing only in their text share every pixel underneath,
  // so they must share the composed region and only differ per tile.
  const plain = regionKey(FORMAT, region());
  const labelled = regionKey(FORMAT, region({ labels: [{ col: 0, row: 0, text: 'hello' }] }));

  assert.equal(plain, labelled);
});

test('moving a region does not change its picture', () => {
  // Key 0 and key 5 are both the left column, so the same rectangle of pixels.
  assert.equal(regionKey(FORMAT, region({ key: 0 })), regionKey(FORMAT, region({ key: 5 })));
});

test('each cell of a region gets its own tile key', () => {
  const key = regionKey(FORMAT, region());
  const seen = new Set<string>();

  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 3; col++) seen.add(tileKey(key, region(), col, row));
  }

  assert.equal(seen.size, 6);
});

test('label text cannot be confused with the fields around it', () => {
  const key = regionKey(FORMAT, region());
  const withSpaces = region({ labels: [{ col: 0, row: 0, text: 'red - -' }] });
  const withColor = region({ labels: [{ col: 0, row: 0, text: '', color: 'red' }] });

  // A separator-joined key would let a label's own text impersonate the fields
  // that follow it; these two must stay distinct.
  assert.notEqual(tileKey(key, withSpaces, 0, 0), tileKey(key, withColor, 0, 0));
});

test('a tile key covers every property of its label', () => {
  const key = regionKey(FORMAT, region());
  const base = { col: 0, row: 0, text: 'ok' } as const;
  const of = (label: Record<string, unknown>) =>
    tileKey(key, region({ labels: [{ ...base, ...label }] }), 0, 0);

  const plain = of({});
  assert.notEqual(plain, of({ text: 'other' }));
  assert.notEqual(plain, of({ color: '#fff' }));
  assert.notEqual(plain, of({ fontFamily: 'Inter' }));
  assert.notEqual(plain, of({ fontSize: 30 }));
  assert.notEqual(plain, of({ position: 'top' }));
});

test('corner rounding is part of the tile, not the region', () => {
  const key = regionKey(FORMAT, region());
  const single = region({ cols: 1, rows: 1 });

  // The top-left cell of a 3x2 rounds one corner; a lone key rounds all four.
  assert.notEqual(tileKey(key, region(), 0, 0), tileKey(key, single, 0, 0));
});

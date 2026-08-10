import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCanvas } from '@napi-rs/canvas';

import type { RgbaBitmap } from '../../domain/render-target.js';
import { CanvasPanelComposer } from './canvas-panel-composer.js';

const TILE = 100;
const GAP = 20;

/** A picture whose every column is a different, identifiable red level. */
function stripes(width: number, height: number): string {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  for (let x = 0; x < width; x++) {
    ctx.fillStyle = `rgb(${x % 256}, 0, 0)`;
    ctx.fillRect(x, 0, 1, height);
  }

  return `data:image/png;base64,${canvas.toBuffer('image/png').toString('base64')}`;
}

function pixel(bitmap: RgbaBitmap, x: number, y: number): [number, number, number] {
  const at = (y * bitmap.width + x) * 4;
  return [bitmap.data[at]!, bitmap.data[at + 1]!, bitmap.data[at + 2]!];
}

const SQUARE = {
  width: TILE,
  height: TILE,
  rotationDegrees: 0,
  cornerRadius: 0,
  corners: { topLeft: false, topRight: false, bottomRight: false, bottomLeft: false },
} as const;

test('a stretched picture skips what falls behind the bezel', async () => {
  // The region is measured across the panel, gaps included. The strip between
  // two displays is hidden by the bezel and must be skipped, not squeezed into
  // the visible strips — otherwise every seam repeats a sliver of the picture.
  const composer = new CanvasPanelComposer();
  const width = TILE * 2 + GAP;

  const source = await composer.open({ source: stripes(width, TILE), width, height: TILE });
  const region = source.composeFrame(0);

  const left = composer.cutTile(region, { ...SQUARE, x: 0, y: 0 });
  const right = composer.cutTile(region, { ...SQUARE, x: TILE + GAP, y: 0 });

  // Column 0 of the right-hand key is column 120 of the picture, not column
  // 100: the twenty columns in between are behind the bezel.
  assert.deepEqual(pixel(left, 0, 50), [0, 0, 0]);
  assert.deepEqual(pixel(left, 99, 50), [99, 0, 0]);
  assert.deepEqual(pixel(right, 0, 50), [120, 0, 0]);
  assert.deepEqual(pixel(right, 99, 50), [219, 0, 0]);
});

test('a picture fills a single key edge to edge', async () => {
  // No inset mode: a key showing a picture shows it across the whole key, and
  // a 1x1 region is not a special case.
  const composer = new CanvasPanelComposer();

  const source = await composer.open({
    source: stripes(TILE * 2, TILE),
    background: '#00ff00',
    width: TILE,
    height: TILE,
  });
  const tile = composer.cutTile(source.composeFrame(0), { ...SQUARE, x: 0, y: 0 });

  // Nothing of the background survives: `cover` filled the key.
  for (let x = 0; x < TILE; x += 10) {
    assert.equal(pixel(tile, x, 50)[1], 0, `background showing through at x=${x}`);
  }
});

test('a wide picture is cropped, never letterboxed', async () => {
  // There is one behaviour and no setting for it: a picture on a key fills the
  // key. A twice-as-wide picture loses its sides rather than gaining bars.
  const composer = new CanvasPanelComposer();

  const source = await composer.open({
    source: stripes(TILE * 2, TILE),
    background: '#00ff00',
    width: TILE,
    height: TILE,
  });
  const tile = composer.cutTile(source.composeFrame(0), { ...SQUARE, x: 0, y: 0 });

  // Top and bottom rows are picture, not background.
  assert.notDeepEqual(pixel(tile, 50, 2), [0, 255, 0]);
  assert.notDeepEqual(pixel(tile, 50, 97), [0, 255, 0]);
});

test('a region with no picture is just its background', async () => {
  const composer = new CanvasPanelComposer();

  const source = await composer.open({ background: '#0000ff', width: TILE, height: TILE });
  const tile = composer.cutTile(source.composeFrame(0), { ...SQUARE, x: 0, y: 0 });

  assert.deepEqual(pixel(tile, 50, 50), [0, 0, 255]);
});

test('the label goes over the picture, not into a strip of its own', async () => {
  const composer = new CanvasPanelComposer();

  const source = await composer.open({ source: stripes(TILE, TILE), width: TILE, height: TILE });
  const region = source.composeFrame(0);

  const plain = composer.cutTile(region, { ...SQUARE, x: 0, y: 0 });
  const labelled = composer.cutTile(region, {
    ...SQUARE,
    x: 0,
    y: 0,
    label: { text: 'ABC', color: '#ffffff', position: 'bottom' },
  });

  // The picture is untouched where the text is not...
  assert.deepEqual(pixel(labelled, 50, 10), pixel(plain, 50, 10));
  // ...and the text is drawn on top of it near the bottom edge.
  const changed = labelled.data.some((value, index) => value !== plain.data[index]);
  assert.ok(changed, 'the label left no mark');
});

test('rotation is baked into the tile', async () => {
  const composer = new CanvasPanelComposer();

  const source = await composer.open({ source: stripes(TILE, TILE), width: TILE, height: TILE });
  const region = source.composeFrame(0);

  const upright = composer.cutTile(region, { ...SQUARE, x: 0, y: 0 });
  const upsideDown = composer.cutTile(region, { ...SQUARE, x: 0, y: 0, rotationDegrees: 180 });

  // The panel is mounted upside down, so the darkest column has to end up on
  // the other side.
  assert.deepEqual(pixel(upright, 1, 50), pixel(upsideDown, TILE - 2, 50));
});

test('only the outer corners of a region are rounded', async () => {
  const composer = new CanvasPanelComposer();
  const width = TILE * 2 + GAP;

  const source = await composer.open({ source: stripes(width, TILE), width, height: TILE });
  const region = source.composeFrame(0);

  const rounded = composer.cutTile(region, {
    ...SQUARE,
    x: 0,
    y: 0,
    cornerRadius: 12,
    corners: { topLeft: true, topRight: false, bottomRight: false, bottomLeft: true },
  });

  // The left corners fall away to black; the right ones face the picture and
  // must stay put, or the seam gets a notch bitten out of it.
  assert.deepEqual(pixel(rounded, 0, 0), [0, 0, 0]);
  assert.notDeepEqual(pixel(rounded, TILE - 1, 0), [0, 0, 0]);
});

test('an unreadable picture is refused rather than silently skipped', async () => {
  const composer = new CanvasPanelComposer();

  await assert.rejects(() =>
    composer.open({ source: 'D:/nowhere/missing.png', width: TILE, height: TILE }),
  );
});

test('a failed press puts a warning sign in the corner, over the picture', async () => {
  // The panel is the only screen a physical deck has: a press that threw says
  // so on the key it happened on, or it says nothing anywhere.
  const composer = new CanvasPanelComposer();

  const source = await composer.open({
    source: stripes(TILE, TILE),
    background: '#000000',
    width: TILE,
    height: TILE,
  });
  const region = source.composeFrame(0);

  const quiet = composer.cutTile(region, { ...SQUARE, x: 0, y: 0 });
  const flagged = composer.cutTile(region, { ...SQUARE, x: 0, y: 0, alert: true });

  // Yellow, in the top-right quarter where the sign is drawn.
  const [r, g, b] = pixel(flagged, TILE - 20, 20);
  assert.ok(r > 200 && g > 150 && b < 100, `expected the sign, got ${[r, g, b].join()}`);

  // And nothing else moved: the opposite corner is the picture, untouched.
  assert.deepEqual(pixel(flagged, 10, TILE - 10), pixel(quiet, 10, TILE - 10));
});

/** Rows of the tile holding any text pixel, as bands of consecutive rows. */
function textBands(bitmap: RgbaBitmap): { from: number; to: number }[] {
  const bands: { from: number; to: number }[] = [];

  for (let y = 0; y < bitmap.height; y++) {
    let lit = false;
    for (let x = 0; x < bitmap.width && !lit; x++) {
      // The background is black; the label is white.
      lit = pixel(bitmap, x, y)[0] > 120;
    }

    const last = bands[bands.length - 1];
    if (!lit) continue;
    if (last && y - last.to <= 1) last.to = y;
    else bands.push({ from: y, to: y });
  }

  return bands;
}

test('a label too wide for the key wraps rather than shrinking away', async () => {
  // The panel used to drop the type to nine pixels rather than use the room
  // below, which is how the same label read fine in the window and tiny on the
  // device. Both surfaces now follow the same layout.
  const composer = new CanvasPanelComposer();
  const source = await composer.open({ background: '#000000', width: TILE, height: TILE });

  const tile = composer.cutTile(source.composeFrame(0), {
    ...SQUARE,
    x: 0,
    y: 0,
    label: { text: 'Open browser', fontSize: 22 },
  });

  assert.equal(textBands(tile).length, 2, 'expected two lines of text');
});

test('a label with no position of its own sits where the window puts it', async () => {
  // Middle on a plain key, bottom over a picture: the two surfaces disagreed
  // about exactly this.
  const composer = new CanvasPanelComposer();
  const source = await composer.open({ background: '#000000', width: TILE, height: TILE });
  const region = source.composeFrame(0);

  const plain = composer.cutTile(region, { ...SQUARE, x: 0, y: 0, label: { text: 'Hi' } });
  const over = composer.cutTile(region, {
    ...SQUARE,
    x: 0,
    y: 0,
    label: { text: 'Hi' },
    hasPicture: true,
  });

  const middle = textBands(plain)[0]!;
  const low = textBands(over)[0]!;

  assert.ok(middle.from > TILE * 0.3 && middle.to < TILE * 0.7, `centred, got ${middle.from}..${middle.to}`);
  assert.ok(low.from > TILE * 0.6, `expected the bottom, got ${low.from}..${low.to}`);
});

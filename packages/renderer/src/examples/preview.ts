/**
 * Renders the demo panel to a PNG contact sheet — lets you iterate on button
 * visuals without any hardware attached.
 *
 * Run with:  pnpm --filter @easydeck/renderer preview
 */
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { writeFile } from 'node:fs/promises';

import { createKeyRenderer } from '../index.js';
import { demoPanel } from './panel.js';

const OUTPUT = new URL('../../../../docs/panel-preview.png', import.meta.url);
/** Matches the D6 key display; see FIFINE_AMPLIGAME_D6.keyImage. */
const KEY_SIZE = 112;
const GAP = 10;
const ROWS = 3;
const COLS = 5;

async function main(): Promise<void> {
  const renderer = await createKeyRenderer();
  // Upright, so the sheet is readable; the device target uses rotation 180.
  const target = { width: KEY_SIZE, height: KEY_SIZE, rotationDegrees: 0 as const, maxBytes: 10240 };
  const panel = demoPanel({ micOn: true, counter: 0 });

  const sheet = createCanvas(COLS * KEY_SIZE + (COLS + 1) * GAP, ROWS * KEY_SIZE + (ROWS + 1) * GAP);
  const ctx = sheet.getContext('2d');
  ctx.fillStyle = '#15171a';
  ctx.fillRect(0, 0, sheet.width, sheet.height);

  for (let key = 0; key < ROWS * COLS; key++) {
    const x = GAP + (key % COLS) * (KEY_SIZE + GAP);
    const y = GAP + Math.floor(key / COLS) * (KEY_SIZE + GAP);
    const visual = panel.get(key);

    if (!visual) {
      ctx.strokeStyle = '#2c3036';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(x, y, KEY_SIZE, KEY_SIZE, 12);
      ctx.stroke();
      continue;
    }

    const jpeg = await renderer.render(visual, target);
    console.log(`key ${key}: ${jpeg.byteLength} bytes`);
    ctx.drawImage(await loadImage(Buffer.from(jpeg)), x, y);
  }

  await writeFile(OUTPUT, sheet.toBuffer('image/png'));
  console.log(`Written ${OUTPUT.pathname}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

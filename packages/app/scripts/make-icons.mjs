/**
 * Draws the EasyDeck mark and writes the PNGs the app ships.
 *
 * A generator rather than hand-made files: the icon is a handful of rectangles,
 * and keeping the source as code means the next size or a colour change is an
 * edit here instead of a binary nobody can diff. Run with `pnpm icons`.
 *
 * PNG specifically — Electron's nativeImage decodes PNG and JPEG only, so the
 * SVG data URL this replaced silently produced an empty image and no icon.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCanvas } from '@napi-rs/canvas';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');

/** The UI's accent, so the icon and the app look like the same product. */
const BACKGROUND = '#1668dc';
const KEYS = '#ffffff';

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

/**
 * A three-by-three grid of keys.
 *
 * Not the D6's actual three-by-five: at sixteen pixels fifteen keys collapse
 * into a smudge, and an icon has to survive its smallest size before it has to
 * be accurate.
 */
function draw(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = BACKGROUND;
  roundedRect(ctx, 0, 0, size, size, size * 0.22);
  ctx.fill();

  const margin = size * 0.17;
  const gap = size * 0.055;
  const key = (size - margin * 2 - gap * 2) / 3;

  ctx.fillStyle = KEYS;
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) {
      roundedRect(
        ctx,
        margin + column * (key + gap),
        margin + row * (key + gap),
        key,
        key,
        Math.max(0.5, key * 0.22),
      );
      ctx.fill();
    }
  }

  return canvas.toBuffer('image/png');
}

await mkdir(OUT, { recursive: true });

// 16 and 32 are the tray at 100% and 200% scaling; 256 is the window, where the
// same mark has room to breathe. 512 is the installers': macOS refuses to build
// an .icns from anything smaller, and every other packager scales down cleanly
// from it.
for (const size of [16, 32, 256, 512]) {
  const file = join(OUT, `icon-${size}.png`);
  await writeFile(file, draw(size));
  console.log(`wrote ${file}`);
}

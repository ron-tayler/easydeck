/**
 * Milestone 1 proof of concept: discover the D6, light it up, echo key events.
 *
 * Run with:  pnpm --filter @easydeck/device poc
 *
 * Every key gets its own solid-color JPEG; pressing a key flashes it white.
 * Ctrl+C clears the panel and exits cleanly.
 */
import jpeg from 'jpeg-js';

import { createDeviceManager, keyCount, type Surface } from '../index.js';

function solidJpeg(surfaceFormat: { width: number; height: number }, r: number, g: number, b: number): Buffer {
  const { width, height } = surfaceFormat;
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = r;
    rgba[i + 1] = g;
    rgba[i + 2] = b;
    rgba[i + 3] = 0xff;
  }
  return jpeg.encode({ width, height, data: rgba }, 90).data;
}

function keyColor(key: number, total: number): [number, number, number] {
  const hue = (key / total) * 360;
  const c = 200;
  const x = Math.round(c * (1 - Math.abs(((hue / 60) % 2) - 1)));
  const sector = Math.floor(hue / 60) % 6;
  const rgb: Array<[number, number, number]> = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ];
  return rgb[sector] ?? [c, c, c];
}

async function main(): Promise<void> {
  const manager = createDeviceManager();

  const devices = await manager.list();
  if (devices.length === 0) {
    console.error('No supported device found. Check the cable carries data, then re-plug.');
    process.exitCode = 1;
    return;
  }

  for (const d of devices) {
    console.log(`Found: ${d.model.name} (${d.hid.path})`);
  }

  const surface: Surface = await manager.open(devices[0]!, { brightness: 60 });
  console.log(`Opened ${surface.info.modelName}, layout ${surface.layout.rows}x${surface.layout.cols}`);

  const total = keyCount(surface.layout);
  const white = solidJpeg(surface.keyImage, 255, 255, 255);
  const palette: Buffer[] = [];

  for (let key = 0; key < total; key++) {
    const [r, g, b] = keyColor(key, total);
    const image = solidJpeg(surface.keyImage, r, g, b);
    palette.push(image);
    await surface.setKeyImage(key, image);
  }
  console.log('All keys painted. Press keys on the device; Ctrl+C to exit.');

  surface.on('keyDown', (e) => {
    console.log(`keyDown  key=${e.key} row=${e.row} col=${e.col}`);
    void surface.setKeyImage(e.key, white).catch((err) => console.error(err));
  });
  surface.on('keyUp', (e) => {
    console.log(`keyUp    key=${e.key} row=${e.row} col=${e.col}`);
    void surface.setKeyImage(e.key, palette[e.key]!).catch((err) => console.error(err));
  });
  surface.on('error', (err) => console.error('Device error:', err.message));
  surface.on('disconnected', () => {
    console.error('Device disconnected.');
    process.exit(1);
  });

  process.on('SIGINT', () => {
    console.log('\nCleaning up...');
    void surface
      .clearAllKeys()
      .then(() => surface.close())
      .finally(() => process.exit(0));
  });
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

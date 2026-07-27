/**
 * Shows what the firmware believes is pressed, on the device itself.
 *
 * Run with:  pnpm --filter @easydeck/device key-monitor
 *
 * A held key lights up white and stays lit until its release arrives, so the
 * panel is a live picture of the device's own key state. Hold two keys at
 * once: if only one stays lit, the firmware tracks a single key at a time,
 * which a driver has to compensate for rather than trust.
 *
 * Every event is also logged with the full set of keys currently believed to
 * be down.
 */
import jpeg from 'jpeg-js';

import { createDeviceManager, keyCount } from '../index.js';
import type { KeyImageFormat, Surface } from '../index.js';

function solidJpeg(format: KeyImageFormat, r: number, g: number, b: number): Buffer {
  const { width, height } = format;
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = r;
    rgba[i + 1] = g;
    rgba[i + 2] = b;
    rgba[i + 3] = 0xff;
  }
  return jpeg.encode({ width, height, data: rgba }, 80).data;
}

async function main(): Promise<void> {
  const surface: Surface = await createDeviceManager().openFirst({ brightness: 70 });
  console.log(`Opened ${surface.info.modelName}`);

  const idle = solidJpeg(surface.keyImage, 24, 28, 34);
  const held = solidJpeg(surface.keyImage, 255, 255, 255);
  const total = keyCount(surface.layout);

  for (let key = 0; key < total; key++) await surface.setKeyImage(key, idle);

  console.log('\nHold two keys at the same time and watch the panel.');
  console.log('Both stay white -> the firmware reports simultaneous holds.');
  console.log('Only one stays white -> it tracks a single key at a time.\n');

  const down = new Set<number>();
  const started = Date.now();
  const log = (event: string, key: number) => {
    const ms = String(Date.now() - started).padStart(6);
    const list = down.size === 0 ? '-' : [...down].sort((a, b) => a - b).join(', ');
    console.log(`${ms}ms  ${event.padEnd(4)} key ${String(key).padStart(2)}   held now: ${list}`);
  };

  surface.on('keyDown', (event) => {
    down.add(event.key);
    log('DOWN', event.key);
    void surface.setKeyImage(event.key, held).catch((error) => console.error(error));
  });

  surface.on('keyUp', (event) => {
    down.delete(event.key);
    log('up', event.key);
    void surface.setKeyImage(event.key, idle).catch((error) => console.error(error));
  });

  surface.on('error', (error) => console.error('Device error:', error.message));

  process.on('SIGINT', () => {
    void surface
      .clearAllKeys()
      .then(() => surface.close())
      .finally(() => process.exit(0));
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

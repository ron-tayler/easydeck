/**
 * Renderer live demo: real-looking buttons on the D6.
 *
 * Run with:  pnpm --filter @easydeck/renderer demo
 *
 * Draws a mock streamer panel. Key 0 toggles the mic visual, key 4 counts
 * presses — a taste of the multi-state buttons and variables the engine zone
 * will automate.
 */
import { createDeviceManager } from '@easydeck/device';

import { createKeyRenderer } from '../index.js';
import { demoPanel } from './panel.js';

async function main(): Promise<void> {
  const manager = createDeviceManager();
  const surface = await manager.openFirst({ brightness: 60 });
  const renderer = await createKeyRenderer();
  console.log(`Opened ${surface.info.modelName}`);

  const state = { micOn: true, counter: 0 };

  const paint = async (keys?: number[]): Promise<void> => {
    const panel = demoPanel(state);
    for (const [key, visual] of panel) {
      if (keys && !keys.includes(key)) continue;
      const jpeg = await renderer.render(visual, surface.keyImage);
      await surface.setKeyImage(key, Buffer.from(jpeg));
    }
  };

  const started = Date.now();
  await paint();
  console.log(`Panel rendered in ${Date.now() - started}ms.`);
  console.log('Key 0 toggles the mic, key 4 counts presses. Ctrl+C to exit.');

  surface.on('keyDown', (e) => {
    void (async () => {
      console.log(`keyDown key=${e.key} row=${e.row} col=${e.col}`);
      if (e.key === 0) {
        state.micOn = !state.micOn;
        await paint([0]);
      } else if (e.key === 4) {
        state.counter += 1;
        await paint([4]);
      }
    })().catch((err) => console.error(err));
  });

  surface.on('error', (err) => console.error('Device error:', err.message));

  process.on('SIGINT', () => {
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

import type { Surface } from '@easydeck/device';
import { numberParam } from '@easydeck/engine';
import type { ActionRegistry } from '@easydeck/engine';

/** Actions that drive the deck hardware itself. */
export function registerDeviceActions(registry: ActionRegistry, surface: Surface): ActionRegistry {
  registry.register('set-brightness', async (params) => {
    await surface.setBrightness(numberParam(params, 'percent', 60));
  });

  registry.register('sleep-panel', async () => {
    await surface.sleep();
  });

  registry.register('wake-panel', async () => {
    await surface.wake();
  });

  return registry;
}

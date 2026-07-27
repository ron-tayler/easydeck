import { createDeviceManager } from '@easydeck/device';
import type { Surface } from '@easydeck/device';
import { ActionRegistry, DeckController, createActionRegistry } from '@easydeck/engine';
import type { ProfileDefinition } from '@easydeck/engine';
import { createKeyRenderer } from '@easydeck/renderer';

import { toKeyRendererPort } from './infrastructure/renderer-adapter.js';
import { toSurfacePort } from './infrastructure/surface-adapter.js';

export interface StartDeckOptions {
  readonly profile: ProfileDefinition;
  /** 0..100, defaults to 60. */
  readonly brightness?: number;
  /**
   * Registry to run actions from. Defaults to the engine's built-ins; pass a
   * pre-populated one to add actions that touch the operating system.
   */
  readonly actions?: ActionRegistry;
}

export interface RunningDeck {
  readonly surface: Surface;
  readonly controller: DeckController;
  stop(): Promise<void>;
}

/**
 * Opens the first supported device and runs a profile on it.
 *
 * This is the whole stack in one call, and the shape the daemon's service
 * will be built around.
 */
export async function startDeck(options: StartDeckOptions): Promise<RunningDeck> {
  const surface = await createDeviceManager().openFirst({ brightness: options.brightness ?? 60 });

  try {
    const renderer = await createKeyRenderer();
    const controller = new DeckController(
      toSurfacePort(surface),
      toKeyRendererPort(renderer, surface.keyImage),
      options.actions ?? createActionRegistry(),
    );

    controller.load(options.profile);
    await controller.start();

    return {
      surface,
      controller,
      async stop() {
        await controller.stop();
        await surface.clearAllKeys();
        await surface.close();
      },
    };
  } catch (error) {
    await surface.close().catch(() => undefined);
    throw error;
  }
}

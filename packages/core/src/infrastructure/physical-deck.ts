import { PanelCompositor } from '@easydeck/compositor';
import type { Surface } from '@easydeck/device';
import { DeckController } from '@easydeck/engine';
import type { ActionRegistry, VariableStore } from '@easydeck/engine';
import { CanvasPanelComposer, TileEncoder, createJpegEncoder } from '@easydeck/renderer';

import { toComposerPort } from './composer-adapter.js';
import { toEncoderPort, toPanelFormat, toPanelPort, toPresenterPort } from './panel-adapter.js';

export interface PhysicalDeckOptions {
  readonly surface: Surface;
  readonly id: string;
  readonly name: string;
  readonly actions: ActionRegistry;
  /** Shared across every deck; see DeckRegistry. */
  readonly variables: VariableStore;
}

/**
 * The whole stack for one panel: compositor, controller and the adapters that
 * join the zones.
 *
 * Built per deck rather than per process, because each panel has its own
 * geometry, its own animation timers and its own idea of what is on its keys.
 * What is *not* per deck is the variables and the action registry, which is
 * why both are passed in.
 */
export async function createPhysicalDeck(options: PhysicalDeckOptions): Promise<{
  readonly id: string;
  readonly name: string;
  readonly controller: DeckController;
  readonly compositor: PanelCompositor;
  readonly surface: Surface;
}> {
  const format = toPanelFormat(options.surface);
  const encoder = new TileEncoder(await createJpegEncoder());

  const compositor = new PanelCompositor(
    toPanelPort(options.surface),
    toComposerPort(new CanvasPanelComposer(), format),
    toEncoderPort(encoder),
    format,
  );

  const controller = new DeckController(
    toPresenterPort(options.surface, compositor),
    options.actions,
    { variables: options.variables, deckId: options.id },
  );

  return {
    id: options.id,
    name: options.name,
    controller,
    compositor,
    surface: options.surface,
  };
}

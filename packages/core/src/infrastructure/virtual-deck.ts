import { DeckController } from '@easydeck/engine';
import type {
  ActionRegistry,
  PresenterPort,
  ProfileDefinition,
  Scene,
  SurfaceProvider,
  VariableStore,
} from '@easydeck/engine';

/**
 * The deck that stands in for one, while there is none.
 *
 * Only ever one of them, so the id is a constant: it is not a device, it is
 * the absence of every device.
 */
export const VIRTUAL_DECK_ID = 'virtual';

/** What the daemon calls it; the configurator says it in the user's language. */
export const VIRTUAL_DECK_NAME = 'Virtual deck';

/**
 * A deck with nowhere to draw.
 *
 * Without it, a machine with no panel plugged in has no deck at all — and
 * everything a person opens the window for hangs off a deck. The profile being
 * edited is the one a deck is running; the page shown in the editor is the page
 * a deck is on; even the network section, the one place someone would go to let
 * a tablet in, is part of the state a deck reports. So a computer with nothing
 * plugged into it could not be used to prepare for the thing being plugged in,
 * which is exactly when somebody sits down to prepare.
 *
 * The engine does not care that the pixels go nowhere. It resolves buttons,
 * runs actions, keeps a page and a history, and announces every repaint with
 * the views in it — which is what the configurator draws. `present` is where
 * that would become a picture on a panel, and here it is where it stops.
 *
 * It takes the shape of whatever profile is put on it, unlike a panel, whose
 * grid is a fact about the hardware. There is no wrong size for a deck that
 * does not exist.
 */
export class VirtualDeck implements PresenterPort {
  private size: { rows: number; cols: number };

  constructor(layout: { readonly rows: number; readonly cols: number }) {
    this.size = { rows: layout.rows, cols: layout.cols };
  }

  get layout(): { readonly rows: number; readonly cols: number } {
    return this.size;
  }

  /**
   * Adopts a profile's grid.
   *
   * Called before the profile is loaded, because the controller refuses a
   * profile authored for a different size — rightly, for a panel. A profile
   * built for a 4x8 tablet must still open here.
   */
  resize(layout: { readonly rows: number; readonly cols: number }): void {
    this.size = { rows: layout.rows, cols: layout.cols };
  }

  /**
   * Nothing ever reports a gesture, since there is nothing to press.
   *
   * The configurator's clicks do not arrive this way: they are simulated
   * presses, which the controller handles itself.
   */
  onGesture(): () => void {
    return () => undefined;
  }

  async present(_scene: Scene): Promise<void> {
    // Deliberately nothing. The repaint still happened, and the views still
    // reach the window through the controller's `painted` event.
  }
}

export interface VirtualDeckOptions {
  /** The profile it will run; its layout is the one the deck takes. */
  readonly profile: ProfileDefinition;
  readonly actions: ActionRegistry;
  /** Shared across every deck; see DeckRegistry. */
  readonly variables: VariableStore;
  /** Draws the pictures plugins own, so widgets preview here too. */
  readonly surfaces?: SurfaceProvider;
}

/** Builds the stand-in deck, ready for `DeckRegistry.add`. */
export function createVirtualDeck(options: VirtualDeckOptions): {
  readonly id: string;
  readonly name: string;
  readonly controller: DeckController;
  readonly presenter: VirtualDeck;
} {
  const presenter = new VirtualDeck(options.profile.layout);
  const controller = new DeckController(presenter, options.actions, {
    variables: options.variables,
    deckId: VIRTUAL_DECK_ID,
    ...(options.surfaces ? { surfaces: options.surfaces } : {}),
  });

  return { id: VIRTUAL_DECK_ID, name: VIRTUAL_DECK_NAME, controller, presenter };
}

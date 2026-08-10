import { EventEmitter } from 'node:events';

import type { PanelCompositor } from '@easydeck/compositor';
import type { Surface } from '@easydeck/device';
import { DeckController, VariableStore, variablesReadBy } from '@easydeck/engine';
import type { ActionRegistry, ProfileDefinition, VariableDeclaration } from '@easydeck/engine';

/**
 * Every deck that is running, and the one thing they all share.
 *
 * A deck is one working surface with its own state: a panel on the desk, a
 * second panel, a tablet across the network. Its profile, its page, its
 * history and its button states are private to it — which is what makes "the
 * same profile on two decks, showing different pages" work without any notion
 * of synchronisation.
 *
 * Variables are the exception, and deliberately so. There is one truth about
 * whether the mic is muted, so muting it on the tablet turns the button red on
 * the panel. Sharing one store is the whole of that feature.
 */

export interface DeckEntry {
  readonly id: string;
  /** What the user calls it. Defaults to the model name. */
  name: string;
  readonly controller: DeckController;
  /**
   * The panel model behind a physical deck.
   *
   * Absent for a deck that draws for itself — a tablet gets the scene and
   * renders it, so there is nothing here to compose or encode.
   */
  readonly compositor?: PanelCompositor;
  readonly surface?: Surface;
  /**
   * The presenter behind a deck that is not a panel.
   *
   * Kept so gestures arriving from a device can be handed to the deck they
   * belong to; a physical deck reports through its surface instead.
   */
  readonly presenter?: unknown;
  /** False once the hardware has gone; the entry stays so its state survives. */
  online: boolean;
}

export interface DeckRegistryEvents {
  /** A deck was added, lost, renamed or otherwise changed. */
  changed: [];
  /**
   * A deck joined, and whoever follows decks should start following this one.
   *
   * Separate from `changed` because it carries the deck itself: a listener
   * that has to subscribe to the new deck's own events needs the object, not
   * just the news that the list is different.
   */
  added: [deck: DeckEntry];
  error: [error: Error];
}

export class DeckRegistry extends EventEmitter<DeckRegistryEvents> {
  /** One store for every deck; see the note on this class. */
  readonly variables = new VariableStore();

  private readonly decks = new Map<string, DeckEntry>();

  constructor(private readonly actions: ActionRegistry) {
    super();
  }

  get size(): number {
    return this.decks.size;
  }

  list(): DeckEntry[] {
    return [...this.decks.values()];
  }

  get(id: string): DeckEntry | undefined {
    return this.decks.get(id);
  }

  /** The deck a request with no deck named should act on. */
  get first(): DeckEntry | undefined {
    return this.decks.values().next().value;
  }

  /**
   * Every variable any deck knows about, plus every plugin's.
   *
   * Collected across decks because a configurator offers one list while the
   * profiles behind it may differ: a variable declared only in the tablet's
   * profile is still a variable of this machine.
   */
  /**
   * Every variable any running deck reads, across all their profiles.
   *
   * Collected here because this is the one place that knows what is loaded:
   * two decks may run different profiles, and a plugin should watch what
   * either of them reads.
   */
  variablesRead(): string[] {
    const names = new Set<string>();

    for (const deck of this.decks.values()) {
      const profile = deck.controller.loadedProfile;
      if (!profile) continue;
      for (const name of variablesReadBy(profile)) names.add(name);
    }

    return [...names];
  }

  declarations(): VariableDeclaration[] {
    const merged = new Map<string, VariableDeclaration>();

    for (const declaration of this.actions.variables()) merged.set(declaration.name, declaration);
    for (const deck of this.decks.values()) {
      for (const declaration of deck.controller.variableDeclarations) {
        // A plugin owns its name: a profile may restate it to give a starting
        // value, but not to change what it is.
        const owner = merged.get(declaration.name);
        merged.set(
          declaration.name,
          owner?.pluginId ? { ...declaration, type: owner.type, pluginId: owner.pluginId } : declaration,
        );
      }
    }

    return [...merged.values()];
  }

  /**
   * Adds a deck and runs a profile on it.
   *
   * The controller is built here rather than handed in, because the one thing
   * a deck must not choose for itself is where its variables live.
   */
  async add(
    entry: Omit<DeckEntry, 'controller' | 'online'> & { controller: DeckController },
    profile: ProfileDefinition,
  ): Promise<DeckEntry> {
    const deck: DeckEntry = { ...entry, online: true };
    this.decks.set(deck.id, deck);

    deck.controller.on('error', (error) => this.emit('error', error));
    deck.compositor?.on('error', (error) => this.emit('error', error));
    deck.surface?.on('disconnected', () => {
      deck.online = false;
      this.emit('changed');
    });

    deck.controller.load(profile);
    await deck.controller.start();

    // Announced before 'changed', so anything that follows a deck is already
    // listening by the time the outside world hears the list has grown.
    this.emit('added', deck);
    this.emit('changed');
    return deck;
  }

  rename(id: string, name: string): void {
    const deck = this.decks.get(id);
    if (!deck) return;

    deck.name = name;
    this.emit('changed');
  }

  /** Puts a different profile on one deck, leaving every other deck alone. */
  async setProfile(id: string, profile: ProfileDefinition): Promise<void> {
    const deck = this.decks.get(id);
    if (!deck) return;

    deck.controller.load(profile);
    deck.controller.invalidate();
    this.emit('changed');
  }

  async removeDeck(id: string): Promise<void> {
    const deck = this.decks.get(id);
    if (!deck) return;

    this.decks.delete(id);
    await this.shutDown(deck);
    this.emit('changed');
  }

  async stop(): Promise<void> {
    const decks = [...this.decks.values()];
    this.decks.clear();

    for (const deck of decks) await this.shutDown(deck);
  }

  private async shutDown(deck: DeckEntry): Promise<void> {
    await deck.controller.stop().catch(() => undefined);
    // Before the surface closes: the compositor owns animation timers and open
    // decoders, and one still writing frames would find the handle gone.
    await deck.compositor?.stop().catch(() => undefined);
    await deck.surface?.clearAllKeys().catch(() => undefined);
    await deck.surface?.close().catch(() => undefined);
  }
}

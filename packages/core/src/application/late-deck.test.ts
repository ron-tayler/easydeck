import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ActionRegistry,
  DeckController,
  PROFILE_FORMAT_VERSION,
  registerBuiltinActions,
} from '@easydeck/engine';
import type { ButtonEvent, PresenterPort, ProfileDefinition, Scene } from '@easydeck/engine';

import { DEFAULT_SETTINGS } from '../domain/settings.js';
import { DeckRegistry } from './deck-registry.js';
import { DeckService } from './deck-service.js';
import type { ProfileRepository, SettingsRepository } from './ports/repositories.js';

/**
 * Decks that join after the daemon started.
 *
 * A panel is plugged in before anything runs; a tablet attaches when its page
 * connects, which is always later. The configurator follows a deck by its
 * events, so a deck nobody subscribed to is one the window cannot see move —
 * exactly what watching a tablet used to look like: a page frozen wherever it
 * happened to be when the window opened.
 */

const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

class SilentDeck implements PresenterPort {
  readonly layout = { rows: 1, cols: 2 };
  onGesture(_listener: (key: number, gesture: ButtonEvent) => void): () => void {
    return () => undefined;
  }
  async present(_scene: Scene): Promise<void> {}
}

const PROFILE: ProfileDefinition = {
  formatVersion: PROFILE_FORMAT_VERSION,
  id: 'p',
  name: 'P',
  layout: { rows: 1, cols: 2 },
  root: {
    id: 'root',
    name: 'Root',
    pages: [
      {
        id: 'main',
        buttons: [
          {
            id: 'go',
            key: 0,
            states: [
              {
                id: 'default',
                visual: { label: { text: 'go' } },
                actions: { press: [{ type: 'easydeck.go-to-page', params: { pageId: 'other' } }] },
              },
            ],
          },
        ],
      },
      { id: 'other', buttons: [] },
    ],
  },
};

async function build() {
  const profiles: ProfileRepository = {
    list: async () => [{ id: PROFILE.id, name: PROFILE.name }],
    has: async (id) => id === PROFILE.id,
    load: async () => PROFILE,
    save: async () => PROFILE.id,
    remove: async () => undefined,
  };
  const settings: SettingsRepository = {
    load: async () => DEFAULT_SETTINGS,
    save: async () => undefined,
  };

  const actions = registerBuiltinActions(new ActionRegistry());
  const decks = new DeckRegistry(actions);

  // The panel: present before the service is built, as a plugged-in one is.
  const panel = new DeckController(new SilentDeck(), actions, { deckId: 'panel' });
  await decks.add({ id: 'panel', name: 'Panel', controller: panel }, PROFILE);

  const service = new DeckService({
    decks,
    actions,
    profiles,
    settings,
    settingsValue: DEFAULT_SETTINGS,
  });

  return { service, decks, actions };
}

describe('a deck that joins later', () => {
  it('is followed, so the window sees it move', async () => {
    const { service, decks, actions } = await build();

    const moved: string[] = [];
    const painted: string[] = [];
    service.onDeckEvent('locationChanged', (payload) => moved.push(payload.deckId));
    service.onDeckEvent('viewChanged', (payload) => painted.push(payload.deckId));

    // The tablet attaches now, long after the service was built.
    const tablet = new DeckController(new SilentDeck(), actions, { deckId: 'net-1' });
    await decks.add({ id: 'net-1', name: 'Tablet', controller: tablet }, PROFILE);

    tablet.simulatePress(0);
    await settle();
    await settle();

    assert.ok(moved.includes('net-1'), 'a page change on the tablet never reached the window');
    assert.ok(painted.includes('net-1'), 'a repaint on the tablet never reached the window');
  });

  it('still names which deck each event came from', async () => {
    // Two decks on one profile: the window repaints only for the one it shows,
    // so an event without the right name would repaint the wrong page.
    const { service, decks, actions } = await build();

    const seen: string[] = [];
    service.onDeckEvent('locationChanged', (payload) => seen.push(payload.deckId));

    const tablet = new DeckController(new SilentDeck(), actions, { deckId: 'net-1' });
    await decks.add({ id: 'net-1', name: 'Tablet', controller: tablet }, PROFILE);

    decks.get('panel')!.controller.simulatePress(0);
    await settle();
    tablet.simulatePress(0);
    await settle();

    assert.deepEqual(seen, ['panel', 'net-1']);
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ActionRegistry, PROFILE_FORMAT_VERSION, registerBuiltinActions } from '@easydeck/engine';
import type { ProfileDefinition } from '@easydeck/engine';

import { DEFAULT_SETTINGS } from '../domain/settings.js';
import { VIRTUAL_DECK_ID } from '../infrastructure/virtual-deck.js';
import { DeckRegistry } from './deck-registry.js';
import { DeckService } from './deck-service.js';
import type { ProfileRepository, SettingsRepository } from './ports/repositories.js';

/**
 * A tablet whose connection comes and goes.
 *
 * Which is what a tablet's connection does: a screen locks, a tab goes to the
 * background, a phone walks out of range and back. Every one of those closed
 * the socket, and a closed socket used to mean the deck was torn down and
 * rebuilt — so the page somebody was on became the home page, over and over,
 * with a controller, a profile load and a repaint paid each time.
 */

const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

const profile: ProfileDefinition = {
  formatVersion: PROFILE_FORMAT_VERSION,
  id: 'p',
  name: 'P',
  layout: { rows: 1, cols: 2 },
  root: {
    id: 'root',
    name: 'Root',
    pages: [
      { id: 'main', buttons: [] },
      { id: 'second', buttons: [] },
    ],
    folders: [
      {
        id: 'tools',
        name: 'Tools',
        pages: [{ id: 'tools-main', buttons: [] }],
      },
    ],
  },
};

function build() {
  const profiles: ProfileRepository = {
    list: async () => [{ id: profile.id, name: profile.name }],
    has: async (id) => id === profile.id,
    load: async () => profile,
    save: async () => profile.id,
    remove: async () => undefined,
  };
  const settings: SettingsRepository = {
    load: async () => DEFAULT_SETTINGS,
    save: async () => undefined,
  };

  const actions = registerBuiltinActions(new ActionRegistry());
  const decks = new DeckRegistry(actions);
  const service = new DeckService({ decks, actions, profiles, settings, settingsValue: DEFAULT_SETTINGS });

  const scenes: unknown[][] = [];
  const attach = (rows = 1, cols = 2) =>
    service.attachNetworkDeck({
      deviceId: 'tablet',
      name: 'Tablet',
      rows,
      cols,
      send: (scene) => scenes.push([scene]),
    });

  return { service, decks, attach, scenes };
}

describe('a tablet that drops its connection', () => {
  it('comes back to the page it was on', async () => {
    const { service, decks, attach } = build();
    const { deckId } = await attach();

    service.openFolder('tools', deckId);
    const controller = decks.get(deckId)!.controller;
    assert.equal(controller.currentLocation?.folderId, 'tools');

    await service.suspendDeck(deckId);
    await attach();

    assert.equal(
      decks.get(deckId)!.controller.currentLocation?.folderId,
      'tools',
      'the reconnecting tablet was sent back to its home page',
    );
    // The same deck, not a replacement wearing its name.
    assert.equal(decks.get(deckId)!.controller, controller);
  });

  it('is shown as offline while it is away, and is still there', async () => {
    const { service, attach } = build();
    const { deckId } = await attach();

    await service.suspendDeck(deckId);

    const state = await service.state();
    assert.deepEqual(
      state.decks.map((deck) => [deck.id, deck.online]),
      [[deckId, false]],
    );
  });

  it('does not let the stand-in deck flicker in behind it', async () => {
    const { service, attach } = build();
    const { deckId } = await attach();

    await service.suspendDeck(deckId);
    await service.decksChanged();

    const ids = (await service.state()).decks.map((deck) => deck.id);
    assert.deepEqual(ids, [deckId], 'a deck that is merely quiet is still a deck');
  });

  it('gives the deck up once it is detached for good', async () => {
    const { service, attach } = build();
    const { deckId } = await attach();

    await service.suspendDeck(deckId);
    await service.detachDeck(deckId);

    const ids = (await service.state()).decks.map((deck) => deck.id);
    assert.deepEqual(ids, [VIRTUAL_DECK_ID]);
  });

  it('sends the scene again, so a screen that just came back is not blank', async () => {
    const { service, attach, scenes } = build();
    const { deckId } = await attach();
    await settle();

    const before = scenes.length;
    await service.suspendDeck(deckId);
    await attach();

    assert.ok(scenes.length > before, 'the reconnected screen was told nothing');
  });

  it('builds a new deck when the grid itself changed', async () => {
    const { service, decks, attach } = build();
    const { deckId } = await attach(1, 2);
    const controller = decks.get(deckId)!.controller;

    // A different device behind the same name — a phone rotated into another
    // shape — is not the deck that was there.
    await attach(2, 4).catch(() => undefined);

    assert.notEqual(decks.get(deckId)?.controller, controller);
  });
});

describe('decks changing at once', () => {
  it('leaves exactly one stand-in, however the calls interleave', async () => {
    const { service } = build();

    await Promise.all([service.decksChanged(), service.decksChanged(), service.decksChanged()]);

    const ids = (await service.state()).decks.map((deck) => deck.id);
    assert.deepEqual(ids, [VIRTUAL_DECK_ID]);
  });
});

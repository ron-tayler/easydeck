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
import { VIRTUAL_DECK_ID } from '../infrastructure/virtual-deck.js';
import { DeckRegistry } from './deck-registry.js';
import { DeckService } from './deck-service.js';
import type { DaemonSettings } from '../domain/settings.js';
import type { ProfileRepository, SettingsRepository } from './ports/repositories.js';

/**
 * A machine with nothing plugged in.
 *
 * Which used to mean a program that could not be used at all: every window in
 * the configurator hangs off a deck, so no deck meant no profile to edit, no
 * page to look at, and — worst of it — no way into the network settings, the
 * one place somebody would go to let a tablet in. That is exactly the state a
 * person is in when they sit down to set the thing up before the panel arrives.
 */

const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

class SilentPanel implements PresenterPort {
  readonly layout = { rows: 1, cols: 2 };
  onGesture(_listener: (key: number, gesture: ButtonEvent) => void): () => void {
    return () => undefined;
  }
  async present(_scene: Scene): Promise<void> {}
}

const small: ProfileDefinition = {
  formatVersion: PROFILE_FORMAT_VERSION,
  id: 'small',
  name: 'Small',
  layout: { rows: 1, cols: 2 },
  root: {
    id: 'root',
    name: 'Root',
    pages: [
      {
        id: 'main',
        buttons: [
          { id: 'one', key: 0, states: [{ id: 'default', visual: { label: { text: 'one' } } }] },
        ],
      },
    ],
  },
};

/** Another shape entirely, for the deck that has no shape of its own. */
const wide: ProfileDefinition = {
  ...small,
  id: 'wide',
  name: 'Wide',
  layout: { rows: 2, cols: 4 },
};

function build() {
  const stored: DaemonSettings = { ...DEFAULT_SETTINGS };
  const profiles: ProfileRepository = {
    list: async () => [
      { id: small.id, name: small.name },
      { id: wide.id, name: wide.name },
    ],
    has: async (id) => id === small.id || id === wide.id,
    load: async (id) => (id === wide.id ? wide : small),
    save: async () => small.id,
    remove: async () => undefined,
  };
  const settings: SettingsRepository = {
    load: async () => stored,
    save: async () => undefined,
  };

  const actions = registerBuiltinActions(new ActionRegistry());
  const decks = new DeckRegistry(actions);
  const service = new DeckService({
    decks,
    actions,
    profiles,
    settings,
    settingsValue: DEFAULT_SETTINGS,
  });

  return { service, decks, actions };
}

describe('a daemon with no deck at all', () => {
  it('still answers with a state, which is what the window is built on', async () => {
    const { service } = build();

    const state = await service.state();
    assert.deepEqual(state.decks, []);
    assert.equal(state.activeDeckId, undefined);
    // The one thing somebody with no panel came here for.
    assert.equal(state.network.networkAccess, false);
  });

  it('shows an empty page rather than refusing to say', async () => {
    const { service } = build();
    assert.deepEqual(await service.pageView(), []);
  });
});

describe('the stand-in deck', () => {
  it('appears when there is nothing else, in the profile’s own shape', async () => {
    const { service, decks } = build();

    await service.decksChanged();

    const [deck, ...rest] = (await service.state()).decks;
    assert.equal(rest.length, 0);
    assert.equal(deck?.id, VIRTUAL_DECK_ID);
    assert.equal(deck?.virtual, true);
    assert.deepEqual([deck?.rows, deck?.cols], [1, 2]);

    // And it is a working deck: the editor draws what this answers.
    const view = await service.pageView();
    assert.equal(view.length, 1);
    assert.equal(decks.get(VIRTUAL_DECK_ID)?.controller.profileId, small.id);
  });

  it('takes the shape of whatever profile is put on it', async () => {
    const { service } = build();
    await service.decksChanged();

    // A panel would rightly refuse this — its grid is a fact about hardware.
    await service.activateProfile(wide.id);

    const [deck] = (await service.state()).decks;
    assert.deepEqual([deck?.rows, deck?.cols], [2, 4]);
  });

  it('gets out of the way the moment a real deck joins', async () => {
    const { service, decks, actions } = build();
    await service.decksChanged();

    const panel = new DeckController(new SilentPanel(), actions, { deckId: 'panel' });
    await decks.add({ id: 'panel', name: 'Panel', controller: panel }, small);
    await service.decksChanged();

    const state = await service.state();
    assert.deepEqual(
      state.decks.map((deck) => deck.id),
      ['panel'],
    );
  });

  it('comes back when the last real deck goes away', async () => {
    const { service, decks, actions } = build();

    const panel = new DeckController(new SilentPanel(), actions, { deckId: 'panel' });
    await decks.add({ id: 'panel', name: 'Panel', controller: panel }, small);
    await service.decksChanged();
    assert.equal(decks.get(VIRTUAL_DECK_ID), undefined);

    await decks.removeDeck('panel');
    await service.decksChanged();

    assert.ok(decks.get(VIRTUAL_DECK_ID), 'the window was left with no deck to show');
  });

  it('says so once, rather than announcing a change that did not happen twice', async () => {
    const { service } = build();

    const announced: number[] = [];
    service.onDeckEvent('state', (state) => announced.push(state.decks.length));

    await service.decksChanged();
    await service.decksChanged();
    await settle();

    assert.deepEqual(announced, [1, 1]);
  });
});

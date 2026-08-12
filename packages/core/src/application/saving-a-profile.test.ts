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
 * What editing one key does to the rest of the page.
 *
 * Saving from the configurator reloads the whole profile onto the deck, and a
 * reload starts from the document. Anything the deck was holding in memory —
 * where it is, which state a key was put into — is lost unless it is carried
 * across on purpose, and the loss only shows up on the *other* keys, which is
 * what made this hard to see.
 */

class SilentDeck implements PresenterPort {
  readonly layout = { rows: 1, cols: 3 };
  onGesture(_listener: (key: number, gesture: ButtonEvent) => void): () => void {
    return () => undefined;
  }
  async present(_scene: Scene): Promise<void> {}
}

function profile(label = 'first'): ProfileDefinition {
  return {
    formatVersion: PROFILE_FORMAT_VERSION,
    id: 'p',
    name: 'P',
    layout: { rows: 1, cols: 3 },
    root: {
      id: 'root',
      name: 'Root',
      pages: [
        {
          id: 'main',
          buttons: [
            {
              // The one being edited: its label is what changes.
              id: 'edited',
              key: 0,
              states: [{ id: 'default', visual: { label: { text: label } } }],
            },
            {
              // The one that must be left alone. Two states, no binding, so
              // the only thing that can select one is an action.
              id: 'lamp',
              key: 1,
              states: [
                { id: 'off', visual: { label: { text: 'off' } } },
                { id: 'on', visual: { label: { text: 'on' } } },
              ],
            },
          ],
        },
        { id: 'other', buttons: [] },
      ],
    },
  };
}

async function build() {
  let stored = profile();

  const profiles: ProfileRepository = {
    list: async () => [{ id: 'p', name: 'P' }],
    has: async (id) => id === 'p',
    load: async () => stored,
    save: async (next) => {
      stored = next;
      return 'p';
    },
    remove: async () => undefined,
  };
  const settings: SettingsRepository = {
    load: async () => DEFAULT_SETTINGS,
    save: async () => undefined,
  };

  const actions = registerBuiltinActions(new ActionRegistry());
  const decks = new DeckRegistry(actions);
  const panel = new DeckController(new SilentDeck(), actions, { deckId: 'panel' });
  await decks.add({ id: 'panel', name: 'Panel', controller: panel }, profile());

  const service = new DeckService({
    decks,
    actions,
    profiles,
    settings,
    settingsValue: { ...DEFAULT_SETTINGS, activeProfileId: 'p' },
  });

  const showing = (id: string): string | undefined =>
    panel.view().find((view) => view.buttonId === id)?.stateId;

  return { service, panel, showing };
}

describe('saving a profile from the configurator', () => {
  it('leaves a key in the state an action put it in', async () => {
    const { service, panel, showing } = await build();

    panel.setButtonState('lamp', 'on');
    assert.equal(showing('lamp'), 'on');

    // Editing a different key, which is what the configurator sends.
    await service.saveProfile(profile('second'));

    assert.equal(showing('lamp'), 'on', 'the untouched key was reset by an edit elsewhere');
  });

  it('still leaves the deck where it was standing', async () => {
    // The behaviour the forced states were modelled on; kept honest here so
    // the two cannot drift apart.
    const { service, panel } = await build();

    panel.goToPage('other');
    await service.saveProfile(profile('second'));

    assert.equal(panel.currentLocation?.pageId, 'other');
  });

  it('starts clean when a different profile is loaded', async () => {
    /*
     * The other half of the rule. Button ids are handed out per profile, so
     * `lamp` may well exist in the next one too — carrying a state across a
     * genuine switch would put a key into a state that belongs to somebody
     * else's profile.
     */
    const { panel, showing } = await build();

    panel.setButtonState('lamp', 'on');
    panel.load({ ...profile(), id: 'other-profile', name: 'Other' });

    assert.equal(showing('lamp'), 'off');
  });
});

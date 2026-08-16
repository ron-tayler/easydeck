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
import { AssetStore } from '../infrastructure/api/asset-store.js';
import { ApiHandler } from './api-handler.js';
import { DeckRegistry } from './deck-registry.js';
import { DeckService } from './deck-service.js';
import { linkViews } from './link-views.js';
import type { ProfileRepository, SettingsRepository } from './ports/repositories.js';

/**
 * What a window is told, and how often.
 *
 * The daemon and the window are one machine talking to itself over a socket,
 * and everything here is about that conversation staying short: one
 * announcement per turn rather than per variable, the keys carried rather than
 * asked for, and every picture at the address it already had.
 */

const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

class SilentDeck implements PresenterPort {
  readonly layout = { rows: 1, cols: 2 };
  onGesture(_listener: (key: number, gesture: ButtonEvent) => void): () => void {
    return () => undefined;
  }
  async present(_scene: Scene): Promise<void> {}
}

/** A key with a picture on it, so there is something to make a link out of. */
const PICTURE = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=';

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
            id: 'shown',
            key: 0,
            states: [
              {
                id: 'default',
                visual: { icon: { source: PICTURE }, label: { text: 'зрителей {{viewers}}' } },
              },
            ],
          },
        ],
      },
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

  // The registry's own store, as `start-deck` wires it: one machine's
  // variables, shared by every deck on it.
  const panel = new DeckController(new SilentDeck(), actions, {
    deckId: 'panel',
    variables: decks.variables,
  });
  await decks.add({ id: 'panel', name: 'Panel', controller: panel }, PROFILE);

  const service = new DeckService({
    decks,
    actions,
    profiles,
    settings,
    settingsValue: DEFAULT_SETTINGS,
  });

  return { service, decks, actions, variables: decks.variables };
}

describe('saying that the variables changed', () => {
  it('says it once for however many changed in one turn', async () => {
    /*
     * A macro that sets three variables, or a plugin publishing a track's
     * title, artist and position together, used to send three announcements —
     * and every listener answered each one in full. The panel has always
     * folded a burst into one pass; this is the same bargain for whoever is
     * listening over a socket.
     */
    const { service, variables } = await build();

    let told = 0;
    service.onDeckEvent('variablesChanged', () => (told += 1));

    variables.set('title', 'Песня');
    variables.set('artist', 'Кто-то');
    variables.set('position', 12);
    await settle();

    assert.equal(told, 1);
  });

  it('carries what the variables came to, not how they got there', async () => {
    const { service, variables } = await build();

    const seen: Record<string, unknown>[] = [];
    service.onDeckEvent('variablesChanged', (variablesNow) => seen.push({ ...variablesNow }));

    variables.set('position', 1);
    variables.set('position', 2);
    variables.set('position', 3);
    await settle();

    // A snapshot taken when it is sent: the truth at that moment rather than a
    // replay, which is all anybody has ever used this for.
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.['position'], 3);
  });

  it('says it again on the next turn', async () => {
    // Folded, not swallowed: the guard has to let go once it has spoken.
    const { service, variables } = await build();

    let told = 0;
    service.onDeckEvent('variablesChanged', () => (told += 1));

    variables.set('a', 1);
    await settle();
    variables.set('b', 2);
    await settle();

    assert.equal(told, 2);
  });
});

describe('saying that a deck repainted', () => {
  it('carries the keys, so nobody has to ask', async () => {
    const { service, variables } = await build();

    const seen: { deckId: string; views: readonly { key: number }[] }[] = [];
    service.onDeckEvent('viewChanged', (event) => seen.push(event));

    variables.set('viewers', 9);
    await settle();
    await settle();

    const last = seen.at(-1);
    assert.ok(last, 'a repaint was never reported');
    assert.equal(
      (last.views[0] as { visual?: { label?: { text?: string } } })?.visual?.label?.text,
      'зрителей 9',
    );
  });
});

describe('the address a picture is handed out at', () => {
  it('is the same whether it was asked for or announced', async () => {
    /*
     * The one thing that must not drift. A window applies the repaint event on
     * top of the answer it got from `getPageView`; if the two made links
     * differently, the browser would refetch a picture it already had on every
     * repaint of a key that never changed.
     */
    const { service, variables } = await build();
    const assets = new AssetStore();
    const handler = new ApiHandler(service, { assets });

    const answered = (await handler.handle({
      type: 'request',
      id: '1',
      method: 'getPageView',
      params: {},
    })) as { ok: boolean; result?: { keys: { visual: { icon?: { source: string } } }[] } };

    const announced: string[] = [];
    service.onDeckEvent('viewChanged', (event) => {
      for (const view of linkViews(event.views, assets)) {
        if (view.visual.icon) announced.push(view.visual.icon.source);
      }
    });

    variables.set('viewers', 3);
    await settle();
    await settle();

    const fromAnswer = answered.result?.keys[0]?.visual.icon?.source;
    assert.match(String(fromAnswer), /^\/asset\//, 'the answer did not hand out a link');
    assert.equal(announced.at(-1), fromAnswer);
  });
});

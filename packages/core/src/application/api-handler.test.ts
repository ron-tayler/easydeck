import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PLUGIN_API_VERSION, PROFILE_FORMAT_VERSION } from '@easydeck/engine';
import type { KeyView, PluginManifest, ProfileDefinition, VariableValue } from '@easydeck/engine';

import type { DeckState } from '../domain/api-messages.js';
import type { Library, LibraryImage } from '../infrastructure/icon-library.js';
import { ApiHandler } from './api-handler.js';
import type { DeckFacade } from './ports/deck-facade.js';
import type { ProfileSummary } from './ports/repositories.js';

function validProfile(id = 'p'): ProfileDefinition {
  return {
    formatVersion: PROFILE_FORMAT_VERSION,
    id,
    name: 'Profile',
    layout: { rows: 1, cols: 2 },
    root: {
      id: 'root',
      name: 'Root',
      pages: [
        { id: 'main', buttons: [{ id: 'b', key: 0, states: [{ id: 'default', visual: {} }] }] },
      ],
    },
  };
}

/** Records what the handler asked the deck to do. */
class FakeDeck implements DeckFacade {
  calls: string[] = [];
  saved?: ProfileDefinition;
  failWith?: Error;

  async state(): Promise<DeckState> {
    this.calls.push('state');
    return {
      protocolVersion: 1,
    decks: [
      {
        id: 'panel',
        name: 'Panel',
        online: true,
        rows: 3,
        cols: 5,
        keyWidth: 112,
        keyHeight: 112,
        folderPath: [],
        pages: [],
      },
    ],
    activeDeckId: 'panel',
      brightness: 60,
    network: {
      port: 8317,
      running: false,
      networkAccess: false,
      networkDecks: false,
      extensionsApi: false,
      addresses: [],
    },
      variables: { a: 1 },
      variableDeclarations: [{ name: 'a', type: 'number' as const }],
      actionTypes: ['set-variable'],
      warnings: [],
    };
  }

  /** Set to give the page a picture, as a profile with an icon would. */
  picture?: string;

  async pageView(): Promise<readonly KeyView[]> {
    this.calls.push('pageView');
    const visual = this.picture
      ? {
          label: { text: 'Hi' },
          backdrop: { source: this.picture, col: 0, row: 0, cols: 3, rows: 2 },
          icon: { source: this.picture },
        }
      : { label: { text: 'Hi' } };

    return [{ key: 0, buttonId: 'b', stateId: 'default', visual }];
  }

  async plugins(): Promise<readonly PluginManifest[]> {
    this.calls.push('plugins');
    return [
      {
        id: 'demo',
        name: { en: 'Demo' },
        version: '1.0.0',
        apiVersion: PLUGIN_API_VERSION,
        actions: [{ type: 'demo.do', label: { en: 'Do it' } }],
      },
    ];
  }

  async listProfiles(): Promise<ProfileSummary[]> {
    this.calls.push('listProfiles');
    return [{ id: 'p', name: 'Profile' }];
  }

  async listIcons(): Promise<Library> {
    this.calls.push('listIcons');
    return {
      images: [{ name: 'mic', source: 'data:image/png;base64,AA==', bytes: 1, group: '' }],
      omitted: 2,
    };
  }

  async getProfile(id: string): Promise<ProfileDefinition> {
    this.calls.push(`getProfile:${id}`);
    if (this.failWith) throw this.failWith;
    return validProfile(id);
  }

  async saveProfile(profile: ProfileDefinition): Promise<void> {
    this.calls.push(`saveProfile:${profile.id}`);
    this.saved = profile;
  }

  async deleteProfile(id: string): Promise<void> {
    this.calls.push(`deleteProfile:${id}`);
  }

  async activateProfile(id: string): Promise<void> {
    this.calls.push(`activateProfile:${id}`);
  }

  setVariable(name: string, value: VariableValue): void {
    this.calls.push(`setVariable:${name}=${String(value)}`);
  }

  deleteVariable(name: string): void {
    this.calls.push(`deleteVariable:${name}`);
  }

  openFolder(folderId: string): void {
    this.calls.push(`openFolder:${folderId}`);
  }

  goToPage(pageId: string, deckId?: string): void {
    this.calls.push(`goToPage:${pageId}:${deckId}`);
  }

  goUp(): void {
    this.calls.push('goUp');
  }

  goHome(deckId?: string): void {
    this.calls.push(`goHome:${deckId}`);
  }

  goBack(): void {
    this.calls.push('goBack');
  }

  /** Records which folder the window asked to see. */
  opened?: string;

  async openAppFolder(folder: string): Promise<void> {
    this.calls.push(`openAppFolder:${folder}`);
    this.opened = folder;
  }

  async setBrightness(percent: number): Promise<void> {
    this.calls.push(`setBrightness:${percent}`);
  }

  simulateKey(key: number, deckId?: string): void {
    this.calls.push(`simulateKey:${key}:${deckId}`);
  }

  simulateLongPress(key: number): void {
    this.calls.push(`simulateLongPress:${key}`);
  }

  simulateDoublePress(key: number): void {
    this.calls.push(`simulateDoublePress:${key}`);
  }

  async listDevices(): Promise<{ devices: never[]; pending: never[] }> {
    this.calls.push('listDevices');
    return { devices: [], pending: [] };
  }

  async approveDevice(deviceId: string): Promise<void> {
    this.calls.push(`approveDevice:${deviceId}`);
  }

  async revokeDevice(deviceId: string): Promise<void> {
    this.calls.push(`revokeDevice:${deviceId}`);
  }

  async setNetworkSettings(patch: Record<string, unknown>): Promise<void> {
    this.calls.push(`setNetworkSettings:${JSON.stringify(patch)}`);
  }

  async renameDeck(deckId: string, name: string): Promise<void> {
    this.calls.push(`renameDeck:${deckId}:${name}`);
  }

  async attachNetworkDeck(): Promise<{ deckId: string }> {
    this.calls.push('attachNetworkDeck');
    return { deckId: 'net-1' };
  }

  async detachDeck(deckId: string): Promise<void> {
    this.calls.push(`detachDeck:${deckId}`);
  }

  reportGesture(deckId: string, key: number, gesture: string): void {
    this.calls.push(`reportGesture:${deckId}:${key}:${gesture}`);
  }

  reportPressed(deckId: string, key: number, pressed: boolean): void {
    this.calls.push(`reportPressed:${deckId}:${key}:${pressed}`);
  }
}

const request = (method: string, params?: Record<string, unknown>) => ({
  type: 'request' as const,
  id: 'r1',
  method,
  params,
});

describe('naming a deck in a request', () => {
  it('passes the deck through to the facade', async () => {
    const deck = new FakeDeck();
    const handler = new ApiHandler(deck);

    await handler.handle({ type: 'request', id: '1', method: 'goToPage', params: { pageId: 'p', deckId: 'tablet' } });
    await handler.handle({ type: 'request', id: '2', method: 'simulateKey', params: { key: 3, deckId: 'tablet' } });

    assert.deepEqual(deck.calls, ['goToPage:p:tablet', 'simulateKey:3:tablet']);
  });

  it('acts on the active deck when none is named', async () => {
    // A client that knows about one deck keeps working unchanged.
    const deck = new FakeDeck();
    const handler = new ApiHandler(deck);

    await handler.handle({ type: 'request', id: '1', method: 'goHome' });

    assert.deepEqual(deck.calls, ['goHome:undefined']);
  });
});

describe('ApiHandler', () => {
  it('answers getState with a snapshot a UI can render from', async () => {
    const deck = new FakeDeck();
    const response = await new ApiHandler(deck).handle(request('getState'));

    assert.equal(response.ok, true);
    const state = response.result as DeckState;
    assert.equal(state.decks[0]?.name, 'Panel');
    assert.equal(state.activeDeckId, 'panel');
    assert.equal(state.brightness, 60);
  });

  // The UI renders the panel from this, rather than resolving button states
  // and templates a second time and drifting from the engine.
  it('answers getPageView with fully resolved keys', async () => {
    const response = await new ApiHandler(new FakeDeck()).handle(request('getPageView'));

    assert.equal(response.ok, true);
    const { keys } = response.result as { keys: KeyView[] };
    assert.deepEqual(keys[0], {
      key: 0,
      buttonId: 'b',
      stateId: 'default',
      visual: { label: { text: 'Hi' } },
    });
  });

  // A picture in every key's description is what made a network deck spend a
  // hundred megabytes on a page showing one animation.
  it('sends pictures as links when there is somewhere to leave them', async () => {
    const deck = new FakeDeck();
    deck.picture = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';

    const links: string[] = [];
    const handler = new ApiHandler(deck, {
      assets: {
        link: (source) => {
          links.push(source);
          return '/asset/abc';
        },
      },
    });

    const { keys } = (await handler.handle(request('getPageView'))).result as { keys: KeyView[] };

    assert.equal(keys[0]?.visual.backdrop?.source, '/asset/abc');
    assert.equal(keys[0]?.visual.icon?.source, '/asset/abc');
    assert.equal(links.length, 2, 'both the region picture and the icon are filed');
    // Everything else about the key survives the swap.
    assert.equal(keys[0]?.visual.backdrop?.cols, 3);
    assert.equal(keys[0]?.visual.label?.text, 'Hi');
  });

  it('leaves pictures where they are when nothing is offered', async () => {
    // The desktop window shares a machine with the daemon: a link would only
    // add a hop.
    const deck = new FakeDeck();
    deck.picture = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';

    const { keys } = (await new ApiHandler(deck).handle(request('getPageView'))).result as {
      keys: KeyView[];
    };

    assert.equal(keys[0]?.visual.backdrop?.source, deck.picture);
  });

  // The configurator builds its action picker and every parameter form from
  // these declarations, so they have to travel over the API intact.
  it('answers getPlugins with the installed manifests', async () => {
    const response = await new ApiHandler(new FakeDeck()).handle(request('getPlugins'));

    assert.equal(response.ok, true);
    const { plugins } = response.result as { plugins: PluginManifest[] };
    assert.equal(plugins[0]?.id, 'demo');
    assert.equal(plugins[0]?.actions[0]?.type, 'demo.do');
  });

  it('routes each method to the deck exactly once', async () => {
    const deck = new FakeDeck();
    const handler = new ApiHandler(deck);

    await handler.handle(request('listProfiles'));
    await handler.handle(request('getProfile', { id: 'p' }));
    await handler.handle(request('activateProfile', { id: 'p' }));
    await handler.handle(request('setVariable', { name: 'mic', value: 'on' }));
    await handler.handle(request('goToPage', { pageId: 'second' }));
    await handler.handle(request('openFolder', { folderId: 'tools' }));
    await handler.handle(request('goUp'));
    await handler.handle(request('goHome'));
    await handler.handle(request('goBack'));
    await handler.handle(request('setBrightness', { percent: 42 }));
    await handler.handle(request('simulateKey', { key: 3 }));

    assert.deepEqual(deck.calls, [
      'listProfiles',
      'getProfile:p',
      'activateProfile:p',
      'setVariable:mic=on',
      'goToPage:second:undefined',
      'openFolder:tools',
      'goUp',
      'goHome:undefined',
      'goBack',
      'setBrightness:42',
      'simulateKey:3:undefined',
    ]);
  });

  it('echoes the request id on every response', async () => {
    const response = await new ApiHandler(new FakeDeck()).handle({
      type: 'request',
      id: 'abc-123',
      method: 'listProfiles',
    });
    assert.equal(response.id, 'abc-123');
  });

  it('validates a profile before storing it, and says what is wrong', async () => {
    const deck = new FakeDeck();
    const broken = { ...validProfile(), root: { id: 'root', name: 'Root', pages: [] } };

    const response = await new ApiHandler(deck).handle(request('saveProfile', { profile: broken }));

    assert.equal(response.ok, false);
    assert.match(response.error!.message, /has no pages/);
    assert.equal(deck.saved, undefined, 'an invalid profile must not reach storage');
  });

  it('stores a valid profile', async () => {
    const deck = new FakeDeck();
    const response = await new ApiHandler(deck).handle(
      request('saveProfile', { profile: validProfile('mine') }),
    );

    assert.equal(response.ok, true);
    assert.equal(deck.saved?.id, 'mine');
  });

  it('reports missing or wrongly typed parameters instead of guessing', async () => {
    const handler = new ApiHandler(new FakeDeck());

    const noId = await handler.handle(request('getProfile', {}));
    assert.equal(noId.ok, false);
    assert.match(noId.error!.message, /'id' must be a non-empty string/);

    const badValue = await handler.handle(request('setVariable', { name: 'a', value: { x: 1 } }));
    assert.equal(badValue.ok, false);
    assert.match(badValue.error!.message, /'value' must be a string, number or boolean/);
  });

  it('rejects an unknown method and a malformed message', async () => {
    const handler = new ApiHandler(new FakeDeck());

    const unknown = await handler.handle(request('doTheThing'));
    assert.equal(unknown.ok, false);
    assert.match(unknown.error!.message, /Unknown method 'doTheThing'/);

    const malformed = await handler.handle({ hello: 'there' });
    assert.equal(malformed.ok, false);
    assert.match(malformed.error!.message, /Expected a request message/);
  });

  it('surfaces the cause chain of a failure, not just the outer message', async () => {
    const deck = new FakeDeck();
    deck.failWith = new Error('outer', { cause: new Error('the real reason') });

    const response = await new ApiHandler(deck).handle(request('getProfile', { id: 'p' }));

    assert.equal(response.ok, false);
    assert.match(response.error!.message, /outer <- the real reason/);
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PLUGIN_API_VERSION, PROFILE_FORMAT_VERSION } from '@easydeck/engine';
import type { KeyView, PluginManifest, ProfileDefinition, VariableValue } from '@easydeck/engine';

import type { DeckState } from '../domain/api-messages.js';
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
      device: { model: 'Fake', rows: 1, cols: 2, keyWidth: 112, keyHeight: 112 },
      activeProfileId: 'p',
      location: { folderId: 'root', pageId: 'main' },
      folderPath: [{ id: 'root', name: 'Root' }],
      pages: [{ id: 'main' }],
      brightness: 60,
      variables: { a: 1 },
      variableDeclarations: [{ name: 'a', type: 'number' as const }],
      actionTypes: ['set-variable'],
      warnings: [],
    };
  }

  async pageView(): Promise<readonly KeyView[]> {
    this.calls.push('pageView');
    return [{ key: 0, buttonId: 'b', stateId: 'default', visual: { label: { text: 'Hi' } } }];
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

  goToPage(pageId: string): void {
    this.calls.push(`goToPage:${pageId}`);
  }

  goUp(): void {
    this.calls.push('goUp');
  }

  goHome(): void {
    this.calls.push('goHome');
  }

  goBack(): void {
    this.calls.push('goBack');
  }

  async setBrightness(percent: number): Promise<void> {
    this.calls.push(`setBrightness:${percent}`);
  }

  simulateKey(key: number): void {
    this.calls.push(`simulateKey:${key}`);
  }

  simulateLongPress(key: number): void {
    this.calls.push(`simulateLongPress:${key}`);
  }
}

const request = (method: string, params?: Record<string, unknown>) => ({
  type: 'request' as const,
  id: 'r1',
  method,
  params,
});

describe('ApiHandler', () => {
  it('answers getState with a snapshot a UI can render from', async () => {
    const deck = new FakeDeck();
    const response = await new ApiHandler(deck).handle(request('getState'));

    assert.equal(response.ok, true);
    const state = response.result as DeckState;
    assert.equal(state.device.model, 'Fake');
    assert.equal(state.location?.pageId, 'main');
    assert.deepEqual(state.folderPath, [{ id: 'root', name: 'Root' }]);
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
      'goToPage:second',
      'openFolder:tools',
      'goUp',
      'goHome',
      'goBack',
      'setBrightness:42',
      'simulateKey:3',
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

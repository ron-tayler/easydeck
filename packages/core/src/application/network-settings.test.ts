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
import type { DaemonSettings } from '../domain/settings.js';
import { DeckRegistry } from './deck-registry.js';
import { DeckService } from './deck-service.js';
import type { ProfileRepository, SettingsRepository } from './ports/repositories.js';

/** A deck that accepts scenes and does nothing else. */
class SilentDeck implements PresenterPort {
  readonly layout = { rows: 1, cols: 1 };
  onGesture(_listener: (key: number, gesture: ButtonEvent) => void): () => void {
    return () => undefined;
  }
  async present(_scene: Scene): Promise<void> {}
}

const PROFILE: ProfileDefinition = {
  formatVersion: PROFILE_FORMAT_VERSION,
  id: 'p',
  name: 'P',
  layout: { rows: 1, cols: 1 },
  root: { id: 'root', name: 'Root', pages: [{ id: 'main', buttons: [] }] },
};

function repositories(initial: DaemonSettings) {
  let stored = initial;

  const profiles: ProfileRepository = {
    list: async () => [{ id: PROFILE.id, name: PROFILE.name }],
    has: async (id) => id === PROFILE.id,
    load: async () => PROFILE,
    save: async () => PROFILE.id,
    remove: async () => undefined,
  };

  const settings: SettingsRepository = {
    load: async () => stored,
    save: async (value) => {
      stored = value;
    },
  };

  return { profiles, settings, current: () => stored };
}

/**
 * A service with one deck and a network hook that records what it was asked
 * to do, standing in for the app or the daemon that owns the real socket.
 */
async function build(initial: DaemonSettings) {
  const { profiles, settings, current } = repositories(initial);
  const actions = registerBuiltinActions(new ActionRegistry());
  const decks = new DeckRegistry(actions);

  const controller = new DeckController(new SilentDeck(), actions, { deckId: 'panel' });
  await decks.add({ id: 'panel', name: 'panel', controller }, PROFILE);

  /** What the owner would do: run a server only while the setting says so. */
  const applied: (boolean | undefined)[] = [];
  const applyNetwork = async () => {
    const now = await settings.load();
    applied.push(now.networkAccess === true);
    return now.networkAccess === true ? { port: now.port ?? 8317, networkAccess: true } : undefined;
  };

  const service = new DeckService({
    decks,
    actions,
    profiles,
    settings,
    settingsValue: initial,
    applyNetwork,
  });

  service.setListening(await applyNetwork());
  return { service, applied, current };
}

describe('network settings', () => {
  it('reports a running server when access is on', async () => {
    const { service } = await build({ ...DEFAULT_SETTINGS, networkAccess: true, port: 8317 });
    const { network } = await service.state();

    assert.equal(network.running, true);
    assert.equal(network.networkAccess, true);
    assert.equal(network.port, 8317);
  });

  it('reports no server at all when access is off', async () => {
    // The checkbox has to describe reality: this program is not a network
    // program, and with the setting off there is no socket anywhere.
    const { service } = await build({ ...DEFAULT_SETTINGS });
    const { network } = await service.state();

    assert.equal(network.running, false);
    assert.equal(network.networkAccess, false);
    assert.deepEqual(network.addresses, []);
  });

  it('switching access off takes the server away', async () => {
    const { service, applied, current } = await build({
      ...DEFAULT_SETTINGS,
      networkAccess: true,
      port: 8317,
    });

    await service.setNetworkSettings({ networkAccess: false });
    const { network } = await service.state();

    assert.equal(current().networkAccess, false, 'the setting was not stored');
    assert.deepEqual(applied, [true, false], 'the owner was not asked to stop');
    assert.equal(network.running, false, 'still claims to be running');
    assert.equal(network.networkAccess, false, 'the switch still reads as on');
  });

  it('switching access on brings the server up', async () => {
    const { service, current } = await build({ ...DEFAULT_SETTINGS });

    await service.setNetworkSettings({ networkAccess: true, port: 8400 });
    const { network } = await service.state();

    assert.equal(current().networkAccess, true);
    assert.equal(network.running, true);
    assert.equal(network.port, 8400);
  });

  it('keeps the other switches when only one is changed', async () => {
    const { service, current } = await build({
      ...DEFAULT_SETTINGS,
      networkAccess: true,
      networkDecks: true,
    });

    await service.setNetworkSettings({ extensionsApi: true });

    assert.equal(current().networkAccess, true);
    assert.equal(current().networkDecks, true);
    assert.equal(current().extensionsApi, true);
  });

  it('a server nobody was told about still reads as off', async () => {
    // The failure the desktop app had: the owner started a server and kept the
    // news to itself, so the window showed a switch that was on next to a
    // server it believed was off.
    const { profiles, settings } = repositories({ ...DEFAULT_SETTINGS, networkAccess: true });
    const actions = registerBuiltinActions(new ActionRegistry());
    const decks = new DeckRegistry(actions);
    const controller = new DeckController(new SilentDeck(), actions, { deckId: 'panel' });
    await decks.add({ id: 'panel', name: 'panel', controller }, PROFILE);

    const service = new DeckService({
      decks,
      actions,
      profiles,
      settings,
      settingsValue: { ...DEFAULT_SETTINGS },
      applyNetwork: async () => ({ port: 8317, networkAccess: true }),
    });

    const { network } = await service.state();
    assert.equal(network.running, false);
    assert.equal(network.networkAccess, false, 'the switch claimed a server it was never told about');
  });

  it('a server that refused to start leaves the switch off', async () => {
    const { profiles, settings } = repositories({ ...DEFAULT_SETTINGS });
    const actions = registerBuiltinActions(new ActionRegistry());
    const decks = new DeckRegistry(actions);
    const controller = new DeckController(new SilentDeck(), actions, { deckId: 'panel' });
    await decks.add({ id: 'panel', name: 'panel', controller }, PROFILE);

    const service = new DeckService({
      decks,
      actions,
      profiles,
      settings,
      settingsValue: { ...DEFAULT_SETTINGS },
      applyNetwork: async () => {
        throw new Error('address already in use');
      },
    });

    await assert.rejects(() => service.setNetworkSettings({ networkAccess: true }), /already in use/);

    const { network } = await service.state();
    assert.equal(network.running, false);
    assert.equal(network.networkAccess, false, 'the switch stayed on after a failure');
  });

  it('a port the owner could not take is reported as it is, not as asked', async () => {
    // The stored port may be busy; showing the setting rather than the truth
    // would send someone to an address nothing answers on.
    const { profiles, settings } = repositories({ ...DEFAULT_SETTINGS, networkAccess: true, port: 8317 });
    const actions = registerBuiltinActions(new ActionRegistry());
    const decks = new DeckRegistry(actions);
    const controller = new DeckController(new SilentDeck(), actions, { deckId: 'panel' });
    await decks.add({ id: 'panel', name: 'panel', controller }, PROFILE);

    const service = new DeckService({
      decks,
      actions,
      profiles,
      settings,
      settingsValue: { ...DEFAULT_SETTINGS },
      applyNetwork: async () => ({ port: 8399, networkAccess: true }),
    });
    service.setListening({ port: 8399, networkAccess: true });

    assert.equal((await service.state()).network.port, 8399);
  });
});

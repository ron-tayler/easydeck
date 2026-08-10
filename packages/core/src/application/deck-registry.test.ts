import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ActionRegistry,
  DeckController,
  PLUGIN_API_VERSION,
  PROFILE_FORMAT_VERSION,
  registerBuiltinActions,
} from '@easydeck/engine';
import type { ButtonEvent, PresenterPort, ProfileDefinition, Scene } from '@easydeck/engine';

import { DeckRegistry } from './deck-registry.js';

const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** A deck that accepts scenes and can be told a gesture happened. */
class FakeDeckSurface implements PresenterPort {
  readonly layout = { rows: 1, cols: 2 };
  readonly scenes: Scene[] = [];
  private readonly listeners = new Set<(key: number, gesture: ButtonEvent) => void>();

  onGesture(listener: (key: number, gesture: ButtonEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async present(scene: Scene): Promise<void> {
    this.scenes.push(scene);
  }

  gesture(key: number, gesture: ButtonEvent = 'press'): void {
    for (const listener of this.listeners) listener(key, gesture);
  }

  label(key: number): string | undefined {
    const scene = this.scenes[this.scenes.length - 1];
    const region = scene?.regions.find((candidate) => candidate.key === key);
    return region?.labels?.[0]?.text;
  }
}

function profileWith(id: string, variable: string): ProfileDefinition {
  return {
    formatVersion: PROFILE_FORMAT_VERSION,
    id,
    name: id,
    layout: { rows: 1, cols: 2 },
    variables: [{ name: variable, type: 'number', initial: 0 }],
    root: {
      id: 'root',
      name: 'Root',
      pages: [
        {
          id: 'main',
          buttons: [
            {
              id: 'shows',
              key: 0,
              states: [{ id: 'default', visual: { label: { text: `{{${variable}}}` } } }],
            },
            {
              id: 'bumps',
              key: 1,
              states: [
                {
                  id: 'default',
                  visual: { label: { text: '+' } },
                  actions: {
                    press: [{ type: 'vars.increment-variable', params: { name: variable } }],
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

async function registryWith(...ids: string[]) {
  const actions = registerBuiltinActions(new ActionRegistry());
  const registry = new DeckRegistry(actions);
  const surfaces = new Map<string, FakeDeckSurface>();

  for (const id of ids) {
    const surface = new FakeDeckSurface();
    surfaces.set(id, surface);

    const controller = new DeckController(surface, actions, {
      variables: registry.variables,
      deckId: id,
    });
    await registry.add({ id, name: id, controller }, profileWith(id, 'clicks'));
  }

  return { registry, surfaces, actions };
}

describe('DeckRegistry', () => {
  it('runs several decks at once', async () => {
    const { registry } = await registryWith('panel', 'tablet');

    assert.equal(registry.size, 2);
    assert.deepEqual(registry.list().map((deck) => deck.id), ['panel', 'tablet']);
    assert.equal(registry.first?.id, 'panel');
  });

  it('gives every deck the same variables', async () => {
    const { registry, surfaces } = await registryWith('panel', 'tablet');

    surfaces.get('tablet')!.gesture(1, 'press');
    await settle();

    assert.equal(surfaces.get('panel')!.label(0), '1', 'the panel did not see it');
    assert.equal(registry.variables.get('clicks'), 1);
  });

  it('changing one deck profile leaves the others alone', async () => {
    const { registry, surfaces } = await registryWith('panel', 'tablet');

    await registry.setProfile('tablet', profileWith('other', 'taps'));
    await settle();

    assert.equal(registry.get('tablet')?.controller.profileId, 'other');
    assert.equal(registry.get('panel')?.controller.profileId, 'panel');
    assert.equal(surfaces.get('tablet')!.label(0), '0');
  });

  it('collects the variables of every deck, whatever profile it runs', async () => {
    // A configurator offers one list, but the profiles behind it may differ:
    // a variable declared only on the tablet is still a variable of this
    // machine.
    const { registry, actions } = await registryWith('panel');

    const tablet = new FakeDeckSurface();
    const controller = new DeckController(tablet, actions, {
      variables: registry.variables,
      deckId: 'tablet',
    });
    await registry.add({ id: 'tablet', name: 'tablet', controller }, profileWith('t', 'taps'));

    const names = registry.declarations().map((declaration) => declaration.name);
    assert.ok(names.includes('clicks'), `missing clicks in ${names.join(', ')}`);
    assert.ok(names.includes('taps'), `missing taps in ${names.join(', ')}`);
  });

  it('a plugin keeps ownership of its variable when a profile restates it', async () => {
    // A profile may restate a plugin variable to give it a starting value, but
    // not to change what it is: everything downstream reasons about the type,
    // and the plugin is the one publishing the values.
    const actions = registerBuiltinActions(new ActionRegistry());
    actions.installPlugin(
      {
        id: 'meter',
        name: { en: 'Meter' },
        description: { en: 'test' },
        version: '1.0.0',
        apiVersion: PLUGIN_API_VERSION,
        variables: [{ name: 'meter.level', type: 'number', label: { en: 'Level' } }],
        actions: [],
      },
      {},
    );

    const registry = new DeckRegistry(actions);
    const surface = new FakeDeckSurface();
    const controller = new DeckController(surface, actions, {
      variables: registry.variables,
      deckId: 'panel',
    });

    const profile = profileWith('panel', 'clicks');
    await registry.add(
      { id: 'panel', name: 'panel', controller },
      { ...profile, variables: [{ name: 'meter.level', type: 'string', initial: 'loud' }] },
    );

    const declaration = registry.declarations().find((entry) => entry.name === 'meter.level');
    assert.equal(declaration?.type, 'number', 'the profile took the plugin variable over');
    assert.equal(declaration?.pluginId, 'meter');
  });

  it('renames a deck', async () => {
    const { registry } = await registryWith('panel');

    registry.rename('panel', 'Слева');

    assert.equal(registry.get('panel')?.name, 'Слева');
  });

  it('removing a deck stops it and forgets it', async () => {
    const { registry } = await registryWith('panel', 'tablet');

    await registry.removeDeck('panel');

    assert.equal(registry.size, 1);
    assert.equal(registry.get('panel'), undefined);
    assert.equal(registry.first?.id, 'tablet');
  });

  it('stopping empties the registry', async () => {
    const { registry } = await registryWith('panel', 'tablet');

    await registry.stop();

    assert.equal(registry.size, 0);
    assert.equal(registry.first, undefined);
  });

  it('announces every change, so a UI can follow', async () => {
    const { registry } = await registryWith('panel');
    let changes = 0;
    registry.on('changed', () => changes++);

    registry.rename('panel', 'Панель');
    await registry.setProfile('panel', profileWith('panel', 'clicks'));
    await registry.removeDeck('panel');

    assert.equal(changes, 3);
  });
});

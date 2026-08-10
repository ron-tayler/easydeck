import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, it } from 'node:test';

import { DeckController, VariableStore, createActionRegistry } from '@easydeck/engine';
import type { ButtonEvent, ProfileDefinition, Scene } from '@easydeck/engine';

import { PluginRuntime } from '../../application/plugin-runtime.js';
import { PluginSettingsStore } from './plugin-settings-store.js';
import { findDisks, hardwareManifest, registerHardwarePlugin } from './hardware-plugin.js';

/**
 * A runtime pointed at folders that do not exist.
 *
 * The hardware plugin has no settings, so nothing is ever read or written;
 * the paths are here so a stray write would land somewhere harmless rather
 * than in the user's own configuration.
 */
function bench() {
  const variables = new VariableStore();
  const runtime = new PluginRuntime({
    settings: new PluginSettingsStore(undefined, '/nonexistent/open', '/nonexistent/sealed'),
    variables,
  });
  return { variables, runtime, registry: createActionRegistry() };
}

/** Just enough of a deck to see what a key would say. */
class Presenter {
  readonly layout = { rows: 1, cols: 1 };
  readonly scenes: Scene[] = [];

  onGesture(_listener: (key: number, gesture: ButtonEvent) => void): () => void {
    return () => undefined;
  }

  async present(scene: Scene): Promise<void> {
    this.scenes.push(scene);
  }

  setDoublePressKeys(_keys: readonly number[]): void {}
}

const gaugeProfile: ProfileDefinition = {
  formatVersion: 5,
  id: 'gauge',
  name: 'Gauge',
  layout: { rows: 1, cols: 1 },
  root: {
    id: 'root',
    name: 'Root',
    pages: [
      {
        id: 'main',
        buttons: [
          {
            id: 'cpu',
            key: 0,
            states: [{ id: 'default', visual: { label: { text: '{{hw.cpu}}%' } } }],
          },
        ],
      },
    ],
  },
};

describe('hardware plugin', () => {
  it('publishes the processor and memory on its own schedule', async () => {
    const bed = bench();
    await registerHardwarePlugin(bed.registry, bed.runtime, {
      fastIntervalMs: 20,
      diskIntervalMs: 10_000,
    });

    // Total memory is known immediately; the rest needs one interval, because
    // processor load is a difference between two samples and there is only
    // one of them at startup.
    assert.ok((bed.variables.get('hw.memory-total') as number) > 0);
    await delay(80);

    const cpu = bed.variables.get('hw.cpu');
    assert.equal(typeof cpu, 'number');
    assert.ok((cpu as number) >= 0 && (cpu as number) <= 100, `processor load was ${cpu}`);

    const memory = bed.variables.get('hw.memory') as number;
    assert.ok(memory > 0 && memory <= 100, `memory was ${memory}%`);
    assert.ok((bed.variables.get('hw.memory-used') as number) > 0);

    await bed.runtime.stopAll();
  });

  it('publishes every disk it found', async () => {
    const bed = bench();
    const disks = await findDisks();
    await registerHardwarePlugin(bed.registry, bed.runtime, { fastIntervalMs: 10_000 });
    await delay(50);

    assert.ok(disks.length > 0, 'a machine running tests has at least one filesystem');
    for (const disk of disks) {
      const used = bed.variables.get(`hw.disk-${disk.key}`);
      assert.equal(typeof used, 'number', `disk ${disk.label} reported nothing`);
      assert.ok((used as number) >= 0 && (used as number) <= 100);
    }

    await bed.runtime.stopAll();
  });

  it('declares every variable it writes', async () => {
    // The runtime refuses an undeclared name, so this passes or the plugin
    // does not start — but stating it here says which side the rule protects.
    const bed = bench();
    bed.runtime.on('error', (error) => assert.fail(error.message));

    await registerHardwarePlugin(bed.registry, bed.runtime, { fastIntervalMs: 20 });
    await delay(80);

    assert.equal(bed.runtime.status('hardware')?.status, 'ready');
    await bed.runtime.stopAll();
  });

  it('offers its variables to the configurator before anything has changed', async () => {
    // The reason it is installed into the action registry at all: a plugin
    // with no actions still has to be bindable the moment it is there.
    const bed = bench();
    await registerHardwarePlugin(bed.registry, bed.runtime, { fastIntervalMs: 10_000 });

    const declared = bed.registry.variables();
    const cpu = declared.find((variable) => variable.name === 'hw.cpu');
    assert.equal(cpu?.pluginId, 'hardware');
    assert.equal(cpu?.type, 'number');

    await bed.runtime.stopAll();
  });

  it('stops reading once it is stopped', async () => {
    const bed = bench();
    await registerHardwarePlugin(bed.registry, bed.runtime, { fastIntervalMs: 10 });
    await delay(40);
    await bed.runtime.stopAll();

    // Its variables went with it; nothing may write them back afterwards.
    await delay(40);
    assert.equal(bed.variables.has('hw.cpu'), false);
  });

  it('puts a live figure on a key, which is the whole point', async () => {
    // The path end to end: the plugin writes a variable, the store wakes the
    // controller, the label substitutes it. Every piece of this existed
    // before the plugin did — which is why the plugin is only a timer.
    const bed = bench();
    const presenter = new Presenter();
    const deck = new DeckController(presenter, bed.registry, { variables: bed.variables });

    await registerHardwarePlugin(bed.registry, bed.runtime, { fastIntervalMs: 20 });
    await deck.load(gaugeProfile);
    await delay(120);

    const label = deck.view()[0]?.visual.label?.text;
    assert.match(label ?? '', /^\d{1,3}%$/, `the key read '${label}'`);

    await deck.stop();
    await bed.runtime.stopAll();
  });

  it('names disks after what they are called on this platform', () => {
    const manifest = hardwareManifest([{ root: 'C:\\', key: 'c', label: 'C' }]);
    const names = (manifest.variables ?? []).map((variable) => variable.name);

    assert.ok(names.includes('hw.disk-c'));
    assert.ok(names.includes('hw.disk-c-free'));
    assert.deepEqual(manifest.actions, [], 'it publishes; it does not do');
  });
});

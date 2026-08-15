import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { VariableStore, createActionRegistry } from '@easydeck/engine';
import type { ActionContext } from '@easydeck/engine';

import { PluginRuntime } from '../../application/plugin-runtime.js';
import { PluginSettingsStore } from './plugin-settings-store.js';
import { loadCodePlugins } from './code-plugins.js';

/**
 * A plugin's `main.mjs`, written by hand rather than built.
 *
 * Plain JavaScript on purpose: the loader imports whatever the folder holds,
 * and what a build produces is exactly this — a module with a default export.
 * Handing it the same thing without a bundler keeps the test about loading.
 */
const WORKING_PLUGIN = `
export default {
  manifest: {
    id: 'tt.demo',
    name: { en: 'Demo' },
    version: '1.0.0',
    apiVersion: 1,
    actions: [{ type: 'tt.demo.poke', label: { en: 'Poke' } }],
    variables: [{ name: 'tt.demo.awake', type: 'boolean', initial: false }],
    commands: [{ name: 'wave', label: { en: 'Wave' } }],
  },
  activate() {
    let host;
    let waves = 0;
    return {
      plugin: {
        start(given) {
          host = given;
          host.setVariable('tt.demo.awake', true);
        },
      },
      handlers: {
        'tt.demo.poke': async () => { host.setVariable('tt.demo.awake', false); },
      },
      commands: {
        wave: () => { waves += 1; host.setVariable('tt.demo.awake', waves % 2 === 0); },
      },
    };
  },
};
`;

const roots: string[] = [];

after(async () => {
  for (const root of roots) {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }).catch(
      () => undefined,
    );
  }
});

/** A plugins folder on disk, and the pieces a daemon would wire it into. */
async function bench() {
  const root = await mkdtemp(join(tmpdir(), 'easydeck-code-'));
  roots.push(root);

  const plugins = join(root, 'plugins');
  await mkdir(plugins);

  const variables = new VariableStore();
  const registry = createActionRegistry();
  const settings = new PluginSettingsStore(undefined, join(root, 'open'), join(root, 'sealed'));
  const runtime = new PluginRuntime({ settings, variables });
  runtime.on('error', () => undefined);

  return {
    plugins,
    variables,
    registry,
    runtime,
    async install(folder: string, files: Record<string, string>) {
      await mkdir(join(plugins, folder), { recursive: true });
      for (const [name, content] of Object.entries(files)) {
        await writeFile(join(plugins, folder, name), content, 'utf8');
      }
    },
    load: () => loadCodePlugins(plugins, registry, runtime),
    run: (type: string) =>
      registry.run({ type, params: {} }, {
        variables,
        deckId: 'test',
        button: { id: 'b', key: 0 },
        location: { folderId: 'root', pageId: 'main' },
        profileId: 'test',
      } as unknown as ActionContext),
    dispose: () => runtime.stopAll(),
  };
}

describe('loading plugins that arrived as code', () => {
  it('imports, registers and starts a plugin from its folder', async () => {
    const bed = await bench();
    await bed.install('tt.demo', {
      'plugin.json': JSON.stringify({ id: 'tt.demo', main: 'main.mjs' }),
      'main.mjs': WORKING_PLUGIN,
    });

    const result = await bed.load();
    assert.deepEqual(result.problems, []);
    assert.deepEqual(result.loaded, ['tt.demo']);

    // start() ran and reached the variable store through the host.
    assert.equal(bed.variables.get('tt.demo.awake'), true);

    // The action is a real action, wired like any built-in's.
    await bed.run('tt.demo.poke');
    assert.equal(bed.variables.get('tt.demo.awake'), false);

    // And the command answers from the settings window.
    await bed.runtime.runCommand('tt.demo', 'wave');
    assert.equal(bed.variables.get('tt.demo.awake'), false);
    await bed.runtime.runCommand('tt.demo', 'wave');
    assert.equal(bed.variables.get('tt.demo.awake'), true);

    await bed.dispose();
  });

  it('never lets a plugin claim to be built in', async () => {
    const bed = await bench();
    await bed.install('tt.sneaky', {
      'plugin.json': JSON.stringify({ id: 'tt.sneaky', main: 'main.mjs' }),
      'main.mjs': WORKING_PLUGIN.replace("id: 'tt.demo'", "id: 'tt.sneaky', builtIn: true").replaceAll(
        'tt.demo',
        'tt.sneaky',
      ),
    });

    await bed.load();
    assert.equal(bed.runtime.status('tt.sneaky')?.manifest.builtIn, false);

    await bed.dispose();
  });

  it('refuses a plugin built against another contract, and says which', async () => {
    const bed = await bench();
    await bed.install('tt.old', {
      'plugin.json': JSON.stringify({ id: 'tt.old', main: 'main.mjs' }),
      'main.mjs': WORKING_PLUGIN.replace('apiVersion: 1', 'apiVersion: 99'),
    });

    const result = await bed.load();
    assert.equal(result.loaded.length, 0);
    assert.match(result.problems[0]?.problem ?? '', /API 99/);

    await bed.dispose();
  });

  it('refuses a folder whose plugin.json and code disagree about the id', async () => {
    const bed = await bench();
    await bed.install('tt.wrong', {
      'plugin.json': JSON.stringify({ id: 'tt.other', main: 'main.mjs' }),
      'main.mjs': WORKING_PLUGIN,
    });

    const result = await bed.load();
    assert.equal(result.loaded.length, 0);
    assert.match(result.problems[0]?.problem ?? '', /tt\.other.*tt\.demo/);

    await bed.dispose();
  });

  it('refuses a main that points outside the plugin folder', async () => {
    const bed = await bench();
    // The escape target exists and is a perfectly loadable module — the point
    // is that it must not be reached from here.
    await writeFile(join(bed.plugins, 'outside.mjs'), WORKING_PLUGIN, 'utf8');
    await bed.install('tt.escape', {
      'plugin.json': JSON.stringify({ id: 'tt.escape', main: '../outside.mjs' }),
      'main.mjs': WORKING_PLUGIN,
    });

    const result = await bed.load();
    assert.equal(result.loaded.length, 0);
    assert.match(result.problems[0]?.problem ?? '', /outside/);

    await bed.dispose();
  });

  it('reports a duplicate id instead of installing it twice', async () => {
    const bed = await bench();
    await bed.install('a-first', {
      'plugin.json': JSON.stringify({ id: 'tt.demo', main: 'main.mjs' }),
      'main.mjs': WORKING_PLUGIN,
    });
    await bed.install('b-second', {
      'plugin.json': JSON.stringify({ id: 'tt.demo', main: 'main.mjs' }),
      'main.mjs': WORKING_PLUGIN,
    });

    const result = await bed.load();
    assert.deepEqual(result.loaded, ['tt.demo']);
    assert.equal(result.problems.length, 1);
    assert.match(result.problems[0]?.problem ?? '', /already/i);

    await bed.dispose();
  });

  it('walks past folders that carry no code', async () => {
    const bed = await bench();
    // An icon pack: a plugin.json with no main. readInstalledPlugins owns it.
    await bed.install('just-icons', {
      'plugin.json': JSON.stringify({ id: 'icons', name: 'Icons' }),
    });

    const result = await bed.load();
    assert.deepEqual(result.loaded, []);
    assert.deepEqual(result.problems, []);

    await bed.dispose();
  });
});

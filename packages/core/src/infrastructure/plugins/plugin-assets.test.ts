import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import type { PluginManifest } from '@easydeck/engine';

import { PluginAssets, builtInAssetsDir } from './plugin-assets.js';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>';

/** Two folders standing in for the two places a plugin's pictures may live. */
async function folders(): Promise<{ builtIn: string; installed: string; clean: () => Promise<void> }> {
  const builtIn = await mkdtemp(join(tmpdir(), 'easydeck-built-in-'));
  const installed = await mkdtemp(join(tmpdir(), 'easydeck-installed-'));

  await mkdir(join(builtIn, 'hardware'), { recursive: true });
  await writeFile(join(builtIn, 'hardware', 'gauge.svg'), SVG, 'utf8');

  await mkdir(join(installed, 'mypack', 'icons', 'deep'), { recursive: true });
  await writeFile(join(installed, 'mypack', 'icons', 'deep', 'star.svg'), SVG, 'utf8');

  return {
    builtIn,
    installed,
    clean: async () => {
      await rm(builtIn, { recursive: true, force: true });
      await rm(installed, { recursive: true, force: true });
    },
  };
}

/** A preset naming a picture, which is the whole reason this exists. */
function manifestWith(source: string): PluginManifest {
  return {
    id: 'hardware',
    name: { en: 'Hardware' },
    version: '1.0.0',
    apiVersion: 1,
    actions: [],
    presets: [
      {
        name: 'cpu',
        label: { en: 'Processor' },
        button: { states: [{ id: 'default', visual: { icon: { source } } }] },
      },
    ],
  } as unknown as PluginManifest;
}

describe('pictures that arrive with a plugin', () => {
  it('reads one out of a built-in plugin, and one out of an installed folder', async () => {
    const { builtIn, installed, clean } = await folders();
    const assets = new PluginAssets(builtIn, installed);

    const own = await assets.read('plugin:hardware/gauge.svg');
    const other = await assets.read('plugin:mypack/deep/star.svg');

    assert.match(own ?? '', /^data:image\/svg\+xml;base64,/);
    assert.equal(Buffer.from((own ?? '').split(',')[1]!, 'base64').toString('utf8'), SVG);
    // Another plugin's picture needs no arrangement between the two: one
    // resolver sees every folder.
    assert.match(other ?? '', /^data:image\/svg\+xml;base64,/);

    await clean();
  });

  it('refuses a path that climbs out of the folder', async () => {
    // A reference is ordinary data and may arrive from a plugin somebody
    // installed; a path that walks upwards must not be followed.
    const { builtIn, installed, clean } = await folders();
    const assets = new PluginAssets(builtIn, installed);

    assert.equal(await assets.read('plugin:hardware/../../settings.json'), undefined);
    assert.equal(await assets.read('plugin:hardware/./../hardware/gauge.svg'), undefined);

    await clean();
  });

  it('answers with nothing for what is missing or not a picture', async () => {
    const { builtIn, installed, clean } = await folders();
    const assets = new PluginAssets(builtIn, installed);

    assert.equal(await assets.read('plugin:hardware/absent.svg'), undefined);
    assert.equal(await assets.read('plugin:hardware/notes.txt'), undefined);
    assert.equal(await assets.read('plugin:nosuch/gauge.svg'), undefined);
    assert.equal(await assets.read('not a reference'), undefined);

    await clean();
  });
});

describe('a manifest on its way to a window', () => {
  it('carries the picture rather than the reference', async () => {
    // Which is what keeps a profile free of plugins: dropping the preset on
    // the grid stores an ordinary icon, and it survives the plugin going away.
    const { builtIn, installed, clean } = await folders();
    const assets = new PluginAssets(builtIn, installed);

    const expanded = await assets.expand(manifestWith('plugin:hardware/gauge.svg'));
    const icon = expanded.presets?.[0]?.button.states[0]?.visual.icon?.source ?? '';

    assert.match(icon, /^data:image\/svg\+xml;base64,/);

    await clean();
  });

  it('leaves a reference it cannot satisfy exactly as it was', async () => {
    // A preset naming a picture that is not there is a preset with no picture,
    // not a plugin that fails to list.
    const { builtIn, installed, clean } = await folders();
    const assets = new PluginAssets(builtIn, installed);

    const expanded = await assets.expand(manifestWith('plugin:hardware/absent.svg'));

    assert.equal(
      expanded.presets?.[0]?.button.states[0]?.visual.icon?.source,
      'plugin:hardware/absent.svg',
    );

    await clean();
  });

  it('leaves a manifest with no references untouched', async () => {
    const { builtIn, installed, clean } = await folders();
    const assets = new PluginAssets(builtIn, installed);

    const manifest = manifestWith('data:image/png;base64,AA==');
    assert.equal(await assets.expand(manifest), manifest, 'the same object, not a copy');

    await clean();
  });
});

describe('where the built-in pictures live', () => {
  it('resolves to this package rather than to the working directory', () => {
    // The same path from `src` and from `dist`, so a test and a build agree.
    assert.match(builtInAssetsDir().replace(/\\/g, '/'), /\/core\/assets\/$/);
  });
});

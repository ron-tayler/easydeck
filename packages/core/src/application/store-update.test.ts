import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { PLUGIN_API_VERSION } from '@easydeck/engine';

import { DeckService } from './deck-service.js';
import { FolderPluginSource } from '../infrastructure/plugins/folder-plugin-source.js';
import { STORE_FILE } from '../infrastructure/plugins/archive-plugin-source.js';
import { PluginSettingsStore } from '../infrastructure/plugins/plugin-settings-store.js';
import { pluginSettingsDir, pluginsDir } from '../infrastructure/config-paths.js';
import { writeZip } from '../infrastructure/zip-writer.js';

/**
 * Installing a plugin, and then installing it again over itself.
 *
 * The store has been able to say "Update" since it was written, and nothing
 * had ever pressed the button. What is checked here is the whole of that: the
 * word a row shows before and after, the folder actually changing, and — the
 * part somebody would only discover by losing it — the settings and tokens
 * surviving the replacement.
 */

const roots: string[] = [];
const configWas = process.env['EASYDECK_CONFIG_DIR'];

after(async () => {
  if (configWas === undefined) delete process.env['EASYDECK_CONFIG_DIR'];
  else process.env['EASYDECK_CONFIG_DIR'] = configWas;

  for (const root of roots) await rm(root, { recursive: true, force: true }).catch(() => undefined);
});

async function scratch(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'easydeck-update-'));
  roots.push(root);
  return root;
}

/** A plugin archive, the shape the build script makes one. */
function archiveOf(version: string): Uint8Array {
  return writeZip([
    {
      name: 'plugin.json',
      bytes: Buffer.from(
        JSON.stringify({
          id: 'ed.demo',
          main: 'main.mjs',
          name: { en: 'Demo' },
          version,
          apiVersion: PLUGIN_API_VERSION,
          actions: [],
        }),
        'utf8',
      ),
    },
    { name: 'main.mjs', bytes: Buffer.from(`export default { version: '${version}' };`, 'utf8') },
  ]);
}

/** A source offering exactly one version of one plugin. */
async function shelfWith(root: string, version: string): Promise<void> {
  const archive = archiveOf(version);
  const sha256 = createHash('sha256').update(archive).digest('hex');

  await mkdir(join(root, 'build'), { recursive: true });
  await writeFile(join(root, 'build', 'ed.demo.easydeck'), archive);
  await writeFile(
    join(root, 'build', STORE_FILE),
    writeZip([
      {
        name: 'index.json',
        bytes: Buffer.from(
          JSON.stringify({
            plugins: [
              {
                id: 'ed.demo',
                author: 'ed',
                version,
                apiVersion: PLUGIN_API_VERSION,
                file: 'ed.demo.easydeck',
                sha256,
                bytes: archive.byteLength,
                name: { en: 'Demo' },
              },
            ],
          }),
          'utf8',
        ),
      },
    ]),
  );
}

/** A service with nothing but a shelf, which is all the store needs. */
function storeOn(root: string): DeckService {
  const service = Object.create(DeckService.prototype) as DeckService;
  (service as unknown as { options: unknown }).options = {
    pluginSource: new FolderPluginSource(root),
  };
  return service;
}

describe('updating a plugin from the store', () => {
  it('says install, then installed, then update — and does it', async () => {
    process.env['EASYDECK_CONFIG_DIR'] = await scratch();
    const shelf = await scratch();
    await shelfWith(shelf, '1.0.0');

    const store = storeOn(shelf);

    const before = (await store.storePlugins())[0]!;
    assert.equal(before.installedVersion, undefined);

    await store.installPlugin('ed.demo');

    const installed = (await store.storePlugins())[0]!;
    // Same version on the shelf and on disk: there is nothing to press.
    assert.equal(installed.installedVersion, '1.0.0');
    assert.equal(installed.version, '1.0.0');

    // The shelf moves on, which is the only thing that changes the word.
    await shelfWith(shelf, '1.1.0');
    const store2 = storeOn(shelf);
    const newer = (await store2.storePlugins())[0]!;
    assert.equal(newer.version, '1.1.0');
    assert.equal(newer.installedVersion, '1.0.0');

    /*
     * Replacing is refused unless asked for, because two plugins with one id
     * may be one plugin updated or two authors colliding — and only a person
     * can say which. The store's Update button is what says it.
     */
    await assert.rejects(() => store2.installPlugin('ed.demo'), /already installed/);
    await store2.installPlugin('ed.demo', { replace: true });

    const after = (await store2.storePlugins())[0]!;
    assert.equal(after.installedVersion, '1.1.0');
    // And the code on disk is the new code, not merely the new manifest.
    assert.match(
      await readFile(join(pluginsDir(), 'ed.demo', 'main.mjs'), 'utf8'),
      /version: '1.1.0'/,
    );
  });

  it('keeps the settings and tokens an update is not about', async () => {
    process.env['EASYDECK_CONFIG_DIR'] = await scratch();
    const shelf = await scratch();
    await shelfWith(shelf, '1.0.0');

    await storeOn(shelf).installPlugin('ed.demo');

    // What somebody configured after installing: a port and a password.
    const settings = new PluginSettingsStore();
    await settings.save(
      'ed.demo',
      { port: 4455, token: 'a-secret' },
      [
        { name: 'port', type: 'number', label: { en: 'Port' } },
        { name: 'token', type: 'string', secret: true, label: { en: 'Token' } },
      ],
    );

    await shelfWith(shelf, '1.1.0');
    await storeOn(shelf).installPlugin('ed.demo', { replace: true });

    /*
     * The whole reason settings live beside the plugins folder rather than
     * inside it: an update replaces the folder, and a password typed a month
     * ago has nothing to do with the version of the code.
     */
    const kept = await new PluginSettingsStore().load('ed.demo');
    assert.equal(kept['port'], 4455);
    assert.equal(kept['token'], 'a-secret');
    assert.ok(pluginSettingsDir().startsWith(process.env['EASYDECK_CONFIG_DIR']!));
  });

  it('leaves what was there when the download is not what was promised', async () => {
    process.env['EASYDECK_CONFIG_DIR'] = await scratch();
    const shelf = await scratch();
    await shelfWith(shelf, '1.0.0');
    await storeOn(shelf).installPlugin('ed.demo');

    // A shelf whose index and archive disagree: a build half-published, or
    // something rewritten in between.
    await shelfWith(shelf, '1.1.0');
    await writeFile(join(shelf, 'build', 'ed.demo.easydeck'), archiveOf('9.9.9'));

    const store = storeOn(shelf);
    await assert.rejects(() => store.installPlugin('ed.demo', { replace: true }), /does not match/);

    // Refused before anything was unpacked, so what was working still is.
    assert.match(
      await readFile(join(pluginsDir(), 'ed.demo', 'main.mjs'), 'utf8'),
      /version: '1.0.0'/,
    );
  });
});

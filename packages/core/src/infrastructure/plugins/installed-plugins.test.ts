import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { deflateRawSync } from 'node:zlib';

import { readInstalledPlugins } from './installed-plugins.js';

/**
 * The plugins folder, as people will actually fill it.
 *
 * One thing carrying several — pictures, text, and later actions — because
 * that is how a pack for a game arrives: the icons, their names in three
 * languages and the macros that go with them are one download, and should be
 * one thing to remove.
 */

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

async function folder(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'easydeck-plugins-'));
}

/** A pack in Stream Deck's own shape, built by hand. */
function packBytes(name: string, icons: readonly string[]): Buffer {
  const root = 'com.example.pack.sdIconPack/';
  const files = [
    { name: `${root}manifest.json`, data: Buffer.from(JSON.stringify({ Name: name })) },
    {
      name: `${root}icons.json`,
      data: Buffer.from(JSON.stringify(icons.map((icon) => ({ path: `${icon}.svg`, name: icon })))),
    },
    ...icons.map((icon) => ({
      name: `${root}icons/${icon}.svg`,
      data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    })),
  ];

  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const entryName = Buffer.from(file.name, 'utf8');
    const payload = deflateRawSync(file.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(entryName.length, 26);
    locals.push(local, entryName, payload);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(8, 10);
    header.writeUInt32LE(payload.length, 20);
    header.writeUInt32LE(file.data.length, 24);
    header.writeUInt16LE(entryName.length, 28);
    header.writeUInt32LE(offset, 42);
    central.push(header, entryName);

    offset += local.length + entryName.length + payload.length;
  }

  const body = Buffer.concat(locals);
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(body.length, 16);

  return Buffer.concat([body, directory, end]);
}

describe('what is installed in the plugins folder', () => {
  it('reads a plugin of ours: its manifest, its pictures, its text', async () => {
    const root = await folder();
    const plugin = join(root, 'sim-racing');
    await mkdir(join(plugin, 'icons', 'apps'), { recursive: true });
    await mkdir(join(plugin, 'locales'), { recursive: true });

    await writeFile(
      join(plugin, 'plugin.json'),
      JSON.stringify({ id: 'sim', name: 'Sim Racing', version: '1.2.0' }),
    );
    await writeFile(join(plugin, 'icons', 'apps', 'ac.png'), PNG);
    await writeFile(join(plugin, 'locales', 'ru.json'), JSON.stringify({ sim: { start: 'Старт' } }));

    const { plugins, broken } = await readInstalledPlugins(root);

    assert.deepEqual(broken, []);
    assert.equal(plugins.length, 1);
    assert.equal(plugins[0]?.id, 'sim');
    assert.equal(plugins[0]?.version, '1.2.0');
    // The plugin's name is the folder its pictures appear under, and what was
    // nested inside stays nested.
    assert.deepEqual(
      plugins[0]?.icons.map((icon) => `${icon.group}/${icon.name}`),
      ['Sim Racing/apps/ac'],
    );
    assert.deepEqual(plugins[0]?.messages, { ru: { sim: { start: 'Старт' } } });
  });

  it("reads another program's icon pack as a plugin of icons", async () => {
    // Most of what makes a plugin folder worth having: the packs people
    // already own work, without unpacking or sorting them by hand.
    const root = await folder();
    await writeFile(join(root, 'entypo.streamDeckIconPack'), packBytes('Entypo+', ['mail', 'user']));

    const { plugins } = await readInstalledPlugins(root);

    assert.equal(plugins[0]?.kind, 'stream-deck-icons');
    assert.equal(plugins[0]?.name, 'Entypo+');
    assert.deepEqual(
      plugins[0]?.icons.map((icon) => `${icon.group}/${icon.name}`),
      ['Entypo+/mail', 'Entypo+/user'],
    );
  });

  it('says nothing about a folder that is not a plugin', async () => {
    // Notes, a leftover download, a folder someone made by hand: absence of a
    // manifest is not a fault to report.
    const root = await folder();
    await mkdir(join(root, 'notes'), { recursive: true });
    await writeFile(join(root, 'notes', 'todo.txt'), 'later');

    const { plugins, broken } = await readInstalledPlugins(root);

    assert.deepEqual(plugins, []);
    assert.deepEqual(broken, []);
  });

  it('names a plugin whose manifest will not parse, rather than dropping it', async () => {
    // The pictures are missing either way; silence would leave the user
    // hunting for a folder that looks perfectly fine.
    const root = await folder();
    await mkdir(join(root, 'bad'), { recursive: true });
    await writeFile(join(root, 'bad', 'plugin.json'), '{ this is not json');

    const { plugins, broken } = await readInstalledPlugins(root);

    assert.deepEqual(plugins, []);
    assert.equal(broken.length, 1);
    assert.match(broken[0]!.problem, /plugin\.json/);
  });

  it('carries on past a broken plugin to the ones that work', async () => {
    const root = await folder();
    await mkdir(join(root, 'bad'), { recursive: true });
    await writeFile(join(root, 'bad', 'plugin.json'), 'nonsense');
    await mkdir(join(root, 'good', 'icons'), { recursive: true });
    await writeFile(join(root, 'good', 'plugin.json'), JSON.stringify({ name: 'Good' }));
    await writeFile(join(root, 'good', 'icons', 'a.png'), PNG);

    const { plugins, broken } = await readInstalledPlugins(root);

    assert.deepEqual(plugins.map((plugin) => plugin.name), ['Good']);
    assert.equal(broken.length, 1);
  });

  it('answers with nothing when the folder does not exist yet', async () => {
    const { plugins, broken } = await readInstalledPlugins(join(tmpdir(), 'easydeck-no-plugins'));

    assert.deepEqual(plugins, []);
    assert.deepEqual(broken, []);
  });
});

describe('translations a plugin brings', () => {
  it('keeps each locale separate, and only reads JSON', async () => {
    const root = await folder();
    const plugin = join(root, 'sim');
    await mkdir(join(plugin, 'locales'), { recursive: true });
    await writeFile(join(plugin, 'plugin.json'), JSON.stringify({ name: 'Sim' }));
    await writeFile(join(plugin, 'locales', 'ru.json'), JSON.stringify({ a: 'А' }));
    await writeFile(join(plugin, 'locales', 'en.json'), JSON.stringify({ a: 'A' }));
    await writeFile(join(plugin, 'locales', 'notes.txt'), 'not a translation');

    const { plugins } = await readInstalledPlugins(root);

    assert.deepEqual(plugins[0]?.messages, { ru: { a: 'А' }, en: { a: 'A' } });
  });

  it('loses one broken locale file and no others', async () => {
    const root = await folder();
    const plugin = join(root, 'sim');
    await mkdir(join(plugin, 'locales'), { recursive: true });
    await writeFile(join(plugin, 'plugin.json'), JSON.stringify({ name: 'Sim' }));
    await writeFile(join(plugin, 'locales', 'ru.json'), '{ broken');
    await writeFile(join(plugin, 'locales', 'en.json'), JSON.stringify({ a: 'A' }));

    const { plugins } = await readInstalledPlugins(root);

    assert.deepEqual(plugins[0]?.messages, { en: { a: 'A' } });
  });
});

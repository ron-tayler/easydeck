import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { deflateRawSync } from 'node:zlib';

import { listLibraryImages } from './icon-library.js';
import { readIconPack } from './icon-pack.js';

/**
 * The icon folder, as people actually keep one.
 *
 * A collection arrives organised — by who drew it, by what it is for — and
 * often as a single packed file. Both have to survive the walk, because a
 * flattened heap of several hundred pictures is a picker nobody can use.
 */

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

async function library(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'easydeck-icons-'));
}

/** A pack shaped exactly like the ones Stream Deck hands out. */
function packBytes(name: string, icons: readonly { path: string; name: string }[]): Buffer {
  const root = 'com.example.pack.sdIconPack/';
  const files: { name: string; data: Buffer }[] = [
    { name: `${root}manifest.json`, data: Buffer.from(JSON.stringify({ Name: name })) },
    {
      name: `${root}icons.json`,
      data: Buffer.from(JSON.stringify(icons.map((icon) => ({ path: icon.path, name: icon.name })))),
    },
    // The badge and the store cover sit beside the icons folder, and are not
    // pictures anyone wants on a key.
    { name: `${root}icon.png`, data: PNG },
    { name: `${root}cover.png`, data: PNG },
    ...icons.map((icon) => ({
      name: `${root}icons/${icon.path}`,
      data: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"><title>${icon.name}</title></svg>`),
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

describe('the icon folder', () => {
  it('keeps the folders a collection came in', async () => {
    // Author, then category: throwing that away leaves one heap sorted by
    // filename, which is exactly what a collection was organised to avoid.
    const root = await library();
    await mkdir(join(root, 'Sim Racing', 'apps'), { recursive: true });
    await mkdir(join(root, 'Sim Racing', 'media'), { recursive: true });
    await writeFile(join(root, 'Sim Racing', 'apps', 'ac.png'), PNG);
    await writeFile(join(root, 'Sim Racing', 'media', 'play.png'), PNG);
    await writeFile(join(root, 'loose.png'), PNG);

    const images = await listLibraryImages(root);

    assert.deepEqual(
      images.map((image) => `${image.group}/${image.name}`),
      ['/loose', 'Sim Racing/apps/ac', 'Sim Racing/media/play'],
    );

    await rm(root, { recursive: true, force: true });
  });

  it('reads SVG, which is what icon packs are drawn in', async () => {
    const root = await library();
    await writeFile(join(root, 'mic.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');

    const [image] = await listLibraryImages(root);

    assert.ok(image?.source.startsWith('data:image/svg+xml;base64,'));

    await rm(root, { recursive: true, force: true });
  });

  it('reads a pack as though it were a folder', async () => {
    // One file to drop in, one to delete, nothing unpacked and left behind.
    const root = await library();
    await mkdir(join(root, 'Downloaded'), { recursive: true });
    await writeFile(
      join(root, 'Downloaded', 'entypo.streamDeckIconPack'),
      packBytes('Entypo+', [
        { path: 'add-user.svg', name: 'add-user' },
        { path: 'mail.svg', name: 'mail' },
      ]),
    );

    const images = await listLibraryImages(root);

    assert.deepEqual(
      images.map((image) => `${image.group}/${image.name}`),
      ['Downloaded/Entypo+/add-user', 'Downloaded/Entypo+/mail'],
    );

    await rm(root, { recursive: true, force: true });
  });

  it('ignores files it cannot show, and says nothing about a missing folder', async () => {
    const root = await library();
    await writeFile(join(root, 'notes.txt'), 'not a picture');
    await writeFile(join(root, 'ok.png'), PNG);

    assert.deepEqual((await listLibraryImages(root)).map((image) => image.name), ['ok']);
    assert.deepEqual(await listLibraryImages(join(root, 'nowhere')), []);

    await rm(root, { recursive: true, force: true });
  });
});

describe('an icon pack', () => {
  it('takes its folder name from the manifest, and its icon names from the index', async () => {
    const root = await library();
    const file = join(root, 'pack.streamDeckIconPack');
    await writeFile(file, packBytes('Entypo+', [{ path: 'au.svg', name: 'add-user' }]));

    const pack = await readIconPack(file, 100);

    assert.equal(pack?.name, 'Entypo+');
    // The file is `au.svg`; the pack calls it `add-user`, and that is what a
    // person searching for it will type.
    assert.deepEqual(pack?.images.map((image) => image.name), ['add-user']);

    await rm(root, { recursive: true, force: true });
  });

  it('leaves the badge and the cover out', async () => {
    const root = await library();
    const file = join(root, 'pack.streamDeckIconPack');
    await writeFile(file, packBytes('Pack', [{ path: 'a.svg', name: 'a' }]));

    const pack = await readIconPack(file, 100);

    assert.deepEqual(pack?.images.map((image) => image.name), ['a']);

    await rm(root, { recursive: true, force: true });
  });

  it('spends no more than it is allowed', async () => {
    // A folder holding several packs must not let the first spend the whole
    // library's budget.
    const root = await library();
    const file = join(root, 'pack.streamDeckIconPack');
    await writeFile(
      file,
      packBytes('Pack', [
        { path: 'a.svg', name: 'a' },
        { path: 'b.svg', name: 'b' },
        { path: 'c.svg', name: 'c' },
      ]),
    );

    assert.equal((await readIconPack(file, 2))?.images.length, 2);
    assert.equal(await readIconPack(file, 0), undefined);

    await rm(root, { recursive: true, force: true });
  });

  it('is not fooled by a file that only looks like one', async () => {
    const root = await library();
    const file = join(root, 'broken.streamDeckIconPack');
    await writeFile(file, 'certainly not a zip');

    assert.equal(await readIconPack(file, 100), undefined);

    await rm(root, { recursive: true, force: true });
  });
});

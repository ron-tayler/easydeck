import assert from 'node:assert/strict';
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import type { ProfileDefinition } from '@easydeck/engine';

import { FileProfileRepository, assertSafeProfileId } from './file-profile-repository.js';
import { FileSettingsRepository } from './file-settings-repository.js';

function profile(id: string, name = 'Test'): ProfileDefinition {
  return {
    id,
    name,
    layout: { rows: 1, cols: 2 },
    pages: [
      { id: 'main', buttons: [{ id: 'b', key: 0, states: [{ id: 'default', visual: {} }] }] },
    ],
  };
}

describe('FileProfileRepository', () => {
  let directory: string;
  let repository: FileProfileRepository;

  before(async () => {
    directory = await mkdtemp(join(tmpdir(), 'easydeck-test-'));
    repository = new FileProfileRepository(directory);
  });

  after(async () => {
    await import('node:fs/promises').then((fs) => fs.rm(directory, { recursive: true, force: true }));
  });

  it('reports an empty list for a directory that does not exist yet', async () => {
    const missing = new FileProfileRepository(join(directory, 'nope'));
    assert.deepEqual(await missing.list(), []);
  });

  it('saves and loads a profile round-trip', async () => {
    await repository.save(profile('main', 'Основной'));

    assert.equal(await repository.has('main'), true);
    const loaded = await repository.load('main');
    assert.equal(loaded.name, 'Основной');
    assert.equal(loaded.pages[0]!.buttons[0]!.id, 'b');
  });

  it('lists profiles sorted, with their names', async () => {
    await repository.save(profile('zulu'));
    await repository.save(profile('alpha'));

    const list = await repository.list();
    assert.deepEqual(
      list.map((entry) => entry.id),
      ['alpha', 'main', 'zulu'],
    );
  });

  it('leaves no temporary file behind after a save', async () => {
    await repository.save(profile('atomic'));
    const files = await readdir(directory);
    assert.equal(
      files.some((name) => name.endsWith('.tmp')),
      false,
    );
  });

  it('rejects a profile that fails engine validation', async () => {
    const broken = { ...profile('broken'), pages: [] } as ProfileDefinition;
    await assert.rejects(repository.save(broken), /has no pages/);
  });

  it('skips an unreadable file instead of failing the whole list', async () => {
    await writeFile(join(directory, 'garbage.json'), '{ not json', 'utf8');
    const list = await repository.list();
    assert.equal(
      list.some((entry) => entry.id === 'garbage'),
      false,
    );
    assert.ok(list.length >= 3);
  });

  // Notepad on Windows saves UTF-8 with a byte order mark, and JSON.parse
  // rejects it — so the most obvious editor on the platform would produce a
  // profile the daemon refuses to load.
  it('loads a profile saved with a UTF-8 byte order mark', async () => {
    const withBom = `﻿${JSON.stringify(profile('bommed', 'С меткой'))}`;
    await writeFile(join(directory, 'bommed.json'), withBom, 'utf8');

    const loaded = await repository.load('bommed');
    assert.equal(loaded.name, 'С меткой');
    assert.ok((await repository.list()).some((entry) => entry.id === 'bommed'));
  });

  it('reports a missing profile clearly', async () => {
    await assert.rejects(repository.load('absent'), /No profile 'absent'/);
  });

  it('removes a profile, and removing a missing one is not an error', async () => {
    await repository.save(profile('temporary'));
    await repository.remove('temporary');
    assert.equal(await repository.has('temporary'), false);
    await assert.doesNotReject(repository.remove('temporary'));
  });

  // Ids become file names, so a profile arriving over the future API must not
  // be able to write outside the profile directory.
  it('refuses ids that could escape the directory', () => {
    for (const id of ['../evil', 'a/b', 'a\\b', '', '.hidden', 'a'.repeat(65)]) {
      assert.throws(() => assertSafeProfileId(id), /Invalid profile id/, `expected '${id}' to be rejected`);
    }
    assert.doesNotThrow(() => assertSafeProfileId('my-profile_2'));
  });
});

describe('FileSettingsRepository', () => {
  let directory: string;

  before(async () => {
    directory = await mkdtemp(join(tmpdir(), 'easydeck-settings-'));
  });

  after(async () => {
    await import('node:fs/promises').then((fs) => fs.rm(directory, { recursive: true, force: true }));
  });

  it('falls back to defaults when the file is missing or corrupt', async () => {
    const missing = new FileSettingsRepository(join(directory, 'absent.json'));
    assert.equal((await missing.load()).brightness, 60);

    const corrupt = join(directory, 'corrupt.json');
    await writeFile(corrupt, 'not json at all', 'utf8');
    assert.equal((await new FileSettingsRepository(corrupt).load()).brightness, 60);
  });

  it('round-trips settings and clamps brightness', async () => {
    const file = join(directory, 'settings.json');
    const repository = new FileSettingsRepository(file);

    await repository.save({ activeProfileId: 'main', brightness: 250 });

    const loaded = await repository.load();
    assert.equal(loaded.activeProfileId, 'main');
    assert.equal(loaded.brightness, 100);
  });
});

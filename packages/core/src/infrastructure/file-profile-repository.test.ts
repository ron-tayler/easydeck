import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { PROFILE_FORMAT_VERSION } from '@easydeck/engine';
import type { ProfileDefinition } from '@easydeck/engine';

import { FileProfileRepository, assertSafeProfileId } from './file-profile-repository.js';
import { FileSettingsRepository } from './file-settings-repository.js';

function profile(id: string, name = 'Test'): ProfileDefinition {
  return {
    formatVersion: PROFILE_FORMAT_VERSION,
    id,
    name,
    layout: { rows: 1, cols: 2 },
    root: {
      id: `${id}-root`,
      name: 'Root',
      pages: [
        { id: `${id}-main`, buttons: [{ id: 'b', key: 0, states: [{ id: 'default', visual: {} }] }] },
      ],
    },
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
    assert.equal(loaded.root.pages[0]!.buttons[0]!.id, 'b');
  });

  // Profiles are user data in a folder people are told to edit by hand, so an
  // upgrade must never be the reason someone's deck stops working.
  it('migrates a version 1 profile, whose pages become the root scene', async () => {
    // Its own directory: this profile would otherwise show up in the listing
    // assertions of neighbouring tests.
    const isolated = await mkdtemp(join(tmpdir(), 'easydeck-migrate-'));
    const store = new FileProfileRepository(isolated);

    const legacy = {
      id: 'legacy',
      name: 'Legacy',
      layout: { rows: 1, cols: 2 },
      initialPageId: 'old-main',
      pages: [
        {
          id: 'old-main',
          buttons: [
            {
              id: 'b',
              key: 0,
              states: [
                {
                  id: 'default',
                  visual: {},
                  actions: {
                    up: [
                      { type: 'open', params: { target: 'https://example.com' } },
                      { type: 'increment-variable', params: { name: 'n' } },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    };
    await writeFile(join(isolated, 'legacy.json'), JSON.stringify(legacy), 'utf8');

    const loaded = await store.load('legacy');

    assert.equal(loaded.formatVersion, PROFILE_FORMAT_VERSION);
    assert.equal(loaded.root.pages[0]!.id, 'old-main');
    assert.equal(loaded.root.pages[0]!.buttons[0]!.id, 'b');
    assert.equal(loaded.initialPageId, 'old-main');

    // Renaming the actions matters as much as reshaping the tree: a profile
    // that loads but fails on the first press is worse than one that refuses.
    assert.deepEqual(
      loaded.root.pages[0]!.buttons[0]!.states[0]!.actions?.press?.map((action) => action.type),
      ['system.open', 'easydeck.increment-variable'],
    );
    assert.equal(
      loaded.root.pages[0]!.buttons[0]!.states[0]!.actions?.press?.[0]!.params?.['target'],
      'https://example.com',
    );

    await rm(isolated, { recursive: true, force: true });
  });

  it('merges version 3 press and release bindings into one gesture', async () => {
    // Version 4 binds gestures rather than the raw press and release. Both old
    // triggers become `press`, in the order the device would have run them —
    // dropping either would silently disarm half of somebody's button.
    const isolated = await mkdtemp(join(tmpdir(), 'easydeck-v3-'));
    const store = new FileProfileRepository(isolated);

    const legacy = {
      formatVersion: 3,
      id: 'v3',
      name: 'V3',
      layout: { rows: 1, cols: 1 },
      root: {
        id: 'root',
        name: 'Root',
        pages: [
          {
            id: 'main',
            buttons: [
              {
                id: 'b',
                key: 0,
                states: [
                  {
                    id: 'default',
                    visual: {},
                    actions: {
                      down: [{ type: 'easydeck.set-variable', params: { name: 'talking', value: true } }],
                      up: [{ type: 'easydeck.set-variable', params: { name: 'talking', value: false } }],
                      longPress: [{ type: 'easydeck.go-home' }],
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    };
    await writeFile(join(isolated, 'v3.json'), JSON.stringify(legacy), 'utf8');

    const loaded = await store.load('v3');
    const actions = loaded.root.pages[0]!.buttons[0]!.states[0]!.actions;

    assert.equal(loaded.formatVersion, PROFILE_FORMAT_VERSION);
    assert.deepEqual(
      actions?.press?.map((action) => action.params?.['value']),
      [true, false],
      'the old down actions must still run before the old up ones',
    );
    assert.deepEqual(actions?.longPress?.map((action) => action.type), ['easydeck.go-home']);

    await rm(isolated, { recursive: true, force: true });
  });

  /**
   * Version 2 stored variables as bare values. Their types have to be guessed
   * on the way up, and guessing wrong would change how every button bound to
   * one of them picks its state.
   */
  it('migrates version 2 variables into declarations, inferring their types', async () => {
    const isolated = await mkdtemp(join(tmpdir(), 'easydeck-vars-'));
    const store = new FileProfileRepository(isolated);

    const legacy = {
      formatVersion: 2,
      id: 'legacy2',
      name: 'Legacy 2',
      layout: { rows: 1, cols: 2 },
      variables: { clicks: 7, muted: true, scene: 'intro' },
      root: { id: 'root', name: 'Root', pages: [{ id: 'main', buttons: [] }] },
    };
    await writeFile(join(isolated, 'legacy2.json'), JSON.stringify(legacy), 'utf8');

    const loaded = await store.load('legacy2');

    assert.equal(loaded.formatVersion, PROFILE_FORMAT_VERSION);
    assert.deepEqual(
      [...(loaded.variables ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
      [
        { name: 'clicks', type: 'number', initial: 7 },
        { name: 'muted', type: 'boolean', initial: true },
        { name: 'scene', type: 'string', initial: 'intro' },
      ],
    );

    await rm(isolated, { recursive: true, force: true });
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
    const broken = {
      ...profile('broken'),
      root: { id: 'broken-root', name: 'Root', pages: [] },
    } as ProfileDefinition;
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

  it('keeps per-deck bindings, and drops entries that make no sense', async () => {
    // The settings file is meant to be edited by hand, so a half-written entry
    // is an ordinary occurrence: keep what can be understood rather than
    // refusing to start.
    const file = join(directory, 'decks.json');
    await writeFile(
      file,
      JSON.stringify({
        brightness: 40,
        decks: {
          'd6-port-abc': { profileId: 'streaming', name: 'Слева' },
          'd6-port-def': { profileId: 'gaming' },
          broken: 'not an object',
        },
      }),
      'utf8',
    );

    const settings = await new FileSettingsRepository(file).load();

    assert.equal(settings.decks?.['d6-port-abc']?.profileId, 'streaming');
    assert.equal(settings.decks?.['d6-port-abc']?.name, 'Слева');
    assert.equal(settings.decks?.['d6-port-def']?.profileId, 'gaming');
    assert.equal(settings.decks?.['broken'], undefined);
  });

  it('a deck binding survives a save', async () => {
    const file = join(directory, 'roundtrip.json');
    const repository = new FileSettingsRepository(file);

    await repository.save({ brightness: 50, decks: { panel: { profileId: 'streaming' } } });

    assert.equal((await repository.load()).decks?.['panel']?.profileId, 'streaming');
  });
});
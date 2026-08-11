import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { PROFILE_FORMAT_VERSION } from '@easydeck/engine';
import type { ProfileDefinition } from '@easydeck/engine';

import { FileProfileRepository, assertSafeProfileId } from './file-profile-repository.js';
import { FileSettingsRepository } from './file-settings-repository.js';

/** `name` defaults to the id, so most tests file under the id they name. */
function profile(id: string, name = id): ProfileDefinition {
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

/** Whether a path is there, as a question rather than an exception. */
async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
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

  it('files a profile under a transliteration of its name', async () => {
    // The folder is the identity, so what it is called has to be derivable
    // from what the profile is called — and readable by whoever opens it.
    const id = await repository.save(profile('main', 'Основной'));
    assert.equal(id, 'osnovnoy');

    assert.equal(await repository.has('osnovnoy'), true);
    const loaded = await repository.load(id);
    assert.equal(loaded.name, 'Основной');
    assert.equal(loaded.id, 'osnovnoy', 'the id comes from where it is, not from the file');
    assert.equal(loaded.root.pages[0]!.buttons[0]!.id, 'b');
  });

  it('keeps no id inside the document', async () => {
    // Two places holding the same fact is one place too many: a copied folder
    // would otherwise answer to whatever the original was called.
    const isolated = await mkdtemp(join(tmpdir(), 'easydeck-id-'));
    const store = new FileProfileRepository(isolated);

    await store.save(profile('anything', 'Stream'));

    const document = JSON.parse(await readFile(join(isolated, 'stream', 'profile.json'), 'utf8'));
    assert.equal('id' in document, false);
    assert.equal(document.name, 'Stream');

    await rm(isolated, { recursive: true, force: true });
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
      ['system.open', 'vars.increment-variable'],
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

  it('stores pictures beside the document rather than inside it', async () => {
    const isolated = await mkdtemp(join(tmpdir(), 'easydeck-assets-'));
    const store = new FileProfileRepository(isolated);

    const png = 'data:image/png;base64,iVBORw0KGgo=';
    await store.save({
      formatVersion: PROFILE_FORMAT_VERSION,
      id: 'shiny',
      name: 'Shiny',
      layout: { rows: 1, cols: 2 },
      root: {
        id: 'root',
        name: 'Root',
        pages: [
          {
            id: 'main',
            buttons: [
              // The same picture twice: one file, because a file is named
              // after what is in it.
              { id: 'a', key: 0, states: [{ id: 'default', visual: { icon: { source: png } } }] },
              { id: 'b', key: 1, states: [{ id: 'default', visual: { icon: { source: png } } }] },
            ],
          },
        ],
      },
    });

    const document = await readFile(join(isolated, 'shiny', 'profile.json'), 'utf8');
    assert.doesNotMatch(document, /base64/, 'no picture may remain in the document');
    assert.match(document, /asset:/);

    const assets = await readdir(join(isolated, 'shiny', 'assets'));
    assert.equal(assets.length, 1, 'one picture, however many keys use it');

    // And it comes back as the profile everything downstream expects.
    const loaded = await store.load('shiny');
    assert.equal(loaded.root.pages[0]!.buttons[0]!.states[0]!.visual.icon?.source, png);
    assert.equal(loaded.root.pages[0]!.buttons[1]!.states[0]!.visual.icon?.source, png);

    await rm(isolated, { recursive: true, force: true });
  });

  it('sweeps away a picture nothing points at any more', async () => {
    // Otherwise every icon ever chosen stays in the folder for ever, which is
    // how a program stops being trusted with somebody's files.
    const isolated = await mkdtemp(join(tmpdir(), 'easydeck-sweep-'));
    const store = new FileProfileRepository(isolated);

    const withIcon = (source: string): ProfileDefinition => ({
      formatVersion: PROFILE_FORMAT_VERSION,
      id: 'sweep',
      name: 'Sweep',
      layout: { rows: 1, cols: 1 },
      root: {
        id: 'root',
        name: 'Root',
        pages: [
          {
            id: 'main',
            buttons: [{ id: 'a', key: 0, states: [{ id: 'default', visual: { icon: { source } } }] }],
          },
        ],
      },
    });

    await store.save(withIcon('data:image/png;base64,iVBORw0KGgo='));
    await store.save(withIcon('data:image/png;base64,iVBORw0KGgoBBB=='));

    const assets = await readdir(join(isolated, 'sweep', 'assets'));
    assert.equal(assets.length, 1, 'the replaced picture is gone');

    await rm(isolated, { recursive: true, force: true });
  });

  it('reads a profile still stored as a single file, and folds it on save', async () => {
    // Nobody has to do anything about the old shape, and nobody loses a
    // profile by upgrading.
    const isolated = await mkdtemp(join(tmpdir(), 'easydeck-fold-'));
    const store = new FileProfileRepository(isolated);

    await writeFile(
      join(isolated, 'old.json'),
      JSON.stringify({
        formatVersion: PROFILE_FORMAT_VERSION,
        id: 'old',
        name: 'Old',
        layout: { rows: 1, cols: 1 },
        root: { id: 'root', name: 'Root', pages: [{ id: 'main', buttons: [] }] },
      }),
      'utf8',
    );

    const loaded = await store.load('old');
    assert.equal(loaded.name, 'Old');
    assert.deepEqual((await store.list()).map((each) => each.id), ['old']);

    assert.equal(await store.save(loaded), 'old');

    assert.equal(await exists(join(isolated, 'old', 'profile.json')), true);
    assert.equal(await exists(join(isolated, 'old.json')), false, 'the file goes once the folder is there');
  });

  it('files a copied file under its name rather than the name it was copied to', async () => {
    // Copying `starter.json` to `444.json` used to leave a profile called
    // Starter, filed as 444, still saying `"id": "starter"` inside. Whichever
    // of the three you believed, one of the others was wrong.
    const isolated = await mkdtemp(join(tmpdir(), 'easydeck-copy-'));
    const store = new FileProfileRepository(isolated);

    await store.save(profile('s', 'Starter'));
    await writeFile(
      join(isolated, '444.json'),
      JSON.stringify({ ...profile('copy', 'Starter'), id: 'starter' }),
      'utf8',
    );

    const copy = await store.load('444');
    assert.equal(copy.id, '444', 'where it is, not what it says');

    // And saving it settles the disagreement: its name is taken, so it takes
    // the next one along rather than the original's folder.
    assert.equal(await store.save(copy), 'starter-2');
    assert.equal(await exists(join(isolated, '444.json')), false);
    assert.equal((await store.load('starter')).root.pages[0]!.id, 's-main', 'the original stands');

    await rm(isolated, { recursive: true, force: true });
  });

  it('renames the actions that changed plugin in version 5', async () => {
    // A plugin owns every type starting with its id, so an action left under
    // its old name would load and then be refused on the first press.
    const isolated = await mkdtemp(join(tmpdir(), 'easydeck-v4-'));
    const store = new FileProfileRepository(isolated);

    const legacy = {
      formatVersion: 4,
      id: 'v4',
      name: 'V4',
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
                      press: [
                        { type: 'easydeck.toggle-variable', params: { name: 'mic' } },
                        { type: 'keyboard.hotkey', params: { keys: 'ctrl+m' } },
                        { type: 'easydeck.delay', params: { ms: 100 } },
                        { type: 'easydeck.go-home' },
                      ],
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    };
    await writeFile(join(isolated, 'v4.json'), JSON.stringify(legacy), 'utf8');

    const loaded = await store.load('v4');
    const actions = loaded.root.pages[0]!.buttons[0]!.states[0]!.actions;

    assert.equal(loaded.formatVersion, PROFILE_FORMAT_VERSION);
    assert.deepEqual(
      actions?.press?.map((action) => action.type),
      // Navigation never moved, so its name is left alone. Waiting moved
      // twice: into the system plugin at version 5, and out of the plugins
      // altogether at version 6, where it became part of a script.
      ['vars.toggle-variable', 'system.hotkey', 'core.delay', 'easydeck.go-home'],
    );
    assert.equal(actions?.press?.[1]!.params?.['keys'], 'ctrl+m');

    await rm(isolated, { recursive: true, force: true });
  });

  it('marks every state that had a script of its own before version 6', async () => {
    /*
     * Version 6 gives a button one script, held by its first state, which the
     * others follow. Every state used to carry its own — so each one that has
     * actions is marked explicitly, or somebody's two-state button would
     * quietly start doing the first state's thing in both.
     */
    const isolated = await mkdtemp(join(tmpdir(), 'easydeck-v5-'));
    const store = new FileProfileRepository(isolated);

    const legacy = {
      formatVersion: 5,
      name: 'V5',
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
                  { id: 'off', visual: {}, actions: { press: [{ type: 'easydeck.go-home' }] } },
                  { id: 'on', visual: {}, actions: { press: [{ type: 'system.delay', params: { ms: 10 } }] } },
                  { id: 'plain', visual: {} },
                ],
              },
            ],
          },
        ],
      },
    };
    await writeFile(join(isolated, 'v5.json'), JSON.stringify(legacy), 'utf8');

    const states = (await store.load('v5')).root.pages[0]!.buttons[0]!.states;

    assert.equal(states[0]?.ownActions, undefined, 'the first state is the script others follow');
    assert.equal(states[1]?.ownActions, true, 'this one really did act differently');
    assert.equal(states[2]?.ownActions, undefined, 'and this one never had a script at all');

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
      ['alpha', 'osnovnoy', 'zulu'],
    );
  });

  it('follows a rename, taking the pictures with it', async () => {
    // Moved rather than rewritten: the pictures are the bulk of a profile, and
    // copying six megabytes to change a word would be felt.
    const isolated = await mkdtemp(join(tmpdir(), 'easydeck-rename-'));
    const store = new FileProfileRepository(isolated);

    const png = 'data:image/png;base64,iVBORw0KGgo=';
    const withIcon = (name: string): ProfileDefinition => ({
      ...profile('ignored', name),
      root: {
        id: 'root',
        name: 'Root',
        pages: [
          {
            id: 'main',
            buttons: [{ id: 'a', key: 0, states: [{ id: 'default', visual: { icon: { source: png } } }] }],
          },
        ],
      },
    });

    const first = await store.save(withIcon('Стрим'));
    assert.equal(first, 'strim');

    const second = await store.save({ ...withIcon('Игры'), id: first });
    assert.equal(second, 'igry');

    assert.equal(await exists(join(isolated, 'strim')), false, 'nothing left behind');
    assert.equal((await readdir(join(isolated, 'igry', 'assets'))).length, 1);
    assert.equal(
      (await store.load('igry')).root.pages[0]!.buttons[0]!.states[0]!.visual.icon?.source,
      png,
    );

    await rm(isolated, { recursive: true, force: true });
  });

  it('numbers a name somebody else already has, and leaves them alone', async () => {
    // The one thing that must never happen here: a profile renamed to match
    // another must not land on top of it.
    const isolated = await mkdtemp(join(tmpdir(), 'easydeck-clash-'));
    const store = new FileProfileRepository(isolated);

    const mine = await store.save(profile('a', 'Stream'));
    const theirs = await store.save({ ...profile('b', 'Games'), id: '' });

    const renamed = await store.save({ ...profile('b', 'Stream'), id: theirs });

    assert.equal(mine, 'stream');
    assert.equal(renamed, 'stream-2');
    assert.equal((await store.load('stream')).root.pages[0]!.id, 'a-main', 'the first is untouched');
    assert.equal((await store.load('stream-2')).root.pages[0]!.id, 'b-main');

    await rm(isolated, { recursive: true, force: true });
  });

  it('stays put when the name has not changed', async () => {
    // Otherwise a profile saved on every keystroke would walk down the
    // numbers, leaving a folder behind for each one.
    const isolated = await mkdtemp(join(tmpdir(), 'easydeck-stable-'));
    const store = new FileProfileRepository(isolated);

    const id = await store.save(profile('x', 'Stream'));
    assert.equal(await store.save({ ...profile('x', 'Stream'), id }), 'stream');
    assert.equal(await store.save({ ...profile('x', 'Stream'), id }), 'stream');
    assert.deepEqual(await readdir(isolated), ['stream']);

    await rm(isolated, { recursive: true, force: true });
  });

  it('moves back to the plain name once it is free', async () => {
    const isolated = await mkdtemp(join(tmpdir(), 'easydeck-freed-'));
    const store = new FileProfileRepository(isolated);

    const first = await store.save(profile('a', 'Stream'));
    const second = await store.save({ ...profile('b', 'Stream'), id: '' });
    assert.equal(second, 'stream-2');

    await store.remove(first);
    assert.equal(await store.save({ ...profile('b', 'Stream'), id: second }), 'stream');

    await rm(isolated, { recursive: true, force: true });
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
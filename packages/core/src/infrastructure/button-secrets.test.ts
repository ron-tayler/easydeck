import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { ButtonSecretStore, isSecretReference, referencedSecrets } from './button-secrets.js';
import { exportProfile } from './profile-archive.js';
import { ZipArchive } from './zip.js';
import type { ProfileDefinition } from '@easydeck/engine';

async function scratch(name: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `easydeck-${name}-`));
}

/** A profile whose button types a password through a reference. */
function profileWith(reference: string): ProfileDefinition {
  return {
    formatVersion: 5,
    id: 'secrets',
    name: 'Secrets',
    layout: { rows: 1, cols: 1 },
    root: {
      id: 'root',
      name: 'Root',
      pages: [
        {
          id: 'main',
          buttons: [
            {
              id: 'a',
              key: 0,
              states: [
                {
                  id: 'default',
                  visual: {},
                  actions: { press: [{ type: 'system.type-password', params: { secret: reference } }] },
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

describe('a password a button types', () => {
  it('is stored under a reference and read back by it', async () => {
    const directory = await scratch('secret');
    const store = new ButtonSecretStore(undefined, directory);

    const reference = await store.save('hunter2');

    assert.ok(isSecretReference(reference), `${reference} should look like a reference`);
    assert.equal(await store.read(reference), 'hunter2');
    assert.deepEqual(await store.filled(), [reference]);

    await rm(directory, { recursive: true, force: true });
  });

  it('keeps the reference when the password is changed', async () => {
    // Otherwise changing a password would be a change to the profile, and a
    // button would be rewritten for an edit that says nothing about it.
    const directory = await scratch('rekey');
    const store = new ButtonSecretStore(undefined, directory);

    const first = await store.save('one');
    const second = await store.save('two', first.slice('secret:'.length));

    assert.equal(second, first);
    assert.equal(await store.read(first), 'two');

    await rm(directory, { recursive: true, force: true });
  });

  it('answers with nothing for a reference it does not hold', async () => {
    const directory = await scratch('absent');
    const store = new ButtonSecretStore(undefined, directory);

    assert.equal(await store.read('secret:0123456789abcdef'), undefined);
    await assert.doesNotReject(store.clear('secret:0123456789abcdef'));

    await rm(directory, { recursive: true, force: true });
  });

  it('warns in the file when there is no platform key store', async () => {
    // Whoever finds this file deserves to know what it holds before they put
    // it in a backup or a screenshot.
    const directory = await scratch('warned');
    const store = new ButtonSecretStore(undefined, directory);

    await store.save('hunter2');
    const written = await readFile(join(directory, 'buttons.json'), 'utf8');

    assert.match(written, /do not share/i);

    await rm(directory, { recursive: true, force: true });
  });
});

describe('keeping the store to what is still used', () => {
  it('finds the references a stored profile holds, folder or file', async () => {
    const profiles = await scratch('referenced');

    await mkdir(join(profiles, 'one'), { recursive: true });
    await writeFile(
      join(profiles, 'one', 'profile.json'),
      JSON.stringify(profileWith('secret:1111111111111111')),
      'utf8',
    );
    await writeFile(
      join(profiles, 'legacy.json'),
      JSON.stringify(profileWith('secret:2222222222222222')),
      'utf8',
    );

    const { ids, complete } = await referencedSecrets(profiles);

    assert.deepEqual([...ids].sort(), ['1111111111111111', '2222222222222222']);
    assert.equal(complete, true);

    await rm(profiles, { recursive: true, force: true });
  });

  it('forgets a password no profile refers to any more', async () => {
    const directory = await scratch('sweep');
    const profiles = await scratch('sweep-profiles');
    const store = new ButtonSecretStore(undefined, directory);

    const kept = await store.save('still used');
    const dropped = await store.save('button deleted');

    await mkdir(join(profiles, 'one'), { recursive: true });
    await writeFile(join(profiles, 'one', 'profile.json'), JSON.stringify(profileWith(kept)), 'utf8');

    assert.equal(await store.sweep(profiles), 1);
    assert.equal(await store.read(kept), 'still used');
    assert.equal(await store.read(dropped), undefined);

    await rm(directory, { recursive: true, force: true });
    await rm(profiles, { recursive: true, force: true });
  });

  it('sweeps nothing when a profile could not be read', async () => {
    // A locked or half-written file is not evidence that its passwords are
    // unused, and a password deleted for that reason is gone for good.
    const directory = await scratch('cautious');
    const profiles = await scratch('cautious-profiles');
    const store = new ButtonSecretStore(undefined, directory);

    const reference = await store.save('hunter2');
    await mkdir(join(profiles, 'broken'), { recursive: true });

    assert.equal(await store.sweep(profiles), 0);
    assert.equal(await store.read(reference), 'hunter2');

    await rm(directory, { recursive: true, force: true });
    await rm(profiles, { recursive: true, force: true });
  });
});

describe('what an export carries', () => {
  it('carries the reference and no password, because it never had one', async () => {
    /*
     * The point of the whole arrangement: an archive is somebody's profile
     * arriving on another machine, and a password inside it would be a
     * password nobody meant to send. There is nothing to strip — the document
     * only ever held `secret:…`.
     */
    const directory = await scratch('export');
    const store = new ButtonSecretStore(undefined, directory);
    const reference = await store.save('hunter2');

    const archive = new ZipArchive(Buffer.from(exportProfile(profileWith(reference))));
    const manifest = archive.read('profile.json')!.toString('utf8');

    assert.match(manifest, /secret:[0-9a-f]{16}/);
    assert.doesNotMatch(manifest, /hunter2/);

    await rm(directory, { recursive: true, force: true });
  });
});

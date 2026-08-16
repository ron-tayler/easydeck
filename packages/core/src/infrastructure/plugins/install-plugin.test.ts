import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { PLUGIN_API_VERSION } from '@easydeck/engine';

import { writeZip } from '../zip-writer.js';
import { choosePluginSource } from './choose-plugin-source.js';
import {
  DEFAULT_PLUGIN_SOURCE,
  FolderPluginSource,
  pluginSourceCandidates,
} from './folder-plugin-source.js';
import { GitHubPluginSource } from './github-plugin-source.js';
import { installPluginArchive, looksLikePlugin, uninstallPlugin } from './install-plugin.js';

const roots: string[] = [];

after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true }).catch(() => undefined);
});

async function scratch(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'easydeck-store-'));
  roots.push(root);
  return root;
}

/** An archive shaped exactly as the build script makes one. */
function pluginArchive(
  overrides: Record<string, unknown> = {},
  extra: readonly { name: string; bytes: Uint8Array }[] = [],
): Uint8Array {
  const manifest = {
    id: 'ed.demo',
    main: 'main.mjs',
    name: { en: 'Demo' },
    version: '1.2.3',
    apiVersion: PLUGIN_API_VERSION,
    actions: [],
    ...overrides,
  };

  return writeZip([
    { name: 'plugin.json', bytes: Buffer.from(JSON.stringify(manifest), 'utf8') },
    { name: 'main.mjs', bytes: Buffer.from('export default {};', 'utf8') },
    { name: 'icons/key.svg', bytes: Buffer.from('<svg/>', 'utf8') },
    ...extra,
  ]);
}

describe('installing a plugin from an archive', () => {
  it('unpacks it under its own id, folders and all', async () => {
    const directory = await scratch();
    const installed = await installPluginArchive(pluginArchive(), { directory });

    assert.equal(installed.id, 'ed.demo');
    assert.equal(installed.version, '1.2.3');
    assert.equal(installed.replaced, false);

    // The archive's paths are relative to the plugin's folder, so unpacking
    // it *is* creating plugins/<id>/ — nothing rewrites anything.
    assert.equal(await readFile(join(directory, 'ed.demo', 'main.mjs'), 'utf8'), 'export default {};');
    assert.equal(await readFile(join(directory, 'ed.demo', 'icons', 'key.svg'), 'utf8'), '<svg/>');
  });

  it('tells a plugin from a profile by what is inside, not by the name', () => {
    // Both are `.easydeck`; a profile has no plugin.json.
    assert.equal(looksLikePlugin(pluginArchive()), true);
    assert.equal(
      looksLikePlugin(writeZip([{ name: 'profile.json', bytes: Buffer.from('{}', 'utf8') }])),
      false,
    );
    assert.equal(looksLikePlugin(Buffer.from('not a zip at all', 'utf8')), false);
  });

  it('refuses a download that is not what the registry described', async () => {
    const directory = await scratch();
    const bytes = pluginArchive();
    const wrong = createHash('sha256').update('something else').digest('hex');

    await assert.rejects(
      () => installPluginArchive(bytes, { directory, sha256: wrong }),
      /does not match/,
    );

    // And the right hash goes through, so the check is a check and not a wall.
    const right = createHash('sha256').update(bytes).digest('hex');
    await installPluginArchive(bytes, { directory, sha256: right });
  });

  it('refuses to replace what is already there unless told to', async () => {
    const directory = await scratch();
    await installPluginArchive(pluginArchive(), { directory });

    // Two plugins with one id is the case the store must ask about: one
    // plugin updated and two authors' plugins colliding look identical here.
    await assert.rejects(() => installPluginArchive(pluginArchive(), { directory }), /already/);

    const again = await installPluginArchive(pluginArchive({ version: '2.0.0' }), {
      directory,
      replace: true,
    });
    assert.equal(again.replaced, true);
    assert.equal(again.version, '2.0.0');
  });

  it('never writes outside the plugin folder', async () => {
    const directory = await scratch();

    // An id that is a path, and an entry name that climbs: the two ways an
    // archive could ask to be written somewhere it was not invited.
    await assert.rejects(
      () => installPluginArchive(pluginArchive({ id: '../escaped' }), { directory }),
      /usable id/,
    );

    await assert.rejects(
      () =>
        installPluginArchive(
          pluginArchive({}, [
            { name: '../../stolen.txt', bytes: Buffer.from('x', 'utf8') },
          ]),
          { directory },
        ),
      /outside/,
    );
  });

  it('refuses a plugin built against another contract', async () => {
    const directory = await scratch();

    await assert.rejects(
      () => installPluginArchive(pluginArchive({ apiVersion: 99 }), { directory }),
      /plugin API 99/,
    );
  });

  it('leaves settings alone when a plugin is removed', async () => {
    const directory = await scratch();
    await installPluginArchive(pluginArchive(), { directory });

    await uninstallPlugin('ed.demo', directory);
    await assert.rejects(() => readFile(join(directory, 'ed.demo', 'main.mjs')));
  });
});

describe('the plugins repository as a folder', () => {
  /** A source laid out the way the build script lays one out. */
  async function source(): Promise<{ root: string; sha256: string }> {
    const root = await scratch();
    const bytes = pluginArchive();

    await mkdir(join(root, 'build'), { recursive: true });
    await mkdir(join(root, 'registry'), { recursive: true });
    await writeFile(join(root, 'build', 'ed.demo.easydeck'), bytes);

    const sha256 = createHash('sha256').update(bytes).digest('hex');
    await writeFile(
      join(root, 'registry', 'index.json'),
      JSON.stringify({
        plugins: [
          {
            id: 'ed.demo',
            author: 'ed',
            version: '1.2.3',
            apiVersion: PLUGIN_API_VERSION,
            file: 'ed.demo.easydeck',
            sha256,
            bytes: bytes.byteLength,
            manifest: { name: { en: 'Demo' }, version: '1.2.3', cover: 'plugin:ed.demo/icons/key.svg' },
          },
        ],
      }),
      'utf8',
    );

    return { root, sha256 };
  }

  it('lists what the index holds and hands over the archive named there', async () => {
    const { root, sha256 } = await source();
    const listings = await new FolderPluginSource(root).list();

    assert.equal(listings.length, 1);
    assert.equal(listings[0]?.id, 'ed.demo');
    assert.equal(listings[0]?.sha256, sha256);

    const bytes = await new FolderPluginSource(root).download('ed.demo');
    assert.ok(bytes && looksLikePlugin(bytes));
  });

  it('reads a picture out of the archive, not from beside it', async () => {
    // Which is what keeps this interchangeable with a source that has only a
    // zip and a URL.
    const { root } = await source();
    const image = await new FolderPluginSource(root).image('ed.demo', 'plugin:ed.demo/icons/key.svg');

    assert.equal(image?.type, 'image/svg+xml');
    assert.equal(Buffer.from(image!.bytes).toString('utf8'), '<svg/>');
  });

  it('is an empty store rather than an error when there is nothing there', async () => {
    const source = new FolderPluginSource(join(await scratch(), 'nowhere'));

    assert.deepEqual(await source.list(), []);
    assert.equal(await source.download('ed.demo'), undefined);
    assert.equal(await source.image('ed.demo', 'plugin:ed.demo/x.png'), undefined);
  });

  it('never reads a file the index pointed outside the source at', async () => {
    const { root } = await source();
    await writeFile(
      join(root, 'registry', 'index.json'),
      JSON.stringify({
        plugins: [
          {
            id: 'ed.evil',
            version: '1',
            apiVersion: PLUGIN_API_VERSION,
            sha256: 'x',
            file: '../../../secrets.txt',
            manifest: { name: { en: 'Evil' } },
          },
        ],
      }),
      'utf8',
    );

    assert.equal(await new FolderPluginSource(root).download('ed.evil'), undefined);
  });
});

describe('which shelf a build reads from', () => {
  /** A built plugins repository: an index where one is expected. */
  async function repository(): Promise<string> {
    const root = await scratch();
    await mkdir(join(root, 'registry'), { recursive: true });
    await writeFile(join(root, 'registry', 'index.json'), '{"plugins":[]}', 'utf8');
    return root;
  }

  const named = process.env['EASYDECK_PLUGIN_SOURCE'];

  after(() => {
    if (named === undefined) delete process.env['EASYDECK_PLUGIN_SOURCE'];
    else process.env['EASYDECK_PLUGIN_SOURCE'] = named;
  });

  it('finds a checkout however deep the program was started', async () => {
    // Regression: the rule was "one level above the working directory", and
    // the app starts itself from packages/app — so the store looked in
    // packages/, found nothing, and said the shelf was empty.
    const root = await repository();
    const deep = join(root, '..', 'somewhere', 'deeper', 'still');

    const candidates = pluginSourceCandidates(deep);
    assert.ok(candidates.some((path) => path === join(root, '..', DEFAULT_PLUGIN_SOURCE)));
  });

  it('takes the named folder over anything it might find', async () => {
    const root = await repository();
    process.env['EASYDECK_PLUGIN_SOURCE'] = root;

    assert.deepEqual(pluginSourceCandidates(), [root]);
    assert.equal((await choosePluginSource()).name, 'local');
  });

  it('goes to GitHub when asked, and when there is no checkout to read', async () => {
    process.env['EASYDECK_PLUGIN_SOURCE'] = 'github';
    assert.equal((await choosePluginSource()).name, 'github');

    // An unbuilt clone is not a source: it has the sources and no index, and
    // reading from it would be an empty store with no explanation.
    process.env['EASYDECK_PLUGIN_SOURCE'] = join(await scratch(), 'never-built');
    assert.equal((await choosePluginSource()).name, 'local');
  });
});

describe('the published store', () => {
  /** Answers for what a release holds, and records what was asked for. */
  function releaseWith(files: Record<string, Uint8Array>, asked: string[] = []) {
    return {
      asked,
      fetcher: (async (input: string | URL | Request) => {
        const url = String(input);
        asked.push(url);
        const name = decodeURIComponent(url.slice(url.lastIndexOf('/') + 1));
        const bytes = files[name];

        return bytes
          ? new Response(Buffer.from(bytes), { status: 200 })
          : new Response('Not Found', { status: 404 });
      }) as typeof fetch,
    };
  }

  it('reads the index and the archives from the latest release', async () => {
    const archive = pluginArchive();
    const { fetcher, asked } = releaseWith({
      'index.json': Buffer.from(
        JSON.stringify({
          plugins: [
            {
              id: 'ed.demo',
              author: 'ed',
              version: '1.2.3',
              apiVersion: PLUGIN_API_VERSION,
              file: 'ed.demo.easydeck',
              sha256: 'x',
              bytes: archive.byteLength,
              manifest: { name: { en: 'Demo' } },
            },
          ],
        }),
        'utf8',
      ),
      'ed.demo.easydeck': archive,
    });

    const source = new GitHubPluginSource({ owner: 'o', repo: 'r', fetcher });
    const listings = await source.list();

    assert.equal(listings[0]?.id, 'ed.demo');
    assert.ok(await source.download('ed.demo'));
    // "latest/download" is what makes publishing the whole of deployment:
    // the address does not change when a release does.
    assert.ok(asked[0]?.includes('/releases/latest/download/index.json'));
  });

  it('is an empty shelf before the first release, not an error', async () => {
    const { fetcher } = releaseWith({});
    const source = new GitHubPluginSource({ owner: 'o', repo: 'r', fetcher });

    assert.deepEqual(await source.list(), []);
    assert.equal(await source.download('ed.demo'), undefined);
  });

  it('refuses a file name that would address something else', async () => {
    const asked: string[] = [];
    const { fetcher } = releaseWith({}, asked);
    const source = new GitHubPluginSource({ owner: 'o', repo: 'r', fetcher });

    // The index is published by this same repository, but its names are still
    // names from a file: one with a slash addresses another release entirely.
    await source.image('../../../other', 'plugin:x/y.png');
    assert.ok(!asked.some((url) => url.includes('..')));
  });
});

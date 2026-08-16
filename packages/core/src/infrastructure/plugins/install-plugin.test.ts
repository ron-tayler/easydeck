import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { PLUGIN_API_VERSION } from '@easydeck/engine';

import { writeZip } from '../zip-writer.js';
import type { ZipFile } from '../zip-writer.js';
import { STORE_FILE } from './archive-plugin-source.js';
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

/**
 * The shop window the build script packs: an index, a manifest, a cover.
 *
 * Written here rather than borrowed so the test knows the format rather than
 * agreeing with whatever the builder happens to do.
 */
function storeWindow(
  sha256: string,
  bytes: number,
  extra: readonly ZipFile[] = [],
  version = '1.2.3',
): Uint8Array {
  return writeZip([
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
              bytes,
              name: { en: 'Demo' },
              cover: 'plugin:ed.demo/assets/cover.svg',
            },
          ],
        }),
        'utf8',
      ),
    },
    {
      name: 'ed.demo.json',
      bytes: Buffer.from(
        JSON.stringify({
          name: { en: 'Demo' },
          version: '1.2.3',
          apiVersion: PLUGIN_API_VERSION,
          actions: [{ type: 'ed.demo.poke', label: { en: 'Poke' } }],
        }),
        'utf8',
      ),
    },
    // Filed under the plugin the reference names, so `plugin:ed.demo/…`
    // resolves by looking up `ed.demo/…`.
    { name: 'ed.demo/assets/cover.svg', bytes: Buffer.from('<svg>cover</svg>', 'utf8') },
    ...extra,
  ]);
}

/** A folder source that says which files it read. */
class WatchedSource extends FolderPluginSource {
  constructor(
    root: string,
    private readonly asked: string[],
  ) {
    super(root);
  }

  protected override async fetch(name: string): Promise<Uint8Array | undefined> {
    this.asked.push(name);
    return super.fetch(name);
  }
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
    const sha256 = createHash('sha256').update(bytes).digest('hex');

    await mkdir(join(root, 'build'), { recursive: true });
    await writeFile(join(root, 'build', 'ed.demo.easydeck'), bytes);
    await writeFile(join(root, 'build', STORE_FILE), storeWindow(sha256, bytes.byteLength));

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

  it('draws a whole list without fetching a single plugin', async () => {
    /*
     * Regression, and a measured one: covers used to be read out of each
     * plugin's own archive, so showing five names downloaded 317 KB of code.
     * They travel in the window now, and a list costs one file.
     */
    const { root } = await source();
    const asked: string[] = [];
    const watched = new WatchedSource(root, asked);

    await watched.list();
    const image = await watched.image('ed.demo', 'plugin:ed.demo/assets/cover.svg');

    assert.equal(image?.type, 'image/svg+xml');
    assert.equal(Buffer.from(image!.bytes).toString('utf8'), '<svg>cover</svg>');
    assert.deepEqual(asked, [STORE_FILE]);
  });

  it('goes to the plugin for a screenshot, which is not in the window', async () => {
    // The bargain: covers are small and every row wants one, screenshots are
    // large and only a card does — and whoever opened that card is usually
    // about to download the plugin anyway.
    const { root } = await source();
    const asked: string[] = [];
    const watched = new WatchedSource(root, asked);

    const shot = await watched.image('ed.demo', 'plugin:ed.demo/icons/key.svg');

    assert.equal(Buffer.from(shot!.bytes).toString('utf8'), '<svg/>');
    assert.deepEqual(asked, [STORE_FILE, 'ed.demo.easydeck']);
  });

  it('is an empty store rather than an error when there is nothing there', async () => {
    const source = new FolderPluginSource(join(await scratch(), 'nowhere'));

    assert.deepEqual(await source.list(), []);
    assert.equal(await source.download('ed.demo'), undefined);
    assert.equal(await source.image('ed.demo', 'plugin:ed.demo/x.png'), undefined);
  });

  it('never reads a file the index pointed outside the source at', async () => {
    const root = await scratch();
    await mkdir(join(root, 'build'), { recursive: true });
    await writeFile(
      join(root, 'build', STORE_FILE),
      writeZip([
        {
          name: 'index.json',
          bytes: Buffer.from(
            JSON.stringify({
              plugins: [
                {
                  id: 'ed.evil',
                  version: '1',
                  apiVersion: PLUGIN_API_VERSION,
                  sha256: 'x',
                  // A name from a file the build wrote is still a name, and a
                  // name is the thing that must never become a path upwards.
                  file: '../../../secrets.txt',
                  name: { en: 'Evil' },
                },
              ],
            }),
            'utf8',
          ),
        },
      ]),
    );

    assert.equal(await new FolderPluginSource(root).download('ed.evil'), undefined);
  });
});

describe('which shelf a build reads from', () => {
  /** A built plugins repository: an index where one is expected. */
  async function repository(): Promise<string> {
    const root = await scratch();
    await mkdir(join(root, 'build'), { recursive: true });
    await writeFile(join(root, 'build', STORE_FILE), storeWindow('x', 0));
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

  it('reads the window and the archives from the latest release', async () => {
    const archive = pluginArchive();
    const { fetcher, asked } = releaseWith({
      [STORE_FILE]: storeWindow('x', archive.byteLength),
      'ed.demo.easydeck': archive,
    });

    const source = new GitHubPluginSource({ owner: 'o', repo: 'r', fetcher });
    const listings = await source.list();

    assert.equal(listings[0]?.id, 'ed.demo');
    assert.ok(await source.download('ed.demo'));
    // "latest/download" is what makes publishing the whole of deployment:
    // the address does not change when a release does.
    assert.ok(asked[0]?.includes(`/releases/latest/download/${STORE_FILE}`));
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

describe('a card, fetched apart from the list', () => {
  /** A source with a manifest beside its index, as the build now leaves one. */
  async function withDetails(): Promise<{ root: string; reads: string[] }> {
    const root = await scratch();
    const reads: string[] = [];

    await mkdir(join(root, 'build'), { recursive: true });
    await writeFile(join(root, 'build', 'ed.demo.easydeck'), pluginArchive());
    await writeFile(join(root, 'build', STORE_FILE), storeWindow('x', 1));

    return { root, reads };
  }

  it('is not in the list, and is there when asked for', async () => {
    const { root } = await withDetails();
    const source = new FolderPluginSource(root);

    const listing = (await source.list())[0]!;
    // A row carries what it takes to decide whether to look closer. The
    // manifest was 97 to 99 per cent of an entry when it rode along.
    assert.equal(listing.name.en, 'Demo');
    assert.ok(!('manifest' in listing));

    const manifest = await source.details('ed.demo');
    assert.equal(manifest?.actions[0]?.type, 'ed.demo.poke');
  });

  it('is remembered until the store is told to look again', async () => {
    const { root } = await withDetails();
    const source = new FolderPluginSource(root);

    await source.details('ed.demo');
    // Somebody comparing plugins goes back and forth; the second look costs
    // nothing. Proven by removing the window underneath and asking again.
    await rm(join(root, 'build', STORE_FILE));
    assert.equal((await source.details('ed.demo'))?.actions[0]?.type, 'ed.demo.poke');

    // "Look again" is the one moment the answer could have changed.
    source.refresh();
    assert.equal(await source.details('ed.demo'), undefined);
  });
});

describe('looking again', () => {
  it('empties what the published store kept, not just the folder one', async () => {
    /*
     * Regression: the service asked for a fresh look through an `instanceof`
     * check against the folder source, so the GitHub one kept its window for
     * the life of the process and the button did nothing.
     */
    const first = storeWindow('x', 1);
    let served = first;

    const source = new GitHubPluginSource({
      owner: 'o',
      repo: 'r',
      fetcher: (async () => new Response(Buffer.from(served), { status: 200 })) as typeof fetch,
    });

    assert.equal((await source.list())[0]?.version, '1.2.3');

    // The shelf moves on. Without being told, a source is right to keep what
    // it had — it was told the store was open.
    served = storeWindow('x', 1, [], '2.0.0');
    assert.equal((await source.list())[0]?.version, '1.2.3');

    source.refresh();
    assert.equal((await source.list())[0]?.version, '2.0.0');
  });
});

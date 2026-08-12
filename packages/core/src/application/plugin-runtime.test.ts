import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { VariableStore } from '@easydeck/engine';
import type { PluginHost, PluginManifest, Ticker } from '@easydeck/engine';

import { PluginSettingsStore } from '../infrastructure/plugins/plugin-settings-store.js';
import { PluginRuntime } from './plugin-runtime.js';

const manifest: PluginManifest = {
  id: 'demo',
  name: { en: 'Demo' },
  version: '1.0.0',
  apiVersion: 1,
  actions: [],
  variables: [{ name: 'demo.scene', type: 'string' }],
  settings: [
    { name: 'port', type: 'number', label: { en: 'Port' }, default: 4455 },
    { name: 'password', type: 'string', label: { en: 'Password' }, secret: true },
  ],
  commands: [{ name: 'connect', label: { en: 'Connect' } }],
};

/** A temporary pair of folders and a runtime pointed at them. */
async function bench() {
  const dir = await mkdtemp(join(tmpdir(), 'easydeck-plugins-'));
  const settings = new PluginSettingsStore(undefined, join(dir, 'open'), join(dir, 'sealed'));
  const variables = new VariableStore();
  const runtime = new PluginRuntime({ settings, variables });

  return {
    dir,
    settings,
    variables,
    runtime,
    async dispose() {
      await runtime.stopAll();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

describe('PluginRuntime', () => {
  it('starts a plugin and publishes what it declared', async () => {
    const bed = await bench();
    let host: PluginHost | undefined;

    await bed.runtime.install(manifest, {
      start(given) {
        host = given;
        given.setStatus('ready');
        given.setVariable('demo.scene', 'Intro');
      },
    });

    assert.equal(bed.runtime.status('demo')?.status, 'ready');
    assert.equal(bed.variables.get('demo.scene'), 'Intro');
    assert.ok(host);

    await bed.dispose();
  });

  it('refuses a variable the manifest never declared', async () => {
    // Otherwise a plugin could write over the user's own variables, and
    // afterwards nobody could tell which of the two owned the name.
    const bed = await bench();

    await bed.runtime.install(manifest, {
      start(host) {
        assert.throws(() => host.setVariable('micOn', true), /without declaring it/);
      },
    });

    assert.equal(bed.variables.has('micOn'), false);
    await bed.dispose();
  });

  it('leaves a plugin that throws on the way up in error, and keeps running', async () => {
    const bed = await bench();
    bed.runtime.on('error', () => undefined);

    await bed.runtime.install(manifest, {
      start() {
        throw new Error('OBS is not listening on 4455');
      },
    });

    const state = bed.runtime.status('demo');
    assert.equal(state?.status, 'error');
    assert.match(state?.message?.en ?? '', /not listening/);

    await bed.dispose();
  });

  it('clears a plugin variable when the plugin stops', async () => {
    // A key showing the last scene of a plugin that is no longer running is
    // the deck stating something untrue.
    const bed = await bench();

    await bed.runtime.install(manifest, {
      start: (host) => host.setVariable('demo.scene', 'Intro'),
    });
    await bed.runtime.stopAll();

    assert.equal(bed.variables.has('demo.scene'), false);
    await bed.dispose();
  });

  it('tells the plugin when settings change, without restarting it', async () => {
    const bed = await bench();
    const seen: number[] = [];
    let starts = 0;

    await bed.runtime.install(manifest, {
      start(host) {
        starts += 1;
        host.onSettingsChanged((next) => seen.push(Number(next['port'])));
      },
    });

    await bed.runtime.configure('demo', { port: 4460 });

    assert.deepEqual(seen, [4460]);
    assert.equal(starts, 1, 'only the plugin knows whether a change is worth reconnecting for');

    await bed.dispose();
  });

  it('runs a declared command and refuses an undeclared one', async () => {
    const bed = await bench();
    let connected = 0;

    await bed.runtime.install(manifest, {});
    bed.runtime.registerCommands('demo', { connect: () => void (connected += 1) });

    await bed.runtime.runCommand('demo', 'connect');
    assert.equal(connected, 1);

    await assert.rejects(bed.runtime.runCommand('demo', 'authorize'), /no command/);
    await bed.dispose();
  });

  it('answers with an empty list when the plugin cannot supply options', async () => {
    // What the configurator falls back on, so an OBS button can be set up
    // while OBS is closed.
    const bed = await bench();

    await bed.runtime.install(manifest, {
      start(host) {
        host.provideOptions('scenes', () => Promise.reject(new Error('not connected')));
      },
    });

    assert.deepEqual(await bed.runtime.optionsFor('demo', 'scenes'), []);
    assert.deepEqual(await bed.runtime.optionsFor('demo', 'sources'), []);

    await bed.dispose();
  });

  it('refuses a route when no callback server is running', async () => {
    const bed = await bench();
    bed.runtime.on('error', () => undefined);

    await bed.runtime.install(manifest, {
      start(host) {
        host.route('/callback', () => ({ body: 'ok' }));
      },
    });

    assert.equal(bed.runtime.status('demo')?.status, 'error');
    await bed.dispose();
  });
});

describe('a picture a plugin draws', () => {
  const withSurface = { ...manifest, surfaces: [{ type: 'demo.graph', label: { en: 'Graph' } }] };

  /*
   * The bug this exists for: a plugin answered with the text of an SVG, which
   * is the natural thing to build, and everything below takes a *source* — a
   * path or a data URL. Handed raw markup the rasterizer went looking for a
   * file whose name began `<svg`, and the key said the picture could not be
   * read. The preview in the editor worked, because the window wrapped the
   * text itself, which is what made it look like a rendering problem.
   */
  it('turns the text of an SVG into something that can be read', async () => {
    const bed = await bench();
    await bed.runtime.install(withSurface, {
      start(host: PluginHost) {
        host.provideSurface('demo.graph', async () => ({ source: '<svg><rect/></svg>' }));
      },
    });

    const frame = await bed.runtime.drawSurface({
      type: 'demo.graph',
      params: {},
      cols: 1,
      rows: 1,
    });

    assert.ok(frame);
    assert.match(frame.source, /^data:image\/svg\+xml;base64,/);
    assert.equal(
      Buffer.from(frame.source.split(',')[1] ?? '', 'base64').toString('utf8'),
      '<svg><rect/></svg>',
    );

    await bed.dispose();
  });

  it('leaves a picture that already is a data URL alone', async () => {
    const bed = await bench();
    const already = 'data:image/png;base64,AAAA';

    await bed.runtime.install(withSurface, {
      start(host: PluginHost) {
        host.provideSurface('demo.graph', async () => ({ source: already }));
      },
    });

    const frame = await bed.runtime.drawSurface({ type: 'demo.graph', params: {}, cols: 1, rows: 1 });
    assert.equal(frame?.source, already);

    await bed.dispose();
  });

  it('answers nothing for a type no plugin claimed', async () => {
    const bed = await bench();
    await bed.runtime.install(withSurface, {});

    assert.equal(
      await bed.runtime.drawSurface({ type: 'nobody.graph', params: {}, cols: 1, rows: 1 }),
      undefined,
    );
    // Declared but never provided: the same answer, since a key can do nothing
    // useful with the difference.
    assert.equal(
      await bed.runtime.drawSurface({ type: 'demo.graph', params: {}, cols: 1, rows: 1 }),
      undefined,
    );

    await bed.dispose();
  });

  it('does not let a plugin that throws take the key down with it', async () => {
    const bed = await bench();
    await bed.runtime.install(withSurface, {
      start(host: PluginHost) {
        host.setStatus('ready');
        host.provideSurface('demo.graph', async () => {
          throw new Error('the graph is on fire');
        });
      },
    });

    assert.equal(
      await bed.runtime.drawSurface({ type: 'demo.graph', params: {}, cols: 1, rows: 1 }),
      undefined,
    );
    // A picture that failed to draw says nothing about whether the plugin
    // works, the same as a heartbeat that threw.
    assert.equal(bed.runtime.status('demo')?.status, 'ready');

    await bed.dispose();
  });
});

/*
 * The heartbeat the host keeps for a plugin.
 *
 * Real timers and short periods rather than a fake clock: the point of moving
 * these off the plugins is that the host owns actual timers and can be made to
 * let go of them, and a fake clock would test everything except that.
 */
describe('a heartbeat the host keeps', () => {
  const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it('calls back until it is stopped, and then does not', async () => {
    const bed = await bench();
    let beats = 0;
    let ticker: Ticker | undefined;

    await bed.runtime.install(manifest, {
      start(host: PluginHost) {
        ticker = host.update(20, () => {
          beats += 1;
        });
      },
    });

    await settle(120);
    assert.ok(beats >= 3, `expected several beats, got ${beats}`);

    ticker?.stop();
    const atStop = beats;
    await settle(80);
    assert.equal(beats, atStop, 'a stopped heartbeat is stopped');

    await bed.dispose();
  });

  it('pauses on an interval of nothing, and picks up again', async () => {
    const bed = await bench();
    let beats = 0;
    let ticker: Ticker | undefined;

    await bed.runtime.install(manifest, {
      start(host: PluginHost) {
        ticker = host.update(20, () => {
          beats += 1;
        });
      },
    });

    await settle(80);
    ticker?.every(0);
    const paused = beats;

    await settle(80);
    assert.equal(beats, paused, 'nothing above zero means nothing');

    // The same handle, still good: this is how the clock goes quiet when
    // nothing is reading it and comes back when something is.
    ticker?.every(20);
    await settle(80);
    assert.ok(beats > paused, 'and it beats again when asked');

    await bed.dispose();
  });

  it('lets go when the plugin is stopped, whatever the plugin does', async () => {
    const bed = await bench();
    let beats = 0;

    // Deliberately keeps no handle and clears nothing in `stop`: the whole
    // point is that a plugin can no longer leave a timer running behind it.
    await bed.runtime.install(manifest, {
      start(host: PluginHost) {
        host.update(20, () => {
          beats += 1;
        });
      },
    });

    await settle(80);
    assert.ok(beats > 0);

    await bed.runtime.stopAll();
    const atStop = beats;
    await settle(80);
    assert.equal(beats, atStop, 'stopping the plugin stopped its heartbeat');

    await bed.dispose();
  });

  it('does not blame the plugin for one bad beat', async () => {
    const bed = await bench();
    let beats = 0;

    await bed.runtime.install(manifest, {
      start(host: PluginHost) {
        host.setStatus('ready');
        host.update(20, () => {
          beats += 1;
          throw new Error('the network is out');
        });
      },
    });

    await settle(80);

    // A poll failing while a router reboots says nothing about whether the
    // plugin works, and a status event every twenty milliseconds would say it
    // very loudly. Whether a failure matters is the plugin's to declare.
    assert.ok(beats >= 2, 'it keeps beating');
    assert.equal(bed.runtime.status('demo')?.status, 'ready');

    await bed.dispose();
  });
});

describe('PluginSettingsStore', () => {
  it('keeps secrets out of the readable file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'easydeck-secrets-'));
    const store = new PluginSettingsStore(undefined, join(dir, 'open'), join(dir, 'sealed'));

    await store.save('demo', { port: 4455, password: 'hunter2' }, manifest.settings ?? []);

    const open = await readFile(join(dir, 'open', 'demo.json'), 'utf8');
    assert.match(open, /4455/);
    assert.doesNotMatch(open, /hunter2/, 'a token must never land in the file people share');

    assert.deepEqual(await store.filledSecrets('demo'), ['password']);
    assert.deepEqual(await store.load('demo'), { port: 4455, password: 'hunter2' });

    await rm(dir, { recursive: true, force: true });
  });

  it('saves one field without erasing the others', async () => {
    // The configurator never receives a secret, so it cannot send one back:
    // a whole-document save would drop every token on a port change.
    const dir = await mkdtemp(join(tmpdir(), 'easydeck-partial-'));
    const store = new PluginSettingsStore(undefined, join(dir, 'open'), join(dir, 'sealed'));

    await store.save('demo', { port: 4455, password: 'hunter2' }, manifest.settings ?? []);
    await store.save('demo', { port: 4460 }, manifest.settings ?? []);

    assert.deepEqual(await store.load('demo'), { port: 4460, password: 'hunter2' });
    await rm(dir, { recursive: true, force: true });
  });

  it('drops a secret when it is cleared, and ignores undeclared fields', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'easydeck-clear-'));
    const store = new PluginSettingsStore(undefined, join(dir, 'open'), join(dir, 'sealed'));

    await store.save('demo', { password: 'hunter2', stray: 'x' }, manifest.settings ?? []);
    assert.deepEqual(await store.load('demo'), { password: 'hunter2' });

    await store.save('demo', { password: '' }, manifest.settings ?? []);
    assert.deepEqual(await store.filledSecrets('demo'), []);

    await rm(dir, { recursive: true, force: true });
  });

  it('seals with the vault it is given', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'easydeck-vault-'));
    const vault = {
      seal: (text: string) => `sealed:${text}`,
      open: (sealed: string) => sealed.replace(/^sealed:/, ''),
      sealed: true,
    };
    const store = new PluginSettingsStore(vault, join(dir, 'open'), join(dir, 'sealed'));

    await store.save('demo', { password: 'hunter2' }, manifest.settings ?? []);

    const written = await readFile(join(dir, 'sealed', 'demo.json'), 'utf8');
    assert.match(written, /sealed:hunter2/);
    assert.doesNotMatch(written, /no platform key store/, 'no warning where sealing is real');
    assert.deepEqual(await store.load('demo'), { password: 'hunter2' });

    await rm(dir, { recursive: true, force: true });
  });
});

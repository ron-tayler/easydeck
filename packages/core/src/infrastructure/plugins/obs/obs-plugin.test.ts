import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, it } from 'node:test';

import { VariableStore, createActionRegistry } from '@easydeck/engine';
import type { ActionContext } from '@easydeck/engine';

import { PluginRuntime } from '../../../application/plugin-runtime.js';
import { PluginSettingsStore } from '../plugin-settings-store.js';
import { FakeObs } from './fake-obs.js';
import { obsManifest, registerObsPlugin } from './obs-plugin.js';

/** Everything a connected OBS answers when the plugin first reads its state. */
const STATE = {
  GetSceneList: {
    currentProgramSceneName: 'Intro',
    scenes: [{ sceneName: 'Ending' }, { sceneName: 'Game' }, { sceneName: 'Intro' }],
  },
  GetStreamStatus: { outputActive: false },
  GetRecordStatus: { outputActive: false, outputPaused: false },
  GetReplayBufferStatus: { outputActive: true },
  GetVirtualCamStatus: { outputActive: false },
  SetCurrentProgramScene: {},
  ToggleStream: {},
  ToggleRecord: {},
  GetInputList: {
    inputs: [
      { inputName: 'Mic', inputKind: 'wasapi_input_capture' },
      { inputName: 'Desktop', inputKind: 'wasapi_output_capture' },
      { inputName: 'Webcam', inputKind: 'dshow_input' },
    ],
  },
  ToggleInputMute: {},
};

/** Everything an action is handed, of which OBS actions use only the first. */
function context(variables: VariableStore): ActionContext {
  return {
    variables,
    deckId: 'test',
    button: { id: 'b', key: 0 },
    location: { folderId: 'root', pageId: 'main' },
    profileId: 'test',
    openFolder: () => undefined,
    goToPage: () => undefined,
    goUp: () => undefined,
    goHome: () => undefined,
    goBack: () => undefined,
    setButtonState: () => undefined,
  };
}

/** A runtime with the plugin installed, pointed at a fake OBS on a free port. */
async function bench(options: { password?: string; serverPassword?: string } = {}) {
  const obs = new FakeObs({
    ...(options.serverPassword === undefined ? {} : { password: options.serverPassword }),
    responses: STATE,
  });
  const port = await obs.listen();

  const dir = `${process.env['TEMP'] ?? '/tmp'}/easydeck-obs-${port}`;
  const settings = new PluginSettingsStore(undefined, `${dir}/open`, `${dir}/sealed`);
  await settings.save(
    'obs',
    { host: '127.0.0.1', port, password: options.password ?? '' },
    obsManifest.settings ?? [],
  );

  const variables = new VariableStore();
  const registry = createActionRegistry();
  const runtime = new PluginRuntime({ settings, variables });
  runtime.on('error', () => undefined);

  await registerObsPlugin(registry, runtime, { retryDelaysMs: [50, 100] });

  return {
    obs,
    variables,
    registry,
    runtime,
    /** Waits until the condition holds, or gives up loudly. */
    async until(what: string, holds: () => boolean, timeoutMs = 3_000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (holds()) return;
        await delay(20);
      }
      assert.fail(`timed out waiting for ${what}`);
    },
    async dispose() {
      await runtime.stopAll();
      await obs.close();
    },
  };
}

describe('the OBS plugin', () => {
  it('connects, authenticates and reads the state it will show', async () => {
    const bed = await bench({ password: 'hunter2', serverPassword: 'hunter2' });
    await bed.until('a connection', () => bed.runtime.status('obs')?.status === 'ready');

    assert.equal(bed.variables.get('obs.connected'), true);
    await bed.until('the scene', () => bed.variables.get('obs.scene') === 'Intro');
    assert.equal(bed.variables.get('obs.streaming'), false);
    assert.equal(bed.variables.get('obs.replay-buffer'), true);

    await bed.dispose();
  });

  it('says so, in words, when the password is wrong', async () => {
    // The one failure a user can fix, so it must not read as "OBS is broken".
    const bed = await bench({ password: 'wrong', serverPassword: 'hunter2' });
    await bed.until('a failure', () => bed.runtime.status('obs')?.status === 'error');

    assert.equal(bed.variables.get('obs.connected'), false);
    await bed.dispose();
  });

  it('follows what OBS reports, whoever caused it', async () => {
    // The whole point of events over polling: pressing Record in OBS's own
    // window has to light the key on the desk.
    const bed = await bench();
    await bed.until('a connection', () => bed.runtime.status('obs')?.status === 'ready');

    bed.obs.emit('RecordStateChanged', { outputActive: true });
    await bed.until('the recording flag', () => bed.variables.get('obs.recording') === true);

    bed.obs.emit('CurrentProgramSceneChanged', { sceneName: 'Game' });
    await bed.until('the scene', () => bed.variables.get('obs.scene') === 'Game');

    bed.obs.emit('StreamStateChanged', { outputActive: true });
    await bed.until('the streaming flag', () => bed.variables.get('obs.streaming') === true);

    await bed.dispose();
  });

  it('clears the pause when the recording stops', async () => {
    // OBS sends no separate event for it, and a key left saying "paused"
    // after the recording ended is a key telling a lie.
    const bed = await bench();
    await bed.until('a connection', () => bed.runtime.status('obs')?.status === 'ready');

    bed.obs.emit('RecordStateChanged', { outputActive: true });
    bed.obs.emit('RecordStateChangedPaused', { outputPaused: true });
    await bed.until('the pause', () => bed.variables.get('obs.recording-paused') === true);

    bed.obs.emit('RecordStateChanged', { outputActive: false });
    await bed.until('the pause clearing', () => bed.variables.get('obs.recording-paused') === false);

    await bed.dispose();
  });

  it('runs an action against OBS', async () => {
    const bed = await bench();
    await bed.until('a connection', () => bed.runtime.status('obs')?.status === 'ready');

    await bed.registry.run(
      { type: 'obs.set-scene', params: { scene: 'Game' } },
      context(bed.variables),
    );

    const sent = bed.obs.requests.find((request) => request.type === 'SetCurrentProgramScene');
    assert.deepEqual(sent?.data, { sceneName: 'Game' });

    await bed.dispose();
  });

  it('refuses an action while OBS is not there, rather than doing nothing', async () => {
    // A key that silently did nothing is the failure this plugin exists to
    // avoid; a rejected action puts a warning on the key.
    const bed = await bench();
    await bed.obs.close();
    await bed.until('the loss', () => bed.runtime.status('obs')?.status !== 'ready');

    await assert.rejects(
      bed.registry.run({ type: 'obs.toggle-stream' }, context(bed.variables)),
      (error: Error) => {
        // The engine wraps a failed action and keeps the reason as its cause,
        // which is what the configurator unwraps to show on the key.
        assert.match(String((error.cause as Error)?.message), /OBS/);
        return true;
      },
    );

    await bed.runtime.stopAll();
  });

  it('clears what it published when the connection goes', async () => {
    const bed = await bench();
    await bed.until('a connection', () => bed.runtime.status('obs')?.status === 'ready');
    bed.obs.emit('CurrentProgramSceneChanged', { sceneName: 'Game' });
    await bed.until('the scene', () => bed.variables.get('obs.scene') === 'Game');

    bed.obs.dropConnections();

    await bed.until('the scene clearing', () => bed.variables.get('obs.scene') === '');
    assert.equal(bed.variables.get('obs.connected'), false);

    await bed.dispose();
  });

  it('comes back on its own after OBS restarts', async () => {
    const bed = await bench();
    await bed.until('a connection', () => bed.runtime.status('obs')?.status === 'ready');

    bed.obs.dropConnections();
    await bed.until('the loss', () => bed.runtime.status('obs')?.status !== 'ready');

    await bed.until('the reconnection', () => bed.runtime.status('obs')?.status === 'ready', 5_000);
    assert.equal(bed.variables.get('obs.scene'), 'Intro');

    await bed.dispose();
  });

  it('offers the scenes OBS has, newest last as a person would list them', async () => {
    const bed = await bench();
    await bed.until('a connection', () => bed.runtime.status('obs')?.status === 'ready');

    const scenes = await bed.runtime.optionsFor('obs', 'scenes');
    assert.deepEqual(
      scenes.map((option) => option.value),
      ['Intro', 'Game', 'Ending'],
    );

    const audio = await bed.runtime.optionsFor('obs', 'audio-inputs');
    assert.deepEqual(
      audio.map((option) => option.value),
      ['Mic', 'Desktop'],
      'a webcam is not something to mute',
    );

    await bed.dispose();
  });

  it('answers with an empty list when OBS is closed, so a key can still be set up', async () => {
    const bed = await bench();
    await bed.obs.close();
    await bed.until('the loss', () => bed.runtime.status('obs')?.status !== 'ready');

    assert.deepEqual(await bed.runtime.optionsFor('obs', 'scenes'), []);
    await bed.runtime.stopAll();
  });
});

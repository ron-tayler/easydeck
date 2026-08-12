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
  GetSourceFilterList: { filters: [{ filterName: 'Noise gate' }, { filterName: 'Colour' }] },
  GetSourceFilter: { filterEnabled: true },
  SetSourceFilterEnabled: {},
  GetInputVolume: { inputVolumeDb: -6 },
  SetInputVolume: {},
  GetInputMute: { inputMuted: true },
  GetInputAudioMonitorType: { monitorType: 'OBS_MONITORING_TYPE_MONITOR_ONLY' },
  SetInputAudioMonitorType: {},
  GetSceneItemId: { sceneItemId: 7 },
  GetSceneItemEnabled: { sceneItemEnabled: true },
  GetCurrentSceneTransition: { transitionName: 'Fade', transitionDuration: 300 },
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
  setWidgetParam: () => undefined,
  };
}

/** A runtime with the plugin installed, pointed at a fake OBS on a free port. */
async function bench(
  options: { password?: string; serverPassword?: string; enabled?: boolean } = {},
) {
  const obs = new FakeObs({
    ...(options.serverPassword === undefined ? {} : { password: options.serverPassword }),
    responses: STATE,
  });
  const port = await obs.listen();

  const dir = `${process.env['TEMP'] ?? '/tmp'}/easydeck-obs-${port}`;
  const settings = new PluginSettingsStore(undefined, `${dir}/open`, `${dir}/sealed`);
  await settings.save(
    'obs',
    {
      enabled: options.enabled ?? true,
      host: '127.0.0.1',
      port,
      password: options.password ?? '',
    },
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

  it('stays off until somebody turns it on', async () => {
    // A machine with no OBS on it should not have something knocking on port
    // 4455 every half minute for ever, and a plugin that connects the moment
    // it is installed fails before anybody has configured it.
    const bed = await bench({ enabled: false });
    await delay(120);

    assert.equal(bed.runtime.status('obs')?.status, 'off');
    assert.equal(bed.obs.requests.length, 0, 'nothing was asked of OBS');
    assert.equal(bed.variables.get('obs.connected'), false);

    await bed.dispose();
  });

  it('connects as soon as it is turned on, without a restart', async () => {
    const bed = await bench({ enabled: false });
    await delay(80);
    assert.equal(bed.runtime.status('obs')?.status, 'off');

    await bed.runtime.configure('obs', { enabled: true });

    await bed.until('a connection', () => bed.runtime.status('obs')?.status === 'ready');
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

  it('offers the filters of the source that was picked, and none before one is', async () => {
    // The list depends on another parameter, which is why the loader is given
    // what has been filled in so far. Asked with nothing chosen, it has
    // nothing to say — and must not answer with every filter in OBS.
    const bed = await bench();
    await bed.until('a connection', () => bed.runtime.status('obs')?.status === 'ready');

    assert.deepEqual(await bed.runtime.optionsFor('obs', 'filters', {}), []);

    const filters = await bed.runtime.optionsFor('obs', 'filters', { source: 'Webcam' });
    assert.deepEqual(
      filters.map((option) => option.value),
      ['Noise gate', 'Colour'],
    );

    const asked = bed.obs.requests.find((request) => request.type === 'GetSourceFilterList');
    assert.deepEqual(asked?.data, { sourceName: 'Webcam' });

    await bed.dispose();
  });

  it('changes a volume relative to what it already is', async () => {
    // "Quieter" only means something against the current level, so the action
    // reads before it writes.
    const bed = await bench();
    await bed.until('a connection', () => bed.runtime.status('obs')?.status === 'ready');

    await bed.registry.run(
      { type: 'obs.adjust-volume', params: { input: 'Mic', db: -4 } },
      context(bed.variables),
    );

    const sent = bed.obs.requests.find((request) => request.type === 'SetInputVolume');
    assert.deepEqual(sent?.data, { inputName: 'Mic', inputVolumeDb: -10 });

    await bed.dispose();
  });

  it('toggles a filter, whichever kind OBS considers it', async () => {
    const bed = await bench();
    await bed.until('a connection', () => bed.runtime.status('obs')?.status === 'ready');

    await bed.registry.run(
      { type: 'obs.toggle-filter', params: { source: 'Webcam', filter: 'Noise gate' } },
      context(bed.variables),
    );

    const sent = bed.obs.requests.find((request) => request.type === 'SetSourceFilterEnabled');
    assert.deepEqual(sent?.data, {
      sourceName: 'Webcam',
      filterName: 'Noise gate',
      filterEnabled: false,
    });

    await bed.dispose();
  });

  it('knows while a transition is running', async () => {
    // Both edges come from OBS, so this is known rather than timed — a
    // transition can be cut short, and a key counting down would go on
    // claiming it was running.
    const bed = await bench();
    await bed.until('a connection', () => bed.runtime.status('obs')?.status === 'ready');

    assert.equal(bed.variables.get('obs.transition-name'), 'Fade');
    assert.equal(bed.variables.get('obs.transition-duration'), 300);
    assert.equal(bed.variables.get('obs.transitioning'), false);

    bed.obs.emit('SceneTransitionStarted', { transitionName: 'Stinger' });
    await bed.until('the start', () => bed.variables.get('obs.transitioning') === true);
    assert.equal(bed.variables.get('obs.transition-name'), 'Stinger');

    bed.obs.emit('SceneTransitionEnded', { transitionName: 'Stinger' });
    await bed.until('the end', () => bed.variables.get('obs.transitioning') === false);

    await bed.dispose();
  });

  it('reads only the family keys a profile actually uses', async () => {
    // The whole point of families: OBS may have fifty inputs, and a deck
    // showing one microphone should cost one question, not fifty.
    const bed = await bench();
    await bed.until('a connection', () => bed.runtime.status('obs')?.status === 'ready');

    bed.obs.requests.length = 0;
    bed.runtime.setWatched(['obs.mute(Mic)', 'obs.volume(Mic)', 'hardware.cpu']);
    await bed.until('the mute', () => bed.variables.get('obs.mute(Mic)') === true);

    assert.equal(bed.variables.get('obs.volume(Mic)'), -6);
    assert.equal(
      bed.obs.requests.filter((request) => request.type === 'GetInputMute').length,
      1,
      'one question about the one input a profile reads',
    );
    assert.equal(
      bed.variables.has('obs.mute(Desktop)'),
      false,
      'nothing was published about an input nobody reads',
    );

    await bed.dispose();
  });

  it('follows the mixer by event, and only for what is watched', async () => {
    const bed = await bench();
    await bed.until('a connection', () => bed.runtime.status('obs')?.status === 'ready');
    bed.runtime.setWatched(['obs.mute(Mic)']);
    await bed.until('the first read', () => bed.variables.get('obs.mute(Mic)') === true);

    bed.obs.emit('InputMuteStateChanged', { inputName: 'Mic', inputMuted: false });
    await bed.until('the change', () => bed.variables.get('obs.mute(Mic)') === false);

    bed.obs.emit('InputMuteStateChanged', { inputName: 'Desktop', inputMuted: true });
    await delay(60);
    assert.equal(bed.variables.has('obs.mute(Desktop)'), false, 'still nobody reads it');

    await bed.dispose();
  });

  it('reads a pair, where the key names two things', async () => {
    const bed = await bench();
    await bed.until('a connection', () => bed.runtime.status('obs')?.status === 'ready');

    bed.runtime.setWatched(['obs.visible(Game, Webcam)']);
    await bed.until('the visibility', () => bed.variables.get('obs.visible(Game, Webcam)') === true);

    const asked = bed.obs.requests.find((request) => request.type === 'GetSceneItemId');
    assert.deepEqual(asked?.data, { sceneName: 'Game', sourceName: 'Webcam' });

    await bed.dispose();
  });

  it('clears a key whose source has gone, rather than leaving it stale', async () => {
    const bed = await bench();
    await bed.until('a connection', () => bed.runtime.status('obs')?.status === 'ready');

    bed.runtime.setWatched(['obs.mute(Mic)']);
    await bed.until('the mute', () => bed.variables.get('obs.mute(Mic)') === true);

    // A source that is not there any more, which OBS answers with a refusal
    // rather than a value.
    bed.obs.unknown.add('Ghost');
    bed.runtime.setWatched(['obs.filter(Ghost, Gate)']);
    await delay(120);

    assert.equal(bed.variables.has('obs.filter(Ghost, Gate)'), false);
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

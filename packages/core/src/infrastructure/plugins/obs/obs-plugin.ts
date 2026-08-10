import { PLUGIN_API_VERSION, stringParam } from '@easydeck/engine';
import type {
  ActionHandler,
  ActionRegistry,
  ButtonPreset,
  Plugin,
  PluginHost,
  PluginManifest,
  PresetButton,
} from '@easydeck/engine';

import type { PluginRuntime } from '../../../application/plugin-runtime.js';
import { ObsConnection } from './obs-connection.js';

/**
 * OBS Studio, as a deck sees it.
 *
 * The first plugin that holds a connection open, and therefore the first with
 * settings, a status worth showing and lists that only exist while another
 * program is running. Everything it publishes is a variable, so a key can bind
 * to it without knowing anything about OBS: a scene button lights up because
 * `obs.scene` equals its scene, not because the plugin reached in and coloured
 * it.
 *
 * Feedback comes from events rather than polling. OBS says what changed the
 * moment it changes, which is why the recording key turns red when the
 * recording is stopped from OBS's own window — the deck is showing the truth,
 * not its own last instruction.
 */

export const OBS_PLUGIN_ID = 'obs';

/** What OBS calls the inputs a "mute" action makes sense on. */
const AUDIO_KINDS = ['wasapi_input_capture', 'wasapi_output_capture', 'coreaudio_input_capture', 'coreaudio_output_capture', 'pulse_input_capture', 'pulse_output_capture', 'audio_line'];

export const obsManifest: PluginManifest = {
  id: OBS_PLUGIN_ID,
  name: { en: 'OBS', ru: 'OBS' },
  description: {
    en: 'Scenes, streaming, recording and audio in OBS Studio',
    ru: 'Сцены, стрим, запись и звук в OBS Studio',
  },
  version: '1.0.0',
  apiVersion: PLUGIN_API_VERSION,
  builtIn: true,

  settings: [
    {
      /*
       * Nothing special to the host: an ordinary boolean setting the plugin
       * reads for itself.
       *
       * Which is the point — any plugin can have one, and it means whatever
       * that plugin decides. Here it means "open the socket": a machine with
       * no OBS on it should not have something knocking on port 4455 every
       * half minute for ever, and a plugin that connects the moment it is
       * installed is a plugin that fails before anybody has configured it.
       */
      name: 'enabled',
      type: 'boolean',
      label: { en: 'Connect to OBS', ru: 'Подключаться к OBS' },
      default: false,
      required: false,
    },
    {
      name: 'host',
      type: 'string',
      label: { en: 'Address', ru: 'Адрес' },
      default: '127.0.0.1',
      description: {
        en: 'Leave as it is unless OBS runs on another machine',
        ru: 'Оставьте как есть, если OBS не на другом компьютере',
      },
    },
    {
      name: 'port',
      type: 'number',
      label: { en: 'Port', ru: 'Порт' },
      default: 4455,
      min: 1,
      max: 65535,
    },
    {
      name: 'password',
      type: 'string',
      secret: true,
      required: false,
      label: { en: 'Password', ru: 'Пароль' },
      description: {
        en: 'From Tools → WebSocket Server Settings in OBS',
        ru: 'Из «Инструменты → Настройки сервера WebSocket» в OBS',
      },
    },
  ],

  commands: [{ name: 'reconnect', label: { en: 'Reconnect', ru: 'Переподключиться' }, icon: 'link' }],

  variables: [
    {
      name: 'obs.connected',
      type: 'boolean',
      label: { en: 'OBS connected', ru: 'OBS подключён' },
      initial: false,
    },
    { name: 'obs.scene', type: 'string', label: { en: 'Current scene', ru: 'Текущая сцена' } },
    {
      name: 'obs.streaming',
      type: 'boolean',
      label: { en: 'Streaming', ru: 'Идёт трансляция' },
      initial: false,
    },
    {
      name: 'obs.recording',
      type: 'boolean',
      label: { en: 'Recording', ru: 'Идёт запись' },
      initial: false,
    },
    {
      name: 'obs.recording-paused',
      type: 'boolean',
      label: { en: 'Recording paused', ru: 'Запись на паузе' },
      initial: false,
    },
    {
      name: 'obs.replay-buffer',
      type: 'boolean',
      label: { en: 'Replay buffer on', ru: 'Буфер повтора включён' },
      initial: false,
    },
    {
      name: 'obs.virtual-cam',
      type: 'boolean',
      label: { en: 'Virtual camera on', ru: 'Виртуальная камера включена' },
      initial: false,
    },
  ],

  actions: [
    {
      type: 'obs.set-scene',
      icon: 'page',
      label: { en: 'Switch scene', ru: 'Переключить сцену' },
      params: [
        {
          name: 'scene',
          type: 'select',
          optionsFrom: 'scenes',
          label: { en: 'Scene', ru: 'Сцена' },
          placeholder: { en: 'Name of the scene', ru: 'Название сцены' },
        },
      ],
      group: { en: 'Scenes', ru: 'Сцены' },
    },
    {
      type: 'obs.preview-scene',
      icon: 'page',
      label: { en: 'Set preview scene', ru: 'Сцена в предпросмотр' },
      description: {
        en: 'Studio mode only: puts a scene in the preview without going live',
        ru: 'Только в студийном режиме: ставит сцену в предпросмотр, не выпуская в эфир',
      },
      params: [
        {
          name: 'scene',
          type: 'select',
          optionsFrom: 'scenes',
          label: { en: 'Scene', ru: 'Сцена' },
        },
      ],
      group: { en: 'Scenes', ru: 'Сцены' },
    },
    {
      type: 'obs.transition',
      icon: 'back',
      label: { en: 'Transition', ru: 'Переход' },
      description: {
        en: 'Studio mode only: sends the preview to the stream',
        ru: 'Только в студийном режиме: отправляет предпросмотр в эфир',
      },
      params: [],
      group: { en: 'Scenes', ru: 'Сцены' },
    },

    {
      type: 'obs.toggle-stream',
      icon: 'globe',
      label: { en: 'Start / stop stream', ru: 'Начать / завершить трансляцию' },
      params: [],
      group: { en: 'Broadcast', ru: 'Эфир' },
    },
    {
      type: 'obs.toggle-record',
      icon: 'stop',
      label: { en: 'Start / stop recording', ru: 'Начать / остановить запись' },
      params: [],
      group: { en: 'Broadcast', ru: 'Эфир' },
    },
    {
      type: 'obs.toggle-record-pause',
      icon: 'play-pause',
      label: { en: 'Pause / resume recording', ru: 'Пауза / продолжить запись' },
      params: [],
      group: { en: 'Broadcast', ru: 'Эфир' },
    },
    {
      type: 'obs.toggle-replay-buffer',
      icon: 'previous',
      label: { en: 'Replay buffer on / off', ru: 'Буфер повтора вкл / выкл' },
      params: [],
      group: { en: 'Broadcast', ru: 'Эфир' },
    },
    {
      type: 'obs.save-replay',
      icon: 'next',
      label: { en: 'Save replay', ru: 'Сохранить повтор' },
      params: [],
      group: { en: 'Broadcast', ru: 'Эфир' },
    },
    {
      type: 'obs.toggle-virtual-cam',
      icon: 'app',
      label: { en: 'Virtual camera on / off', ru: 'Виртуальная камера вкл / выкл' },
      params: [],
      group: { en: 'Broadcast', ru: 'Эфир' },
    },

    {
      type: 'obs.toggle-mute',
      icon: 'mute',
      label: { en: 'Mute / unmute', ru: 'Выключить / включить звук' },
      params: [
        {
          name: 'input',
          type: 'select',
          optionsFrom: 'audio-inputs',
          label: { en: 'Source', ru: 'Источник' },
          placeholder: { en: 'Name of the audio source', ru: 'Название источника звука' },
        },
      ],
      group: { en: 'Audio', ru: 'Звук' },
    },
    {
      type: 'obs.toggle-source',
      icon: 'folder',
      label: { en: 'Show / hide source', ru: 'Показать / скрыть источник' },
      params: [
        {
          name: 'scene',
          type: 'select',
          optionsFrom: 'scenes',
          label: { en: 'Scene', ru: 'Сцена' },
        },
        {
          name: 'source',
          type: 'select',
          optionsFrom: 'sources',
          label: { en: 'Source', ru: 'Источник' },
        },
      ],
      group: { en: 'Audio', ru: 'Звук' },
    },
  ],

  presets: [
    lamp(
      'stream',
      { en: 'Stream', ru: 'Трансляция' },
      { en: 'Starts and stops the stream, and shows whether it is live', ru: 'Запускает и останавливает трансляцию и показывает, идёт ли она' },
      'obs.streaming',
      'obs.toggle-stream',
      { off: 'Stream', on: 'LIVE' },
      '#7a2c2c',
    ),
    lamp(
      'record',
      { en: 'Recording', ru: 'Запись' },
      { en: 'Starts and stops recording, and shows whether it is running', ru: 'Запускает и останавливает запись и показывает, идёт ли она' },
      'obs.recording',
      'obs.toggle-record',
      { off: 'Record', on: '● REC' },
      '#7a2c2c',
    ),
    lamp(
      'replay',
      { en: 'Replay buffer', ru: 'Буфер повтора' },
      { en: 'Turns the replay buffer on and off', ru: 'Включает и выключает буфер повтора' },
      'obs.replay-buffer',
      'obs.toggle-replay-buffer',
      { off: 'Replay', on: 'Replay on' },
      '#2f5d3a',
    ),
    lamp(
      'virtual-cam',
      { en: 'Virtual camera', ru: 'Виртуальная камера' },
      { en: 'Turns the virtual camera on and off', ru: 'Включает и выключает виртуальную камеру' },
      'obs.virtual-cam',
      'obs.toggle-virtual-cam',
      { off: 'Cam', on: 'Cam on' },
      '#2f5d3a',
    ),
    {
      name: 'current-scene',
      label: { en: 'Current scene', ru: 'Текущая сцена' },
      description: {
        en: 'Shows which scene is live, and does nothing when pressed',
        ru: 'Показывает, какая сцена в эфире; на нажатие не реагирует',
      },
      button: {
        states: [
          {
            id: 'default',
            visual: { background: '#22303c', label: { text: '{{obs.scene}}', fontSize: 12 } },
          },
        ],
      },
    },
  ],
};

/**
 * A key that both does a thing and shows whether the thing is on.
 *
 * The shape every OBS toggle wants, written once. Two states bound to a
 * boolean: OBS reports the change whoever caused it, so pressing Start in
 * OBS's own window lights the key on the desk.
 *
 * The words on the key are English and short — LIVE, REC — rather than
 * translated. A label goes into the profile as plain text at the moment it is
 * dropped, so it would be frozen in whatever language the configurator
 * happened to be in; these are the words already printed on the equipment
 * this sits next to.
 */
function lamp(
  name: string,
  label: { en: string; ru: string },
  description: { en: string; ru: string },
  variable: string,
  action: string,
  text: { off: string; on: string },
  colour: string,
): ButtonPreset {
  const button: PresetButton = {
    stateFrom: variable,
    states: [
      {
        id: 'off',
        when: false,
        visual: { background: '#22303c', label: { text: text.off, fontSize: 13 } },
        actions: { press: [{ type: action }] },
      },
      {
        id: 'on',
        when: true,
        visual: { background: colour, label: { text: text.on, fontSize: 13 } },
        actions: { press: [{ type: action }] },
      },
    ],
  };

  return { name, label, description, button };
}

export interface ObsPluginOptions {
  /** Overridden by tests, which cannot spend a second per attempt. */
  readonly retryDelaysMs?: readonly number[];
}

export class ObsPlugin implements Plugin {
  private connection?: ObsConnection;
  private host?: PluginHost;

  constructor(private readonly options: ObsPluginOptions = {}) {}

  start(host: PluginHost): void {
    this.host = host;
    this.connect();
    host.onSettingsChanged(() => this.connect());
  }

  stop(): void {
    this.connection?.stop();
    this.connection = undefined;
  }

  /** Used by the settings window's Reconnect button. */
  reconnect(): void {
    this.connect();
  }

  /**
   * Drops whatever connection there is and opens one from current settings.
   *
   * Every setting here is worth a reconnect — address, port and password are
   * all part of the handshake — so the plugin does not try to be clever about
   * which changed.
   */
  private connect(): void {
    const host = this.host;
    if (!host) return;

    this.connection?.stop();
    this.connection = undefined;
    this.clearVariables();

    const settings = host.settings();

    if (settings['enabled'] !== true) {
      host.setStatus('off');
      return;
    }

    this.connection = new ObsConnection({
      ...(this.options.retryDelaysMs ? { retryDelaysMs: this.options.retryDelaysMs } : {}),
      host: String(settings['host'] ?? '127.0.0.1'),
      port: Number(settings['port'] ?? 4455),
      password: String(settings['password'] ?? ''),
      onEvent: (type, data) => this.onEvent(type, data),
      onState: (state, message) => {
        host.setStatus(state, message ? { en: message } : undefined);
        host.setVariable('obs.connected', state === 'ready');
        if (state === 'ready') void this.readEverything();
        else this.clearVariables();
      },
      log: (level, message) => host.log(level, message),
    });

    this.registerOptions(host);
    this.connection.start();
  }

  /**
   * The lists a configurator offers while OBS is running.
   *
   * Registered once rather than per connection: the loader runs when somebody
   * opens the parameter, and answering "none" while disconnected is exactly
   * what the field falls back to a plain box for.
   */
  private registerOptions(host: PluginHost): void {
    host.provideOptions('scenes', async () => {
      const data = await this.require().request<{ scenes?: { sceneName?: string }[] }>('GetSceneList');
      // OBS lists them top-first as they appear in its own panel, which is
      // upside down compared to how anybody describes their scenes.
      return [...(data.scenes ?? [])]
        .reverse()
        .map((scene) => String(scene.sceneName ?? ''))
        .filter((name) => name !== '')
        .map((name) => ({ value: name, label: { en: name } }));
    });

    host.provideOptions('audio-inputs', async () => {
      const data = await this.require().request<{ inputs?: { inputName?: string; inputKind?: string }[] }>(
        'GetInputList',
      );
      return (data.inputs ?? [])
        .filter((input) => AUDIO_KINDS.includes(String(input.inputKind ?? '')))
        .map((input) => String(input.inputName ?? ''))
        .filter((name) => name !== '')
        .map((name) => ({ value: name, label: { en: name } }));
    });

    host.provideOptions('sources', async () => {
      const data = await this.require().request<{ inputs?: { inputName?: string }[] }>('GetInputList');
      return (data.inputs ?? [])
        .map((input) => String(input.inputName ?? ''))
        .filter((name) => name !== '')
        .map((name) => ({ value: name, label: { en: name } }));
    });
  }

  /**
   * Asks OBS for everything a key might be showing.
   *
   * On connect only. Afterwards events carry the changes, and asking again
   * would be both slower and less correct — an answer in flight while
   * something changes is an answer that arrives already stale.
   */
  private async readEverything(): Promise<void> {
    const host = this.host;
    const connection = this.connection;
    if (!host || !connection) return;

    try {
      const scenes = await connection.request<{ currentProgramSceneName?: string }>('GetSceneList');
      host.setVariable('obs.scene', String(scenes.currentProgramSceneName ?? ''));

      const stream = await connection.request<{ outputActive?: boolean }>('GetStreamStatus');
      host.setVariable('obs.streaming', stream.outputActive === true);

      const record = await connection.request<{ outputActive?: boolean; outputPaused?: boolean }>(
        'GetRecordStatus',
      );
      host.setVariable('obs.recording', record.outputActive === true);
      host.setVariable('obs.recording-paused', record.outputPaused === true);

      const replay = await connection.request<{ outputActive?: boolean }>('GetReplayBufferStatus');
      host.setVariable('obs.replay-buffer', replay.outputActive === true);

      const camera = await connection.request<{ outputActive?: boolean }>('GetVirtualCamStatus');
      host.setVariable('obs.virtual-cam', camera.outputActive === true);
    } catch (cause) {
      // A refused status request is not worth dropping the connection over:
      // the replay buffer is absent on some builds, and the rest still works.
      host.log('warn', `Could not read the whole of OBS's state: ${describe(cause)}`);
    }
  }

  private onEvent(type: string, data: Record<string, unknown>): void {
    const host = this.host;
    if (!host) return;

    switch (type) {
      case 'CurrentProgramSceneChanged':
        host.setVariable('obs.scene', String(data['sceneName'] ?? ''));
        return;
      case 'StreamStateChanged':
        host.setVariable('obs.streaming', data['outputActive'] === true);
        return;
      case 'RecordStateChanged':
        host.setVariable('obs.recording', data['outputActive'] === true);
        // Stopping clears the pause: OBS does not send a separate event for it.
        if (data['outputActive'] !== true) host.setVariable('obs.recording-paused', false);
        return;
      case 'RecordStateChangedPaused':
      case 'RecordPauseStateChanged':
        host.setVariable('obs.recording-paused', data['outputPaused'] === true);
        return;
      case 'ReplayBufferStateChanged':
        host.setVariable('obs.replay-buffer', data['outputActive'] === true);
        return;
      case 'VirtualcamStateChanged':
        host.setVariable('obs.virtual-cam', data['outputActive'] === true);
        return;
      default:
        return;
    }
  }

  /** Clears what is no longer known, rather than leaving it looking current. */
  private clearVariables(): void {
    const host = this.host;
    if (!host) return;

    host.setVariable('obs.connected', false);
    host.setVariable('obs.scene', '');
    host.setVariable('obs.streaming', false);
    host.setVariable('obs.recording', false);
    host.setVariable('obs.recording-paused', false);
    host.setVariable('obs.replay-buffer', false);
    host.setVariable('obs.virtual-cam', false);
  }

  private require(): ObsConnection {
    const connection = this.connection;
    if (!connection || !connection.connected) throw new Error('OBS is not connected');
    return connection;
  }

  /** The code behind the actions, bound to this instance's connection. */
  handlers(): Record<string, ActionHandler> {
    const send = (requestType: string, requestData?: Record<string, unknown>) => async () => {
      await this.require().request(requestType, requestData);
    };

    return {
      'obs.set-scene': async (params) =>
        void (await this.require().request('SetCurrentProgramScene', {
          sceneName: stringParam(params, 'scene'),
        })),

      'obs.preview-scene': async (params) =>
        void (await this.require().request('SetCurrentPreviewScene', {
          sceneName: stringParam(params, 'scene'),
        })),

      'obs.transition': send('TriggerStudioModeTransition'),
      'obs.toggle-stream': send('ToggleStream'),
      'obs.toggle-record': send('ToggleRecord'),
      'obs.toggle-record-pause': send('ToggleRecordPause'),
      'obs.toggle-replay-buffer': send('ToggleReplayBuffer'),
      'obs.save-replay': send('SaveReplayBuffer'),
      'obs.toggle-virtual-cam': send('ToggleVirtualCam'),

      'obs.toggle-mute': async (params) =>
        void (await this.require().request('ToggleInputMute', {
          inputName: stringParam(params, 'input'),
        })),

      /**
       * Shows or hides a source, which takes two requests.
       *
       * OBS identifies an item by a number that is only meaningful inside its
       * scene, so the name has to be resolved first. Toggling rather than
       * setting: a key that hides a source and cannot show it again would be
       * half a key.
       */
      'obs.toggle-source': async (params) => {
        const sceneName = stringParam(params, 'scene');
        const sourceName = stringParam(params, 'source');
        const connection = this.require();

        const found = await connection.request<{ sceneItemId?: number }>('GetSceneItemId', {
          sceneName,
          sourceName,
        });
        const sceneItemId = Number(found.sceneItemId);

        const state = await connection.request<{ sceneItemEnabled?: boolean }>('GetSceneItemEnabled', {
          sceneName,
          sceneItemId,
        });

        await connection.request('SetSceneItemEnabled', {
          sceneName,
          sceneItemId,
          sceneItemEnabled: state.sceneItemEnabled !== true,
        });
      },
    };
  }
}

/** Installs the plugin: its actions with the registry, its life with the runtime. */
export async function registerObsPlugin(
  registry: ActionRegistry,
  runtime: PluginRuntime,
  options: ObsPluginOptions = {},
): Promise<void> {
  const plugin = new ObsPlugin(options);

  registry.installPlugin(obsManifest, plugin.handlers());
  await runtime.install(obsManifest, plugin);
  runtime.registerCommands(OBS_PLUGIN_ID, { reconnect: () => plugin.reconnect() });
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

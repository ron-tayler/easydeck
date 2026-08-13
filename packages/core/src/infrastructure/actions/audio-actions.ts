import { numberParam, stringParam } from '@easydeck/engine';
import type {
  ActionDefinition,
  ActionRegistry,
  ParamOption,
  Plugin,
  PluginHost,
  PluginManifest,
  Ticker,
} from '@easydeck/engine';

import type { PluginRuntime } from '../../application/plugin-runtime.js';
import { MEDIA_PLUGIN_ID } from './media-actions.js';
import {
  appRoutingAvailable,
  audioAvailable,
  forgetProcessNames,
  listDevices,
  listSessions,
  setAppDevice,
  setDefaultDevice,
  setSessionVolume,
} from './win32-audio.js';
import type { AudioDirection } from './win32-audio.js';
import {
  RATE_RANGE,
  VOLUME_RANGE,
  listVoices,
  speak,
  speechAvailable,
  stop as stopSpeaking,
} from './win32-speech.js';

/**
 * Sound devices and per-application volume, as things a key can do.
 *
 * Contributed to the media plugin rather than given one of its own: "make
 * these headphones the default" and "next track" are the same errand to
 * whoever is looking for them, and a plugin per capability makes a palette
 * longer without making anything easier to find.
 *
 * Windows only. Everything here goes through Core Audio, and the actions are
 * simply absent elsewhere rather than present and failing.
 */

const DIRECTIONS: readonly ParamOption[] = [
  { value: 'output', label: { en: 'Playback', ru: 'Воспроизведение' } },
  { value: 'input', label: { en: 'Recording', ru: 'Запись' } },
];

/**
 * "Whatever the system is using", as something that can be picked.
 *
 * Letting an application go is a choice like any other and needs a line of its
 * own in the list. It used to be expressed by leaving the field empty, which
 * was unreachable: the blank entry in a select is the placeholder, and it is
 * disabled the moment anything has been chosen.
 *
 * A word rather than an empty string for the same reason — the empty value
 * already means "nothing picked yet". Windows names endpoints `{0.0.0.…}`, so
 * nothing it reports can collide with this.
 */
const SYSTEM_DEFAULT = 'default';

export const audioActions: ActionDefinition[] = [
  {
    type: 'media.set-default-device',
    icon: 'speaker',
    label: { en: 'Default sound device', ru: 'Устройство по умолчанию' },
    description: {
      en: 'Switches what everything plays through, or what calls use',
      ru: 'Меняет устройство, через которое идёт звук, или устройство для связи',
    },
    params: [
      {
        name: 'direction',
        type: 'select',
        label: { en: 'Playback or recording', ru: 'Вывод или запись' },
        default: 'output',
        options: DIRECTIONS,
      },
      {
        name: 'device',
        type: 'select',
        label: { en: 'Device', ru: 'Устройство' },
        optionsFrom: 'devices',
        description: {
          en: 'As the sound settings name it',
          ru: 'Название как в параметрах звука',
        },
      },
      {
        /*
         * Windows keeps two defaults and shows the second one folded into a
         * dropdown, so most people have never seen it. Named here as the
         * settings name it, and defaulting to the one they mean.
         */
        name: 'role',
        type: 'select',
        label: { en: 'Which default', ru: 'Какое умолчание' },
        default: 'default',
        options: [
          { value: 'default', label: { en: 'Default device', ru: 'Устройство по умолчанию' } },
          {
            value: 'communications',
            label: { en: 'Default for calls', ru: 'Устройство связи по умолчанию' },
          },
        ],
      },
    ],
  },
  {
    type: 'media.set-app-volume',
    icon: 'speaker',
    label: { en: "Application's volume", ru: 'Громкость приложения' },
    params: [
      {
        name: 'app',
        type: 'select',
        label: { en: 'Application', ru: 'Приложение' },
        optionsFrom: 'apps',
        description: {
          en: 'Chosen from what is playing now; it is remembered by name, so it works later too',
          ru: 'Выбирается из того, что играет сейчас; запоминается по имени и работает и потом',
        },
      },
      {
        name: 'volume',
        type: 'number',
        label: { en: 'Volume, %', ru: 'Громкость, %' },
        default: 50,
        min: 0,
        max: 100,
      },
    ],
  },
  {
    type: 'media.adjust-app-volume',
    icon: 'volume-up',
    label: { en: "Change application's volume", ru: 'Изменить громкость приложения' },
    params: [
      { name: 'app', type: 'select', label: { en: 'Application', ru: 'Приложение' }, optionsFrom: 'apps' },
      {
        name: 'by',
        type: 'number',
        label: { en: 'By, %', ru: 'На, %' },
        default: 10,
        min: -100,
        max: 100,
        description: {
          en: 'Negative turns it down',
          ru: 'Отрицательное значение убавляет',
        },
      },
    ],
  },
  {
    type: 'media.mute-app',
    icon: 'mute',
    label: { en: 'Mute an application', ru: 'Заглушить приложение' },
    params: [
      { name: 'app', type: 'select', label: { en: 'Application', ru: 'Приложение' }, optionsFrom: 'apps' },
      {
        name: 'mode',
        type: 'select',
        label: { en: 'What to do', ru: 'Что сделать' },
        default: 'toggle',
        options: [
          { value: 'toggle', label: { en: 'Toggle', ru: 'Переключить' } },
          { value: 'on', label: { en: 'Mute', ru: 'Заглушить' } },
          { value: 'off', label: { en: 'Unmute', ru: 'Вернуть звук' } },
        ],
      },
    ],
  },
  {
    type: 'media.set-app-device',
    icon: 'speaker',
    label: { en: "Application's device", ru: 'Устройство приложения' },
    description: {
      en: 'Sends one application to a device of its own, as the Windows 11 sound settings do',
      ru: 'Отправляет одно приложение на своё устройство, как в параметрах звука Windows 11',
    },
    params: [
      { name: 'app', type: 'select', label: { en: 'Application', ru: 'Приложение' }, optionsFrom: 'apps' },
      {
        name: 'direction',
        type: 'select',
        label: { en: 'Playback or recording', ru: 'Вывод или запись' },
        default: 'output',
        options: DIRECTIONS,
      },
      {
        name: 'device',
        type: 'select',
        label: { en: 'Device', ru: 'Устройство' },
        optionsFrom: 'app-devices',
        description: {
          en: 'Pick "System default" to hand the application back to whatever everything else uses',
          ru: 'Выберите «По умолчанию», чтобы вернуть приложение на общее устройство системы',
        },
      },
    ],
  },
];

/**
 * Saying something out loud, which is the one thing a key cannot show.
 *
 * A deck has no window for messages, and the moment worth announcing — the
 * stream dropped, the timer finished — is the moment nobody is looking at the
 * panel. The clock plugin already reached for this and settled for a system
 * sound; this is the same idea with words in it, and it is a handler's natural
 * companion rather than a soundboard feature.
 *
 * Straight to whatever plays sound by default, deliberately. Choosing a device
 * would be a second question about a thing whose whole purpose is to be heard
 * by the person sitting there.
 */
const speechActions: ActionDefinition[] = [
  {
    type: 'media.speak',
    icon: 'text',
    label: { en: 'Speak', ru: 'Синтез речи' },
    description: {
      en: 'Reads text out through the default speakers. Variables in it are filled in first',
      ru: 'Читает текст вслух в колонки по умолчанию. Переменные в нём подставляются',
    },
    params: [
      {
        name: 'text',
        type: 'text',
        label: { en: 'What to say', ru: 'Что сказать' },
        placeholder: { en: 'The processor is at {{hw.cpu}} percent', ru: 'Процессор на {{hw.cpu}} процентов' },
      },
      {
        name: 'voice',
        type: 'select',
        optionsFrom: 'voices',
        label: { en: 'Voice', ru: 'Голос' },
        required: false,
        description: {
          en: 'Left empty, Windows picks. A voice that has been removed falls back to that too',
          ru: 'Пусто — выберет Windows. Удалённый голос тоже приводит к этому',
        },
        emptyNote: {
          en: 'This machine has no speech voices installed',
          ru: 'На этой машине не установлено ни одного голоса',
        },
      },
      {
        /*
         * Waiting rather than interrupting by default: two of these talking
         * over each other is two phrases nobody can make out, and the usual
         * reason for saying something is that it should be heard. A key that
         * reads out a number on every press wants the other answer.
         */
        name: 'busy',
        type: 'select',
        label: { en: 'If it is already speaking', ru: 'Если уже говорит' },
        default: 'queue',
        options: [
          { value: 'queue', label: { en: 'Wait its turn', ru: 'Дождаться очереди' } },
          { value: 'interrupt', label: { en: 'Cut it off', ru: 'Прервать' } },
        ],
      },
      {
        name: 'rate',
        type: 'number',
        label: { en: 'Speed', ru: 'Скорость' },
        default: 0,
        min: RATE_RANGE.min,
        max: RATE_RANGE.max,
        required: false,
        description: { en: 'Zero is normal', ru: 'Ноль — обычная' },
      },
      {
        name: 'volume',
        type: 'number',
        label: { en: 'Volume, %', ru: 'Громкость, %' },
        default: 100,
        min: VOLUME_RANGE.min,
        max: VOLUME_RANGE.max,
        required: false,
      },
    ],
  },
  {
    type: 'media.stop-speaking',
    icon: 'stop',
    label: { en: 'Stop speaking', ru: 'Замолчать' },
    description: {
      en: 'Cuts off what is being said and forgets what was waiting',
      ru: 'Обрывает сказанное и забывает то, что стояло в очереди',
    },
    params: [],
  },
];

/** Variables the plugin publishes, so a key can show what is in use. */
const audioVariables = [
  {
    name: 'media.output',
    type: 'string' as const,
    label: { en: 'Default playback device', ru: 'Устройство вывода по умолчанию' },
  },
  {
    name: 'media.input',
    type: 'string' as const,
    label: { en: 'Default recording device', ru: 'Устройство записи по умолчанию' },
  },
];

/** How often the defaults are looked at, having no event to listen to. */
const POLL_MS = 2000;

const directionOf = (params: Readonly<Record<string, unknown>>): AudioDirection =>
  params['direction'] === 'input' ? 'input' : 'output';

/**
 * The part of the media plugin that has a life of its own.
 *
 * It holds no connection — Core Audio is right there — but it does two things
 * a bare list of actions cannot: offer the devices and applications that exist
 * right now, and publish which device is in use so a key can say so.
 */
export class AudioPlugin implements Plugin {
  private beat?: Ticker;

  start(host: PluginHost): void {
    host.provideOptions('devices', (params) => this.devices(params));

    // Read when somebody opens the field: a voice can be installed while the
    // deck runs, and the list costs a process to produce.
    host.provideOptions('voices', async () =>
      (await listVoices()).map((voice) => ({ value: voice, label: { en: voice } })),
    );

    /*
     * The same list with one more line at the top.
     *
     * A separate source rather than a flag on the parameter: "let it go" is
     * only an answer for a single application. Offering it where the *system*
     * default is chosen would be asking Windows to default to its default.
     */
    host.provideOptions('app-devices', async (params) => [
      {
        value: SYSTEM_DEFAULT,
        label: { en: 'System default', ru: 'По умолчанию' },
      },
      ...(await this.devices(params)),
    ]);

    host.provideOptions('apps', async () => {
      forgetProcessNames();
      const sessions = await listSessions();

      // By name, not by process id: an id is gone the moment the program is
      // restarted, and a key that stops working when you reopen Discord is a
      // key nobody would keep.
      const names = [...new Set(sessions.map((session) => session.process).filter(Boolean))].sort();

      return names.map<ParamOption>((name) => ({ value: name, label: { en: name } }));
    });

    void this.readDefaults(host);
    // The host keeps the beat, so stopping this plugin really stops it —
    // and two plugins on the same period wake the machine once.
    this.beat = host.update(POLL_MS, () => this.readDefaults(host));
  }

  stop(): void {
    this.beat?.stop();
    this.beat = undefined;
  }

  private async devices(params: Readonly<Record<string, unknown>>): Promise<ParamOption[]> {
    const devices = await listDevices(directionOf(params));

    return devices.map<ParamOption>((device) => ({
      value: device.id,
      // The two defaults are marked where they are chosen: "which of these
      // five is the one in use" is the question somebody has open.
      label: {
        en: device.isDefault ? `${device.name} — default` : device.name,
        ru: device.isDefault ? `${device.name} — сейчас` : device.name,
      },
    }));
  }

  /**
   * Which devices are current, published for a key to show.
   *
   * Polled, because Core Audio's notifications arrive on a COM callback and
   * nothing here can receive one. Two seconds is far below what a person
   * notices and far above what costs anything.
   */
  private async readDefaults(host: PluginHost): Promise<void> {
    try {
      for (const direction of ['output', 'input'] as const) {
        const devices = await listDevices(direction);
        const current = devices.find((device) => device.isDefault);
        host.setVariable(`media.${direction}`, current?.name ?? '');
      }
    } catch (error) {
      host.log('warn', `Could not read the sound devices: ${(error as Error).message}`);
    }
  }
}

export interface AudioActionsResult {
  readonly available: boolean;
  readonly reason?: string;
}

/**
 * Adds the sound-device actions to the media plugin, where Windows allows it.
 *
 * The per-application ones are added regardless of whether *routing* is
 * available: volume works on every Windows, and only the device action needs
 * the undocumented interface — which reports itself when pressed rather than
 * disappearing from a palette somebody has already built a key from.
 */
export async function registerAudioActions(
  registry: ActionRegistry,
  runtime: PluginRuntime,
  manifest: PluginManifest,
): Promise<AudioActionsResult> {
  if (!(await audioAvailable())) {
    return {
      available: false,
      reason:
        'Sound device actions are unavailable: they use Windows Core Audio, and this is not Windows.',
    };
  }

  registry.extendPlugin(MEDIA_PLUGIN_ID, audioActions, {
    'media.set-default-device': async (params) => {
      const role = params['role'] === 'communications' ? 'communications' : 'default';
      await setDefaultDevice(stringParam(params, 'device'), role);
    },

    'media.set-app-volume': async (params) => {
      await setSessionVolume(stringParam(params, 'app'), { set: numberParam(params, 'volume', 50) });
    },

    'media.adjust-app-volume': async (params) => {
      await setSessionVolume(stringParam(params, 'app'), { by: numberParam(params, 'by', 10) });
    },

    'media.mute-app': async (params) => {
      const mode = params['mode'];
      await setSessionVolume(stringParam(params, 'app'), {
        mute: mode === 'on' ? 'on' : mode === 'off' ? 'off' : 'toggle',
      });
    },

    'media.set-app-device': async (params) => {
      const device = typeof params['device'] === 'string' ? params['device'] : '';
      // An empty id is how Windows is told to stop routing this program, and
      // both the chosen word and an unfilled field mean exactly that.
      const endpoint = device === SYSTEM_DEFAULT ? '' : device;
      await setAppDevice(stringParam(params, 'app'), endpoint, directionOf(params));
    },
  });

  /*
   * Speech rides with the rest, and is gated with it.
   *
   * Both are Windows-only today, so one gate is honest and two would be two
   * ways of saying the same thing. The day a synthesiser arrives for anything
   * else is the day this needs a gate of its own — and it will be obvious,
   * because it is the day `speechAvailable` stops agreeing with
   * `audioAvailable`.
   */
  if (speechAvailable()) {
    registry.extendPlugin(MEDIA_PLUGIN_ID, speechActions, {
      // Returns as soon as the phrase is accepted, not when it has been read
      // out: a key press must not wait several seconds for a sentence.
      'media.speak': (params) =>
        speak({
          text: stringParam(params, 'text'),
          ...(typeof params['voice'] === 'string' && params['voice'] !== ''
            ? { voice: params['voice'] }
            : {}),
          rate: numberParam(params, 'rate', 0),
          volume: numberParam(params, 'volume', 100),
          interrupt: params['busy'] === 'interrupt',
        }),

      'media.stop-speaking': () => stopSpeaking(),
    });
  }

  // Installed with the variables it publishes; the actions above are the
  // registry's business and these are the runtime's.
  await runtime.install({ ...manifest, variables: audioVariables }, new AudioPlugin());

  const routing = await appRoutingAvailable();
  return {
    available: true,
    ...(routing
      ? {}
      : {
          reason:
            'Sending one application to its own sound device is not available on this version of Windows; everything else works.',
        }),
  };
}

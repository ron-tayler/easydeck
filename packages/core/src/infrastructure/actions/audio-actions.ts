import { numberParam, stringParam } from '@easydeck/engine';
import type {
  ActionDefinition,
  ActionRegistry,
  ParamOption,
  Plugin,
  PluginHost,
  PluginManifest,
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
        optionsFrom: 'devices',
        required: false,
        description: {
          en: 'Leave empty to put it back on the system default',
          ru: 'Оставьте пустым, чтобы вернуть системное умолчание',
        },
      },
    ],
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
  private timer?: NodeJS.Timeout;

  start(host: PluginHost): void {
    host.provideOptions('devices', async (params) => {
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
    });

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
    this.timer = setInterval(() => void this.readDefaults(host), POLL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
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
      await setAppDevice(stringParam(params, 'app'), device, directionOf(params));
    },
  });

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

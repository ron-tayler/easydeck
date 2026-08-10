import { PLUGIN_API_VERSION } from '@easydeck/engine';
import type { ActionRegistry, PluginManifest } from '@easydeck/engine';

import { loadKeyboardBackend } from './keyboard-actions.js';

/**
 * The transport controls every keyboard has and no keyboard has room for.
 *
 * They are hotkeys underneath — the same native backend presses them — but a
 * plugin of their own rather than two lines in the system one, because "next
 * track" is a thing a person wants, while "press AudioNext" is a thing they
 * would have to know. Nothing here asks for parameters: that is the point.
 *
 * Which player answers is up to the operating system, not to us. Windows and
 * macOS route these keys to whatever last played, so the same button works for
 * Spotify, a browser tab and a media player without being told which.
 */

/** nut.js key names, which are the media keys as the OS knows them. */
const MEDIA_KEYS = {
  'media.play-pause': 'AudioPlay',
  'media.stop': 'AudioStop',
  'media.previous': 'AudioPrev',
  'media.next': 'AudioNext',
  'media.volume-up': 'AudioVolUp',
  'media.volume-down': 'AudioVolDown',
  'media.mute': 'AudioMute',
} as const;

export const MEDIA_PLUGIN_ID = 'media';

export const mediaManifest: PluginManifest = {
  id: MEDIA_PLUGIN_ID,
  name: { en: 'Media', ru: 'Мультимедиа' },
  description: {
    en: 'Playback and volume, wherever the sound is coming from',
    ru: 'Воспроизведение и громкость — там, где сейчас играет звук',
  },
  version: '1.0.0',
  apiVersion: PLUGIN_API_VERSION,
  builtIn: true,
  actions: [
    {
      type: 'media.play-pause',
      icon: 'play-pause',
      label: { en: 'Play / pause', ru: 'Пауза / продолжить' },
      params: [],
    },
    { type: 'media.stop', icon: 'stop', label: { en: 'Stop', ru: 'Стоп' }, params: [] },
    {
      type: 'media.previous',
      icon: 'previous',
      label: { en: 'Previous track', ru: 'Прошлая песня' },
      params: [],
    },
    {
      type: 'media.next',
      icon: 'next',
      label: { en: 'Next track', ru: 'Следующая песня' },
      params: [],
    },
    {
      type: 'media.volume-up',
      icon: 'volume-up',
      label: { en: 'Volume up', ru: 'Прибавить громкость' },
      params: [],
    },
    {
      type: 'media.volume-down',
      icon: 'volume-down',
      label: { en: 'Volume down', ru: 'Убавить громкость' },
      params: [],
    },
    { type: 'media.mute', icon: 'mute', label: { en: 'Mute', ru: 'Без звука' }, params: [] },
  ],
};

export interface MediaActionsResult {
  readonly available: boolean;
  readonly reason?: string;
}

/**
 * Registers the transport controls, or reports why it could not.
 *
 * Shares the keyboard's optional native backend, and shares its fate: without
 * it there is no way to press a key, so the actions are left unregistered
 * rather than registered and silently doing nothing.
 */
export async function registerMediaActions(registry: ActionRegistry): Promise<MediaActionsResult> {
  const backend = await loadKeyboardBackend();

  if (!backend) {
    return {
      available: false,
      reason:
        'Media actions are unavailable: they press the media keys, which needs the same ' +
        "optional dependency '@nut-tree-fork/nut-js' as the keyboard actions.",
    };
  }

  const handlers = Object.fromEntries(
    Object.entries(MEDIA_KEYS).map(([type, name]) => [
      type,
      async () => {
        const key = backend.Key[name];
        if (typeof key !== 'number') throw new Error(`This machine has no ${name} key`);

        await backend.keyboard.pressKey(key);
        await backend.keyboard.releaseKey(key);
      },
    ]),
  );

  registry.installPlugin(mediaManifest, handlers);
  return { available: true };
}

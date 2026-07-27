import type { Surface } from '@easydeck/device';
import { PLUGIN_API_VERSION, numberParam } from '@easydeck/engine';
import type { ActionRegistry, PluginManifest } from '@easydeck/engine';

/**
 * The deck plugin: the device itself.
 *
 * One of the two root plugins. Everything here speaks to the hardware rather
 * than to EasyDeck, which is why brightness lives apart from page navigation
 * even though both ship in the box.
 */
export const DECK_PLUGIN_ID = 'deck';

export const deckManifest: PluginManifest = {
  id: DECK_PLUGIN_ID,
  name: { en: 'Stream deck', ru: 'Дека' },
  description: {
    en: 'Controls the device itself: backlight and power',
    ru: 'Управление самим устройством: подсветка и питание',
  },
  version: '1.0.0',
  apiVersion: PLUGIN_API_VERSION,
  builtIn: true,
  actions: [
    {
      type: 'deck.set-brightness',
      label: { en: 'Set brightness', ru: 'Задать яркость' },
      params: [
        {
          name: 'percent',
          type: 'number',
          label: { en: 'Brightness', ru: 'Яркость' },
          min: 0,
          max: 100,
          default: 60,
        },
      ],
    },
    {
      type: 'deck.sleep-panel',
      label: { en: 'Sleep', ru: 'Усыпить' },
      description: {
        en: 'Turns the panel off. Any key press wakes it',
        ru: 'Гасит панель. Любое нажатие её будит',
      },
    },
    {
      type: 'deck.wake-panel',
      label: { en: 'Wake', ru: 'Разбудить' },
    },
  ],
};

export function registerDeviceActions(registry: ActionRegistry, surface: Surface): ActionRegistry {
  return registry.installPlugin(deckManifest, {
    'deck.set-brightness': (params) => surface.setBrightness(numberParam(params, 'percent', 60)),
    'deck.sleep-panel': () => surface.sleep(),
    'deck.wake-panel': () => surface.wake(),
  });
}

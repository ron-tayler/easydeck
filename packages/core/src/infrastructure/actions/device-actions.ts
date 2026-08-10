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
  /*
   * The first plugin variable, and the pattern the rest will follow: the deck
   * publishes what it knows so a profile can show it. A key labelled
   * `{{deck.brightness}}` now reads the real value, and one bound to it as a
   * carousel steps through levels — neither of which the profile could do by
   * declaring a variable of its own, because nothing would keep it in step.
   */
  variables: [
    {
      name: 'deck.brightness',
      type: 'number',
      label: { en: 'Backlight, %', ru: 'Подсветка, %' },
    },
  ],
  actions: [
    {
      type: 'deck.set-brightness',
      icon: 'brightness',
      label: { en: 'Brightness', ru: 'Яркость' },
      params: [
        /*
         * Relative modes are what make one button useful twice: "brighter" and
         * "dimmer" are a pair anyone expects, and an absolute-only action
         * forces a separate button per level instead.
         *
         * The parameter is added rather than the action split in three, so
         * profiles written before this keep working: no `mode` means `set`,
         * which is exactly what they did.
         */
        {
          name: 'mode',
          type: 'select',
          label: { en: 'Change', ru: 'Изменение' },
          options: [
            { value: 'set', label: { en: 'Set to', ru: 'Задать' } },
            { value: 'increase', label: { en: 'Increase by', ru: 'Прибавить' } },
            { value: 'decrease', label: { en: 'Decrease by', ru: 'Убавить' } },
          ],
          default: 'set',
        },
        {
          name: 'percent',
          type: 'number',
          label: { en: 'Value, %', ru: 'Значение, %' },
          min: 0,
          max: 100,
          default: 60,
        },
      ],
    },
    {
      type: 'deck.sleep-panel',
      icon: 'sleep',
      label: { en: 'Sleep', ru: 'Усыпить' },
      description: {
        en: 'Turns the panel off. Any key press wakes it',
        ru: 'Гасит панель. Любое нажатие её будит',
      },
    },
    {
      type: 'deck.wake-panel',
      icon: 'wake',
      label: { en: 'Wake', ru: 'Разбудить' },
    },
  ],
};

/**
 * Where brightness is kept, so a relative change has something to be relative
 * to.
 *
 * Deliberately not tracked inside this module: the same value is also changed
 * from the configurator and persisted to settings, and two copies of it would
 * disagree the moment either side moved. Reading and writing through one owner
 * is what makes "increase by 10" mean what it says after the user has dragged
 * the slider.
 */
export interface BrightnessControl {
  current(): number;
  set(percent: number): Promise<void>;
}

/**
 * Finds the panel a press came from.
 *
 * Several decks run at once, so "sleep the panel" has to mean the panel the
 * user touched — not the first one that happened to be opened. Returns
 * undefined for a deck with no hardware behind it, such as a tablet across the
 * network, whose backlight is not ours to switch off.
 */
export type PanelLookup = (deckId: string) => Surface | undefined;

export function registerDeviceActions(
  registry: ActionRegistry,
  panels: PanelLookup,
  brightness: BrightnessControl,
): ActionRegistry {
  return registry.installPlugin(deckManifest, {
    'deck.set-brightness': async (params) => {
      const value = numberParam(params, 'percent', 60);
      const mode = params['mode'];

      // Clamping is the owner's job: it is the same rule whether the value
      // arrives from a button, the configurator or a stored setting.
      await brightness.set(
        mode === 'increase'
          ? brightness.current() + value
          : mode === 'decrease'
            ? brightness.current() - value
            : value,
      );
    },

    /*
     * Addressed to the deck the press came from. Brightness, by contrast, is
     * still one setting for the whole machine — a per-deck backlight is a
     * setting nobody has asked for, and one number is easier to explain than
     * a number per panel.
     */
    'deck.sleep-panel': async (_params, context) => panels(context.deckId)?.sleep(),
    'deck.wake-panel': async (_params, context) => panels(context.deckId)?.wake(),
  });
}

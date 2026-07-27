import { numberParam, stringParam, valueParam } from '../domain/action.js';
import { PLUGIN_API_VERSION } from '../domain/plugin.js';
import type { PluginManifest } from '../domain/plugin.js';
import type { ActionRegistry } from './action-registry.js';

/**
 * The EasyDeck plugin: navigation, variables and button state.
 *
 * Everything is a plugin, including this one — it simply ships in the box and
 * runs in-process. A profile cannot tell the difference between its actions
 * and a third party's, and neither can the configurator, which is the point:
 * whatever built-ins can do, plugins can do.
 *
 * Nothing here touches the outside world, which is what keeps the engine
 * testable without mocking an operating system. The parts of this same plugin
 * that need the filesystem live in the host — a plugin is a namespace and a
 * manifest, not necessarily one module.
 */
export const EASYDECK_PLUGIN_ID = 'easydeck';

export const easydeckManifest: PluginManifest = {
  id: EASYDECK_PLUGIN_ID,
  name: { en: 'EasyDeck', ru: 'EasyDeck' },
  description: {
    en: 'Navigation, variables and button states',
    ru: 'Навигация, переменные и состояния кнопок',
  },
  version: '1.0.0',
  apiVersion: PLUGIN_API_VERSION,
  builtIn: true,
  actions: [
    {
      type: 'easydeck.open-folder',
      label: { en: 'Open folder', ru: 'Открыть папку' },
      description: {
        en: 'Enters a scene, landing on its first page',
        ru: 'Переходит в сцену, на её первую страницу',
      },
      group: { en: 'Navigation', ru: 'Навигация' },
      params: [
        {
          name: 'folderId',
          type: 'profile-folder',
          label: { en: 'Folder', ru: 'Папка' },
        },
      ],
    },
    {
      type: 'easydeck.go-to-page',
      label: { en: 'Go to page', ru: 'Перейти на страницу' },
      group: { en: 'Navigation', ru: 'Навигация' },
      params: [
        {
          name: 'pageId',
          type: 'profile-page',
          label: { en: 'Page', ru: 'Страница' },
        },
      ],
    },
    {
      type: 'easydeck.go-up',
      label: { en: 'Go up', ru: 'На уровень вверх' },
      description: {
        en: 'Leaves for the parent folder. Does nothing at the top level',
        ru: 'Возвращает в родительскую папку. На верхнем уровне ничего не делает',
      },
      group: { en: 'Navigation', ru: 'Навигация' },
    },
    {
      type: 'easydeck.go-home',
      label: { en: 'Go home', ru: 'В начало' },
      group: { en: 'Navigation', ru: 'Навигация' },
    },
    {
      type: 'easydeck.go-back',
      label: { en: 'Go back', ru: 'Назад' },
      description: {
        en: 'Returns to the previous location',
        ru: 'Возвращает туда, где вы были до этого',
      },
      group: { en: 'Navigation', ru: 'Навигация' },
    },

    {
      type: 'easydeck.set-variable',
      label: { en: 'Set variable', ru: 'Задать переменную' },
      group: { en: 'Variables', ru: 'Переменные' },
      params: [
        { name: 'name', type: 'variable', label: { en: 'Variable', ru: 'Переменная' } },
        { name: 'value', type: 'string', label: { en: 'Value', ru: 'Значение' } },
      ],
    },
    {
      type: 'easydeck.toggle-variable',
      label: { en: 'Toggle variable', ru: 'Переключить переменную' },
      group: { en: 'Variables', ru: 'Переменные' },
      params: [{ name: 'name', type: 'variable', label: { en: 'Variable', ru: 'Переменная' } }],
    },
    {
      type: 'easydeck.increment-variable',
      label: { en: 'Add to variable', ru: 'Прибавить к переменной' },
      group: { en: 'Variables', ru: 'Переменные' },
      params: [
        { name: 'name', type: 'variable', label: { en: 'Variable', ru: 'Переменная' } },
        {
          name: 'by',
          type: 'number',
          label: { en: 'Amount', ru: 'На сколько' },
          required: false,
          default: 1,
        },
      ],
    },
    {
      type: 'easydeck.cycle-variable',
      label: { en: 'Cycle variable', ru: 'Перебрать значения' },
      description: {
        en: 'Steps through a list of values, wrapping around',
        ru: 'Переключает значения по кругу',
      },
      group: { en: 'Variables', ru: 'Переменные' },
      params: [
        { name: 'name', type: 'variable', label: { en: 'Variable', ru: 'Переменная' } },
        {
          name: 'values',
          type: 'text',
          label: { en: 'Values', ru: 'Значения' },
          placeholder: { en: 'One per line', ru: 'По одному в строке' },
        },
      ],
    },

    {
      type: 'easydeck.set-button-state',
      label: { en: 'Set button state', ru: 'Задать состояние кнопки' },
      group: { en: 'Buttons', ru: 'Кнопки' },
      params: [
        { name: 'stateId', type: 'string', label: { en: 'State', ru: 'Состояние' } },
        {
          name: 'buttonId',
          type: 'string',
          label: { en: 'Button', ru: 'Кнопка' },
          description: {
            en: 'Leave empty for the button being pressed',
            ru: 'Оставьте пустым, чтобы менять нажатую кнопку',
          },
          required: false,
        },
      ],
    },
  ],
};

export function registerBuiltinActions(registry: ActionRegistry): ActionRegistry {
  return registry.installPlugin(easydeckManifest, {
    // Navigation. Nothing moves on its own; a user places these on buttons.
    'easydeck.open-folder': (params, ctx) => ctx.openFolder(stringParam(params, 'folderId')),
    'easydeck.go-to-page': (params, ctx) => ctx.goToPage(stringParam(params, 'pageId')),
    'easydeck.go-up': (_params, ctx) => ctx.goUp(),
    'easydeck.go-home': (_params, ctx) => ctx.goHome(),
    'easydeck.go-back': (_params, ctx) => ctx.goBack(),

    'easydeck.set-variable': (params, ctx) =>
      ctx.variables.set(stringParam(params, 'name'), valueParam(params, 'value')),
    'easydeck.toggle-variable': (params, ctx) => ctx.variables.toggle(stringParam(params, 'name')),
    'easydeck.increment-variable': (params, ctx) =>
      ctx.variables.increment(stringParam(params, 'name'), numberParam(params, 'by', 1)),

    'easydeck.cycle-variable': (params, ctx) => {
      const name = stringParam(params, 'name');
      const values = toList(params['values']);
      if (values.length === 0) throw new TypeError("Parameter 'values' must not be empty");

      const current = ctx.variables.get(name);
      const index = values.findIndex((candidate) => candidate === current);
      ctx.variables.set(name, values[(index + 1) % values.length]!);
    },

    'easydeck.set-button-state': (params, ctx) => {
      // Defaulting to the pressed button makes the common self-toggle case a
      // one-parameter action.
      const buttonId = typeof params['buttonId'] === 'string' && params['buttonId'].length > 0
        ? params['buttonId']
        : ctx.button.id;
      ctx.setButtonState(buttonId, stringParam(params, 'stateId'));
    },
  });
}

/** Accepts either a real array or the newline-separated text a form produces. */
function toList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') {
    return value
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }
  return [];
}

import { numberParam, stringParam, valueParam } from '../domain/action.js';
import { PLUGIN_API_VERSION } from '../domain/plugin.js';
import type { PluginManifest } from '../domain/plugin.js';
import type { ActionRegistry } from './action-registry.js';

/**
 * The two plugins that come with the engine: getting about, and remembering
 * things.
 *
 * Everything is a plugin, including these — they simply ship in the box and
 * run in-process. A profile cannot tell the difference between their actions
 * and a third party's, and neither can the configurator, which is the point:
 * whatever built-ins can do, plugins can do.
 *
 * Two rather than one because they answer different questions. "Where am I"
 * and "what does this key remember" are not the same job, and a palette that
 * files them together makes the user read a list of nine to find either. The
 * split is also what the sections in the palette are for.
 *
 * Nothing here touches the outside world, which is what keeps the engine
 * testable without mocking an operating system. The parts that need a
 * filesystem live in the host — a plugin is a namespace and a manifest, not
 * necessarily one module.
 */
export const EASYDECK_PLUGIN_ID = 'easydeck';
export const VARIABLES_PLUGIN_ID = 'vars';

export const navigationManifest: PluginManifest = {
  id: EASYDECK_PLUGIN_ID,
  name: { en: 'Navigation', ru: 'Навигация' },
  description: {
    en: 'Moving between scenes and pages',
    ru: 'Переходы между сценами и страницами',
  },
  version: '1.0.0',
  apiVersion: PLUGIN_API_VERSION,
  builtIn: true,
  actions: [
    {
      type: 'easydeck.open-folder',
      icon: 'folder',
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
      icon: 'page',
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
      icon: 'up',
      label: { en: 'Go up', ru: 'На уровень вверх' },
      description: {
        en: 'Leaves for the parent folder. Does nothing at the top level',
        ru: 'Возвращает в родительскую папку. На верхнем уровне ничего не делает',
      },
      group: { en: 'Navigation', ru: 'Навигация' },
    },
    {
      type: 'easydeck.go-home',
      icon: 'home',
      label: { en: 'Go home', ru: 'В начало' },
      group: { en: 'Navigation', ru: 'Навигация' },
    },
    {
      type: 'easydeck.go-back',
      icon: 'back',
      label: { en: 'Go back', ru: 'Назад' },
      description: {
        en: 'Returns to the previous location',
        ru: 'Возвращает туда, где вы были до этого',
      },
      group: { en: 'Navigation', ru: 'Навигация' },
    },
  ],
};

export const variablesManifest: PluginManifest = {
  id: VARIABLES_PLUGIN_ID,
  name: { en: 'Variables', ru: 'Переменные' },
  description: {
    en: 'Values a deck remembers, and the states that follow them',
    ru: 'Значения, которые дека помнит, и состояния кнопок',
  },
  version: '1.0.0',
  apiVersion: PLUGIN_API_VERSION,
  builtIn: true,
  actions: [
    {
      type: 'vars.set-variable',
      icon: 'variable',
      label: { en: 'Set variable', ru: 'Задать переменную' },
      group: { en: 'Variables', ru: 'Переменные' },
      params: [
        { name: 'name', type: 'variable', label: { en: 'Variable', ru: 'Переменная' } },
        { name: 'value', type: 'string', label: { en: 'Value', ru: 'Значение' } },
      ],
    },
    {
      type: 'vars.toggle-variable',
      icon: 'toggle',
      label: { en: 'Toggle variable', ru: 'Переключить переменную' },
      group: { en: 'Variables', ru: 'Переменные' },
      params: [{ name: 'name', type: 'variable', label: { en: 'Variable', ru: 'Переменная' } }],
    },
    {
      type: 'vars.increment-variable',
      icon: 'increment',
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
      type: 'vars.cycle-variable',
      icon: 'cycle',
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
      type: 'vars.set-button-state',
      icon: 'state',
      label: { en: 'Set button state', ru: 'Задать состояние кнопки' },
      group: { en: 'Buttons', ru: 'Кнопки' },
      params: [
        {
          // Declared before the state, because the state's choices depend on
          // which button is picked here.
          name: 'buttonId',
          type: 'profile-button',
          label: { en: 'Button', ru: 'Кнопка' },
          description: {
            en: 'Leave empty for the button being pressed',
            ru: 'Оставьте пустым, чтобы менять нажатую кнопку',
          },
          required: false,
        },
        { name: 'stateId', type: 'button-state', label: { en: 'State', ru: 'Состояние' } },
      ],
    },
  ],
};

export function registerBuiltinActions(registry: ActionRegistry): ActionRegistry {
  // Navigation. Nothing moves on its own; a user places these on buttons.
  registry.installPlugin(navigationManifest, {
    'easydeck.open-folder': (params, ctx) => ctx.openFolder(stringParam(params, 'folderId')),
    'easydeck.go-to-page': (params, ctx) => ctx.goToPage(stringParam(params, 'pageId')),
    'easydeck.go-up': (_params, ctx) => ctx.goUp(),
    'easydeck.go-home': (_params, ctx) => ctx.goHome(),
    'easydeck.go-back': (_params, ctx) => ctx.goBack(),
  });

  return registry.installPlugin(variablesManifest, {
    'vars.set-variable': (params, ctx) =>
      ctx.variables.set(stringParam(params, 'name'), valueParam(params, 'value')),
    'vars.toggle-variable': (params, ctx) => ctx.variables.toggle(stringParam(params, 'name')),
    'vars.increment-variable': (params, ctx) =>
      ctx.variables.increment(stringParam(params, 'name'), numberParam(params, 'by', 1)),

    'vars.cycle-variable': (params, ctx) => {
      const name = stringParam(params, 'name');
      const values = toList(params['values']);
      if (values.length === 0) throw new TypeError("Parameter 'values' must not be empty");

      const current = ctx.variables.get(name);
      const index = values.findIndex((candidate) => candidate === current);
      ctx.variables.set(name, values[(index + 1) % values.length]!);
    },

    'vars.set-button-state': (params, ctx) => {
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

import { PLUGIN_API_VERSION, stringParam } from '@easydeck/engine';
import type { ActionRegistry, PluginManifest } from '@easydeck/engine';

import { loadUnicodeTyper } from './win32-typing.js';

/**
 * Keyboard emulation, registered only when the native backend is present.
 *
 * Pressing keys needs a native module, and the cross-platform options are
 * poor: the original nut.js was withdrawn from public npm, robotjs is
 * unmaintained and no longer builds on current Node, and keysender is Windows
 * only. So the community fork is an *optional* dependency and this module
 * loads it dynamically — a machine where the native build fails still gets a
 * fully working daemon, minus these two actions.
 */

interface NutKeyboard {
  pressKey(...keys: number[]): Promise<unknown>;
  releaseKey(...keys: number[]): Promise<unknown>;
  type(text: string): Promise<unknown>;
  config: { autoDelayMs: number };
}

interface NutModule {
  keyboard: NutKeyboard;
  Key: Record<string, number>;
}

/** Spellings a profile author might reasonably use, mapped to nut.js names. */
const ALIASES: Record<string, string> = {
  ctrl: 'LeftControl',
  control: 'LeftControl',
  alt: 'LeftAlt',
  option: 'LeftAlt',
  shift: 'LeftShift',
  win: 'LeftSuper',
  cmd: 'LeftSuper',
  command: 'LeftSuper',
  super: 'LeftSuper',
  meta: 'LeftSuper',
  esc: 'Escape',
  del: 'Delete',
  ins: 'Insert',
  pgup: 'PageUp',
  pgdn: 'PageDown',
  enter: 'Return',
  ' ': 'Space',
};

/**
 * Gap between pressing and releasing a combination.
 *
 * Not zero: a press and release landing in the same millisecond is ignored by
 * a lot of applications, which is indistinguishable from the hotkey silently
 * not working. Small enough that nobody notices it on a deck.
 */
const KEY_HOLD_MS = 25;

let cached: NutModule | null | undefined;

/** Loads the native backend once; null means it is unavailable. */
async function loadBackend(): Promise<NutModule | null> {
  if (cached !== undefined) return cached;

  try {
    // Not a static import: the package is optional and may be absent.
    cached = (await import('@nut-tree-fork/nut-js')) as unknown as NutModule;
    // The default is 300ms per keystroke, which feels broken on a deck.
    cached.keyboard.config.autoDelayMs = 5;
  } catch {
    cached = null;
  }

  return cached;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function resolveKey(module: NutModule, token: string): number {
  const trimmed = token.trim();
  if (trimmed.length === 0) throw new Error('Empty key in hotkey');

  const alias = ALIASES[trimmed.toLowerCase()];
  const candidates = [
    alias,
    trimmed,
    trimmed.toUpperCase(),
    trimmed[0]!.toUpperCase() + trimmed.slice(1).toLowerCase(),
  ].filter((name): name is string => typeof name === 'string');

  for (const name of candidates) {
    const value = module.Key[name];
    if (typeof value === 'number') return value;
  }

  throw new Error(`Unknown key '${token}' in hotkey`);
}

export const keyboardManifest: PluginManifest = {
  id: 'keyboard',
  name: { en: 'Keyboard', ru: 'Клавиатура' },
  description: {
    en: 'Sends key combinations and types text',
    ru: 'Отправляет сочетания клавиш и печатает текст',
  },
  version: '1.0.0',
  apiVersion: PLUGIN_API_VERSION,
  builtIn: true,
  actions: [
    {
      type: 'keyboard.hotkey',
      label: { en: 'Press hotkey', ru: 'Нажать сочетание' },
      params: [
        {
          name: 'keys',
          type: 'hotkey',
          label: { en: 'Combination', ru: 'Сочетание' },
          placeholder: { en: 'ctrl+shift+m' },
        },
      ],
    },
    {
      type: 'keyboard.type-text',
      label: { en: 'Type text', ru: 'Напечатать текст' },
      params: [{ name: 'text', type: 'text', label: { en: 'Text', ru: 'Текст' } }],
    },
  ],
};

export interface KeyboardActionsResult {
  readonly available: boolean;
  readonly reason?: string;
}

export async function registerKeyboardActions(
  registry: ActionRegistry,
): Promise<KeyboardActionsResult> {
  const backend = await loadBackend();
  const unicode = await loadUnicodeTyper();

  if (!backend) {
    return {
      available: false,
      reason:
        "Keyboard actions are unavailable: optional dependency '@nut-tree-fork/nut-js' " +
        'is not installed or failed to build. Everything else works.',
    };
  }

  registry.installPlugin(keyboardManifest, {
    'keyboard.hotkey': async (params) => {
      const combo = stringParam(params, 'keys');
      const keys = combo.split('+').map((token) => resolveKey(backend, token));

      await backend.keyboard.pressKey(...keys);
      await wait(KEY_HOLD_MS);
      // Release in reverse so modifiers outlive the key they modify.
      await backend.keyboard.releaseKey(...[...keys].reverse());
    },

    /**
     * Prefers the unicode path wherever it exists.
     *
     * The fallback presses the keys that *would* produce each character under
     * the layout that happens to be active, so the same profile types
     * different text depending on what the user last switched to. Where
     * Windows can be told the character directly, it is.
     */
    'keyboard.type-text': async (params) => {
      const text = stringParam(params, 'text');
      if (unicode) unicode.type(text);
      else await backend.keyboard.type(text);
    },
  });

  return { available: true };
}

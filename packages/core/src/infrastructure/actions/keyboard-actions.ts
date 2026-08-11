import { hotkeyProblem, orderedHotkey, parseHotkey, stringParam } from '@easydeck/engine';
import type { ActionDefinition, ActionRegistry } from '@easydeck/engine';

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

export interface NutKeyboard {
  /**
   * One key. The real signature is variadic and the extra arguments do not
   * work — see `pressCombination`.
   */
  pressKey(key: number): Promise<unknown>;
  releaseKey(key: number): Promise<unknown>;
  type(text: string): Promise<unknown>;
  config: { autoDelayMs: number };
}

export interface NutModule {
  keyboard: NutKeyboard;
  Key: Record<string, number>;
}

/**
 * Every key in the catalogue, as this backend spells it.
 *
 * The catalogue says which keys exist and what to call them in front of a
 * person; this says how to ask for one. Two tables rather than one because
 * the second belongs to whichever native module is doing the pressing — a
 * different backend would replace this file and leave the list alone.
 *
 * A test walks the catalogue and resolves every id, so the two cannot drift
 * apart without something going red.
 */
const NUT_NAMES: Readonly<Record<string, string>> = {
  ctrl: 'LeftControl',
  shift: 'LeftShift',
  alt: 'LeftAlt',
  win: 'LeftSuper',
  rctrl: 'RightControl',
  rshift: 'RightShift',
  ralt: 'RightAlt',
  rwin: 'RightSuper',

  escape: 'Escape',
  tab: 'Tab',
  capslock: 'CapsLock',
  space: 'Space',
  enter: 'Return',
  backspace: 'Backspace',
  delete: 'Delete',
  insert: 'Insert',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  printscreen: 'Print',
  scrolllock: 'ScrollLock',
  pause: 'Pause',
  menu: 'Menu',

  grave: 'Grave',
  minus: 'Minus',
  equal: 'Equal',
  leftbracket: 'LeftBracket',
  rightbracket: 'RightBracket',
  backslash: 'Backslash',
  semicolon: 'Semicolon',
  quote: 'Quote',
  comma: 'Comma',
  period: 'Period',
  slash: 'Slash',

  numlock: 'NumLock',
  numdivide: 'Divide',
  nummultiply: 'Multiply',
  numsubtract: 'Subtract',
  numadd: 'Add',
  // The keypad's own Return, which this backend calls `Enter` and the main one
  // `Return` — the one naming collision worth a line of explanation.
  numenter: 'Enter',
  numdecimal: 'Decimal',

  mute: 'AudioMute',
  volumedown: 'AudioVolDown',
  volumeup: 'AudioVolUp',
  play: 'AudioPlay',
  stop: 'AudioStop',
  previous: 'AudioPrev',
  next: 'AudioNext',

  // The digit row is `Num1`…`Num0` here, which is not the keypad.
  ...Object.fromEntries([...'1234567890'].map((digit) => [digit, `Num${digit}`])),
  ...Object.fromEntries([...'abcdefghijklmnopqrstuvwxyz'].map((letter) => [letter, letter.toUpperCase()])),
  ...Object.fromEntries(Array.from({ length: 24 }, (_, index) => [`f${index + 1}`, `F${index + 1}`])),
  ...Object.fromEntries(Array.from({ length: 10 }, (_, digit) => [`num${digit}`, `NumPad${digit}`])),
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

/**
 * Loads the native backend once; null means it is unavailable.
 *
 * Exported because the media actions press keys too, and loading the module
 * twice would mean two copies of a native addon and two chances to fail.
 */
export async function loadKeyboardBackend(): Promise<NutModule | null> {
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

/**
 * Holds a combination down, then lets it go.
 *
 * One key per call, which is the whole of why hotkeys never worked. The
 * backend's signature is variadic and reads as though it takes a combination —
 * `pressKey(Ctrl, Shift, M)` — and it does not: anything past the first
 * argument comes back as "Invalid key flag specified". A single key went
 * through, so the action looked half-alive: `f13` pressed, `ctrl+f13` failed,
 * and the failure only ever reached the log.
 *
 * Down in order and up in reverse, so a modifier is down before the key it
 * modifies and released after it.
 */
export async function pressCombination(module: NutModule, keys: readonly number[]): Promise<void> {
  const down: number[] = [];

  try {
    for (const key of keys) {
      await module.keyboard.pressKey(key);
      down.push(key);
    }

    await wait(KEY_HOLD_MS);
  } finally {
    // Released even when a key part-way through refused: leaving Ctrl stuck
    // down would make the machine unusable until somebody pressed it by hand.
    for (const key of [...down].reverse()) {
      await module.keyboard.releaseKey(key).catch(() => undefined);
    }
  }
}

export function resolveKey(module: NutModule, token: string): number {
  const trimmed = token.trim();
  if (trimmed.length === 0) throw new Error('Empty key in hotkey');

  const candidates = [
    NUT_NAMES[trimmed.toLowerCase()],
    // A name the backend itself uses, for a profile written against it
    // directly — `LeftSuper`, `NumPad7`. Nothing offers these, but nothing
    // gains from refusing them either.
    trimmed,
  ].filter((name): name is string => typeof name === 'string');

  for (const name of candidates) {
    const value = module.Key[name];
    if (typeof value === 'number') return value;
  }

  throw new Error(`There is no key called '${token}'`);
}

/**
 * Typing and key combinations, contributed to the system plugin.
 *
 * Not a plugin of their own any more: "press ctrl+S" and "run this program"
 * are the same kind of errand — telling the computer to do something a person
 * would otherwise do by hand — and two plugins of two actions each made the
 * palette longer without making anything easier to find.
 */
export const keyboardActions: ActionDefinition[] = [
    {
      type: 'system.hotkey',
      icon: 'keyboard',
      label: { en: 'Press hotkey', ru: 'Нажать сочетание' },
      params: [
        {
          name: 'keys',
          type: 'hotkey',
          label: { en: 'Combination', ru: 'Сочетание' },
          // No placeholder: the editor offers the keys as lists rather than
          // asking anybody to know how one is spelled.
        },
      ],
    },
    {
      type: 'system.type-text',
      icon: 'text',
      label: { en: 'Type text', ru: 'Напечатать текст' },
      params: [{ name: 'text', type: 'text', label: { en: 'Text', ru: 'Текст' } }],
    },
    {
      type: 'system.type-password',
      icon: 'password',
      label: { en: 'Type password', ru: 'Ввести пароль' },
      description: {
        en: 'The password is kept outside the profile and never leaves this machine.',
        ru: 'Пароль хранится вне профиля и не покидает этот компьютер.',
      },
      params: [
        {
          name: 'secret',
          type: 'password',
          label: { en: 'Password', ru: 'Пароль' },
        },
      ],
    },
];

export interface KeyboardActionsResult {
  readonly available: boolean;
  readonly reason?: string;
}

/**
 * Where a password action gets its password.
 *
 * A port rather than the store itself: the only thing this file may do with a
 * secret is type it, and the narrower the way in, the harder it is to grow a
 * second use by accident.
 */
export interface SecretSource {
  read(reference: string): Promise<string | undefined>;
}

export async function registerKeyboardActions(
  registry: ActionRegistry,
  secrets?: SecretSource,
): Promise<KeyboardActionsResult> {
  const backend = await loadKeyboardBackend();
  const unicode = await loadUnicodeTyper();

  if (!backend) {
    return {
      available: false,
      reason:
        "Keyboard actions are unavailable: optional dependency '@nut-tree-fork/nut-js' " +
        'is not installed or failed to build. Everything else works.',
    };
  }

  registry.extendPlugin('system', keyboardActions, {
    'system.hotkey': async (params) => {
      const ids = parseHotkey(stringParam(params, 'keys'));

      // Refused with the reason rather than pressed halfway: an empty
      // combination used to reach the backend as an empty argument list, which
      // pressed nothing and said nothing.
      const problem = hotkeyProblem(ids);
      if (problem) throw new Error(`${problem}. Choose the keys in the button editor`);

      const keys = orderedHotkey(ids).map((id) => resolveKey(backend, id));

      await pressCombination(backend, keys);
    },

    'system.type-text': async (params) => {
      const text = stringParam(params, 'text');
      await typeText(text);
    },

    /**
     * Types a password the profile does not hold.
     *
     * The parameter is a reference; the password is fetched at the moment it
     * is typed and not kept anywhere afterwards. Nothing here logs it, and the
     * errors are careful to name the button rather than what is in it.
     */
    'system.type-password': async (params) => {
      const reference = stringParam(params, 'secret');
      if (!secrets) throw new Error('Passwords are unavailable: no secret store was configured');

      const password = await secrets.read(reference);
      if (password === undefined || password === '') {
        throw new Error('No password is set for this button. Set it in the button editor');
      }

      await typeText(password);
    },
  });

  /**
   * Prefers the unicode path wherever it exists.
   *
   * The fallback presses the keys that *would* produce each character under
   * the layout that happens to be active, so the same profile types different
   * text depending on what the user last switched to. Where Windows can be
   * told the character directly, it is — which matters more for a password
   * than for anything else, since nobody sees what was typed.
   */
  async function typeText(text: string): Promise<void> {
    if (unicode) unicode.type(text);
    else await backend!.keyboard.type(text);
  }

  return { available: true };
}

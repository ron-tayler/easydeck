import type { LocalizedText } from './plugin.js';

/**
 * Every key a hotkey may name, and what to call it.
 *
 * A combination used to be typed as text — `ctrl+shift+m` — and parsed with a
 * table of spellings somebody might reasonably use. That is a guess about what
 * a person will write, and it fails quietly: an unknown name is only found out
 * when the key is pressed and nothing happens.
 *
 * So the keys are a list, offered as a list, and stored by id. A profile still
 * holds `ctrl+shift+m`, which reads well and survives being edited by hand;
 * the difference is that the ids in it come from here rather than from
 * whatever somebody typed.
 *
 * **Positions, not letters.** A key is pressed by where it sits on a US
 * keyboard, so `ctrl+m` is `ctrl+m` whatever layout is active — which is what
 * anyone binding a hotkey means. The labels are Latin for the same reason:
 * `М` and `M` are not two keys, and showing the Cyrillic letter of whatever
 * happens to be printed on the key would suggest otherwise.
 */

export type KeyGroup =
  | 'modifier'
  | 'letter'
  | 'digit'
  | 'function'
  | 'navigation'
  | 'symbol'
  | 'numpad'
  | 'media';

export interface KeyboardKey {
  /** What a profile stores, and what the backend is asked for. */
  readonly id: string;
  /** What the list shows. Latin, because the key is a position. */
  readonly label: LocalizedText;
  readonly group: KeyGroup;
}

/**
 * How many keys one combination may hold.
 *
 * Five is past anything in ordinary use — three or four is where real hotkeys
 * stop — and a keyboard's own hardware gives out somewhere near there anyway,
 * since a cheap membrane matrix cannot report more than a handful of
 * simultaneous keys. A limit that generous is a guard against a runaway list,
 * not a judgement about what somebody needs.
 */
export const MAX_HOTKEY_KEYS = 5;

/** Written out rather than generated, so each one can be labelled. */
const NAMED: readonly KeyboardKey[] = [
  { id: 'ctrl', label: { en: 'Ctrl' }, group: 'modifier' },
  { id: 'shift', label: { en: 'Shift' }, group: 'modifier' },
  { id: 'alt', label: { en: 'Alt' }, group: 'modifier' },
  { id: 'win', label: { en: 'Win', ru: 'Win' }, group: 'modifier' },
  { id: 'rctrl', label: { en: 'Right Ctrl', ru: 'Правый Ctrl' }, group: 'modifier' },
  { id: 'rshift', label: { en: 'Right Shift', ru: 'Правый Shift' }, group: 'modifier' },
  { id: 'ralt', label: { en: 'Right Alt (AltGr)', ru: 'Правый Alt (AltGr)' }, group: 'modifier' },
  { id: 'rwin', label: { en: 'Right Win', ru: 'Правый Win' }, group: 'modifier' },

  { id: 'escape', label: { en: 'Esc' }, group: 'navigation' },
  { id: 'tab', label: { en: 'Tab' }, group: 'navigation' },
  { id: 'capslock', label: { en: 'Caps Lock' }, group: 'navigation' },
  { id: 'space', label: { en: 'Space', ru: 'Пробел' }, group: 'navigation' },
  { id: 'enter', label: { en: 'Enter', ru: 'Ввод' }, group: 'navigation' },
  { id: 'backspace', label: { en: 'Backspace', ru: 'Backspace' }, group: 'navigation' },
  { id: 'delete', label: { en: 'Delete', ru: 'Delete' }, group: 'navigation' },
  { id: 'insert', label: { en: 'Insert' }, group: 'navigation' },
  { id: 'home', label: { en: 'Home' }, group: 'navigation' },
  { id: 'end', label: { en: 'End' }, group: 'navigation' },
  { id: 'pageup', label: { en: 'Page Up' }, group: 'navigation' },
  { id: 'pagedown', label: { en: 'Page Down' }, group: 'navigation' },
  { id: 'up', label: { en: 'Up', ru: 'Вверх' }, group: 'navigation' },
  { id: 'down', label: { en: 'Down', ru: 'Вниз' }, group: 'navigation' },
  { id: 'left', label: { en: 'Left', ru: 'Влево' }, group: 'navigation' },
  { id: 'right', label: { en: 'Right', ru: 'Вправо' }, group: 'navigation' },
  { id: 'printscreen', label: { en: 'Print Screen' }, group: 'navigation' },
  { id: 'scrolllock', label: { en: 'Scroll Lock' }, group: 'navigation' },
  { id: 'pause', label: { en: 'Pause' }, group: 'navigation' },
  { id: 'menu', label: { en: 'Menu', ru: 'Контекстное меню' }, group: 'navigation' },

  // Labelled with the character a US keyboard prints, since that is what
  // anybody reading a hotkey expects to see.
  { id: 'grave', label: { en: '` ~' }, group: 'symbol' },
  { id: 'minus', label: { en: '- _' }, group: 'symbol' },
  { id: 'equal', label: { en: '= +' }, group: 'symbol' },
  { id: 'leftbracket', label: { en: '[ {' }, group: 'symbol' },
  { id: 'rightbracket', label: { en: '] }' }, group: 'symbol' },
  { id: 'backslash', label: { en: '\\ |' }, group: 'symbol' },
  { id: 'semicolon', label: { en: '; :' }, group: 'symbol' },
  { id: 'quote', label: { en: "' \"" }, group: 'symbol' },
  { id: 'comma', label: { en: ', <' }, group: 'symbol' },
  { id: 'period', label: { en: '. >' }, group: 'symbol' },
  { id: 'slash', label: { en: '/ ?' }, group: 'symbol' },

  { id: 'numlock', label: { en: 'Num Lock' }, group: 'numpad' },
  { id: 'numdivide', label: { en: 'Numpad /' }, group: 'numpad' },
  { id: 'nummultiply', label: { en: 'Numpad *' }, group: 'numpad' },
  { id: 'numsubtract', label: { en: 'Numpad -' }, group: 'numpad' },
  { id: 'numadd', label: { en: 'Numpad +' }, group: 'numpad' },
  { id: 'numenter', label: { en: 'Numpad Enter' }, group: 'numpad' },
  { id: 'numdecimal', label: { en: 'Numpad .' }, group: 'numpad' },

  { id: 'mute', label: { en: 'Mute', ru: 'Выключить звук' }, group: 'media' },
  { id: 'volumedown', label: { en: 'Volume down', ru: 'Тише' }, group: 'media' },
  { id: 'volumeup', label: { en: 'Volume up', ru: 'Громче' }, group: 'media' },
  { id: 'play', label: { en: 'Play / pause', ru: 'Пуск / пауза' }, group: 'media' },
  { id: 'stop', label: { en: 'Stop', ru: 'Стоп' }, group: 'media' },
  { id: 'previous', label: { en: 'Previous track', ru: 'Предыдущий трек' }, group: 'media' },
  { id: 'next', label: { en: 'Next track', ru: 'Следующий трек' }, group: 'media' },
];

const LETTERS: readonly KeyboardKey[] = [...'abcdefghijklmnopqrstuvwxyz'].map((letter) => ({
  id: letter,
  label: { en: letter.toUpperCase() },
  group: 'letter' as const,
}));

const DIGITS: readonly KeyboardKey[] = [...'1234567890'].map((digit) => ({
  id: digit,
  label: { en: digit },
  group: 'digit' as const,
}));

const FUNCTION_KEYS: readonly KeyboardKey[] = Array.from({ length: 24 }, (_, index) => ({
  id: `f${index + 1}`,
  label: { en: `F${index + 1}` },
  group: 'function' as const,
}));

const NUMPAD_DIGITS: readonly KeyboardKey[] = Array.from({ length: 10 }, (_, digit) => ({
  id: `num${digit}`,
  label: { en: `Numpad ${digit}` },
  group: 'numpad' as const,
}));

/** Every key, in the order a list should offer them. */
export const KEYBOARD_KEYS: readonly KeyboardKey[] = [
  ...NAMED.filter((key) => key.group === 'modifier'),
  ...LETTERS,
  ...DIGITS,
  ...FUNCTION_KEYS,
  ...NAMED.filter((key) => key.group === 'navigation'),
  ...NAMED.filter((key) => key.group === 'symbol'),
  ...NAMED.filter((key) => key.group === 'numpad'),
  ...NUMPAD_DIGITS,
  ...NAMED.filter((key) => key.group === 'media'),
];

const BY_ID = new Map(KEYBOARD_KEYS.map((key) => [key.id, key]));

export function keyboardKey(id: string): KeyboardKey | undefined {
  return BY_ID.get(id.trim().toLowerCase());
}

/**
 * Older spellings, kept so a profile written by hand still works.
 *
 * These were the whole vocabulary before the list existed, and somebody's
 * profile is not a reason to break a button.
 */
const ALIASES: Readonly<Record<string, string>> = {
  control: 'ctrl',
  option: 'alt',
  cmd: 'win',
  command: 'win',
  super: 'win',
  meta: 'win',
  esc: 'escape',
  del: 'delete',
  ins: 'insert',
  pgup: 'pageup',
  pgdn: 'pagedown',
  return: 'enter',
  ' ': 'space',
  print: 'printscreen',
  prtsc: 'printscreen',
};

/** One stored combination as the ids it is made of. */
export function parseHotkey(value: string): string[] {
  return value
    .split('+')
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 0)
    .map((token) => ALIASES[token] ?? token);
}

export function formatHotkey(ids: readonly string[]): string {
  return ids.join('+');
}

/**
 * What is wrong with a combination, if anything.
 *
 * Shared by the window and the daemon so both say the same thing: a hotkey
 * refused when it is pressed, with the editor having raised no objection, is
 * the shape this feature failed in before.
 */
export function hotkeyProblem(ids: readonly string[]): string | undefined {
  if (ids.length === 0) return 'No keys chosen';
  if (ids.length > MAX_HOTKEY_KEYS) return `A combination may hold at most ${MAX_HOTKEY_KEYS} keys`;

  const unknown = ids.find((id) => !BY_ID.has(id));
  return unknown ? `There is no key called '${unknown}'` : undefined;
}

/**
 * The combination with its modifiers first.
 *
 * Order matters when the keys go down: an application watching for Ctrl+S sees
 * S arrive first if the list says so, and acts on a bare S. Stable otherwise,
 * so what somebody chose is what they get.
 */
export function orderedHotkey(ids: readonly string[]): string[] {
  const modifiers = ids.filter((id) => BY_ID.get(id)?.group === 'modifier');
  return [...modifiers, ...ids.filter((id) => !modifiers.includes(id))];
}

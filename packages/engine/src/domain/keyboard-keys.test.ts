import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  KEYBOARD_KEYS,
  MAX_HOTKEY_KEYS,
  formatHotkey,
  hotkeyProblem,
  keyboardKey,
  orderedHotkey,
  parseHotkey,
} from './keyboard-keys.js';

describe('the keys a hotkey may name', () => {
  it('offers the whole keyboard, each id only once', () => {
    const ids = KEYBOARD_KEYS.map((key) => key.id);
    assert.equal(new Set(ids).size, ids.length, 'a duplicate id would shadow a key');

    for (const id of ['ctrl', 'shift', 'alt', 'win', 'a', 'z', '1', '0', 'f1', 'f24', 'space', 'num7']) {
      assert.ok(keyboardKey(id), `expected the catalogue to hold '${id}'`);
    }
  });

  it('labels a letter by its Latin position, not by what is printed on it', () => {
    // A key is a place on the keyboard: `ctrl+m` is `ctrl+m` whatever layout
    // is active, and showing `М` would suggest there are two of them.
    assert.equal(keyboardKey('m')?.label.en, 'M');
    assert.equal(keyboardKey('m')?.label.ru, undefined);
  });
});

describe('reading a stored combination', () => {
  it('splits it and lets a profile written by hand keep working', () => {
    assert.deepEqual(parseHotkey('ctrl+shift+m'), ['ctrl', 'shift', 'm']);
    assert.deepEqual(parseHotkey('CTRL + M'), ['ctrl', 'm'], 'case and spaces are not a difference');
    assert.deepEqual(parseHotkey('control+esc'), ['ctrl', 'escape'], 'the older spellings');
    assert.deepEqual(parseHotkey('meta+return'), ['win', 'enter']);
  });

  it('reads back what it wrote', () => {
    assert.equal(formatHotkey(['ctrl', 'shift', 'm']), 'ctrl+shift+m');
    assert.deepEqual(parseHotkey(formatHotkey(['alt', 'f4'])), ['alt', 'f4']);
  });

  it('drops the empty slots an editor leaves behind', () => {
    assert.deepEqual(parseHotkey('ctrl++m'), ['ctrl', 'm']);
    assert.deepEqual(parseHotkey(''), []);
  });
});

describe('what is wrong with a combination', () => {
  it('says when there is nothing in it', () => {
    // Which is exactly how this failed before: a button bound to an empty
    // combination pressed nothing and reported nothing.
    assert.match(hotkeyProblem([]) ?? '', /No keys/);
  });

  it('names the key it does not know', () => {
    assert.match(hotkeyProblem(['ctrl', 'ctrl+m']) ?? '', /'ctrl\+m'/);
  });

  it('holds a single key, and stops at the limit', () => {
    assert.equal(hotkeyProblem(['f13']), undefined);
    assert.equal(hotkeyProblem(['ctrl', 'shift', 'alt', 'win', 'm']), undefined);
    assert.match(hotkeyProblem(['ctrl', 'shift', 'alt', 'win', 'm', 'n']) ?? '', /at most 5/);
    assert.equal(MAX_HOTKEY_KEYS, 5);
  });
});

describe('the order the keys go down in', () => {
  it('puts the modifiers first, whatever order they were chosen in', () => {
    // An application watching for Ctrl+S sees a bare S first otherwise, and
    // acts on it.
    assert.deepEqual(orderedHotkey(['s', 'ctrl']), ['ctrl', 's']);
    assert.deepEqual(orderedHotkey(['m', 'shift', 'ctrl']), ['shift', 'ctrl', 'm']);
  });

  it('leaves anything else where it was', () => {
    assert.deepEqual(orderedHotkey(['ctrl', 'k', 'd']), ['ctrl', 'k', 'd']);
  });
});

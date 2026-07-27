import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { referencedVariables, renderTemplate } from './template.js';
import { VariableStore } from './variables.js';
import type { VariableChange } from './variables.js';

describe('VariableStore', () => {
  it('notifies subscribers with the old and new value', () => {
    const store = new VariableStore({ mode: 'idle' });
    const seen: VariableChange[] = [];
    store.onChange((change) => seen.push(change));

    store.set('mode', 'live');

    assert.deepEqual(seen, [{ name: 'mode', value: 'live', previous: 'idle' }]);
  });

  it('stays silent when the value does not actually change', () => {
    // A polling action writing the same value every second must not repaint.
    const store = new VariableStore({ viewers: 12 });
    let calls = 0;
    store.onChange(() => calls++);

    store.set('viewers', 12);
    store.set('viewers', 13);

    assert.equal(calls, 1);
  });

  it('unsubscribes cleanly, even from inside a notification', () => {
    const store = new VariableStore();
    let calls = 0;
    const off = store.onChange(() => {
      calls++;
      off();
    });

    store.set('a', 1);
    store.set('a', 2);

    assert.equal(calls, 1);
  });

  it('toggles an unset variable to true', () => {
    const store = new VariableStore();
    store.toggle('mic');
    assert.equal(store.get('mic'), true);
    store.toggle('mic');
    assert.equal(store.get('mic'), false);
  });

  it('treats "false", "0" and empty string as falsy', () => {
    const store = new VariableStore({ a: 'false', b: '0', c: '', d: 'off', e: 0, f: 2 });

    assert.equal(store.truthy('a'), false);
    assert.equal(store.truthy('b'), false);
    assert.equal(store.truthy('c'), false);
    assert.equal(store.truthy('d'), true);
    assert.equal(store.truthy('e'), false);
    assert.equal(store.truthy('f'), true);
    assert.equal(store.truthy('missing'), false);
  });

  it('increments from unset and from a numeric string', () => {
    const store = new VariableStore({ b: '41' });

    store.increment('a');
    store.increment('b');
    store.increment('a', 4);

    assert.equal(store.get('a'), 5);
    assert.equal(store.get('b'), 42);
  });
});

describe('templates', () => {
  it('lists referenced variables once, in order', () => {
    assert.deepEqual(referencedVariables('{{a}} and {{ b }} and {{a}}'), ['a', 'b']);
  });

  it('substitutes values and renders unset variables as empty', () => {
    const text = renderTemplate('Зрителей: {{viewers}}{{missing}}', { viewers: 42 });
    assert.equal(text, 'Зрителей: 42');
  });

  it('leaves text without placeholders untouched', () => {
    assert.equal(renderTemplate('Сцена 1', { a: 1 }), 'Сцена 1');
  });

  it('ignores malformed placeholders rather than throwing', () => {
    assert.equal(renderTemplate('{{ }} {{1bad}} {a}', {}), '{{ }} {{1bad}} {a}');
  });
});

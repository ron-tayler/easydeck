import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ActionContext } from '../domain/action.js';
import { VariableStore } from '../domain/variables.js';
import { ActionRegistry } from './action-registry.js';

function contextWith(variables: Record<string, string | number | boolean>): ActionContext {
  return {
    variables: new VariableStore(variables),
    deckId: 'test',
    button: { id: 'b', key: 0 },
    location: { folderId: 'root', pageId: 'main' },
    profileId: 'p',
    openFolder() {},
    goToPage() {},
    goUp() {},
    goHome() {},
    goBack() {},
    setButtonState() {},
    setWidgetParam() {},
  };
}

describe('action parameters', () => {
  it('substitutes variables into text parameters', async () => {
    const registry = new ActionRegistry();
    let seen: unknown;
    registry.register('probe', (params) => {
      seen = params['text'];
    });

    await registry.run(
      { type: 'probe', params: { text: 'Hello {{who}}, you have {{count}}' } },
      contextWith({ who: 'world', count: 3 }),
    );

    assert.equal(seen, 'Hello world, you have 3');
  });

  it('leaves parameters without placeholders exactly as they are', async () => {
    const registry = new ActionRegistry();
    let seen: Record<string, unknown> | undefined;
    registry.register('probe', (params) => {
      seen = params;
    });

    const params = { text: 'plain text', delay: 250, loud: true };
    await registry.run({ type: 'probe', params }, contextWith({ who: 'world' }));

    assert.deepEqual(seen, params);
  });

  it('renders an unset variable as empty, as labels do', async () => {
    const registry = new ActionRegistry();
    let seen: unknown;
    registry.register('probe', (params) => {
      seen = params['text'];
    });

    await registry.run({ type: 'probe', params: { text: 'a{{missing}}b' } }, contextWith({}));

    assert.equal(seen, 'ab');
  });

  /**
   * Validation has to see the substituted value: a required parameter holding
   * only an unset variable is empty by the time the handler runs, and finding
   * that out inside the handler is exactly what validation exists to prevent.
   */
  it('validates the substituted value, not the template', async () => {
    const registry = new ActionRegistry();
    registry.installPlugin(
      {
        id: 'probe',
        name: { en: 'Probe' },
        version: '1.0.0',
        apiVersion: 1,
        actions: [
          {
            type: 'probe.run',
            label: { en: 'Run' },
            params: [{ name: 'text', type: 'text', label: { en: 'Text' } }],
          },
        ],
      },
      { 'probe.run': () => {} },
    );

    await assert.rejects(
      registry.run({ type: 'probe.run', params: { text: '{{missing}}' } }, contextWith({})),
      /needs the parameter 'text'/,
    );
  });
});

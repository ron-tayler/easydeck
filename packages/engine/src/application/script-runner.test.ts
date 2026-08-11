import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CORE_DELAY, CORE_FOR, CORE_IF } from '../domain/action.js';
import type { ActionContext, ActionDescriptor } from '../domain/action.js';
import type { VariableValue } from '../domain/variables.js';
import { MAX_REPEATS, MAX_STEPS, ScriptLimitError, runScript } from './script-runner.js';

/** Records what ran, which is the whole of what a script is judged by. */
function bench(values: Record<string, VariableValue> = {}, state = 'default') {
  const ran: string[] = [];
  const waited: number[] = [];
  const errors: Error[] = [];

  const context = {
    button: { id: 'b', key: 0 },
    buttonState: (buttonId?: string) => (buttonId === undefined || buttonId === 'b' ? state : 'other'),
  } as unknown as ActionContext;

  return {
    ran,
    waited,
    errors,
    context,
    host: {
      run: async (action: ActionDescriptor, where: ActionContext) => {
        if (action.type === 'boom') throw new Error('this step fails');
        // The loop counter travels in the context, so recording it here is
        // what proves a step inside a loop can see which pass it is on.
        const loop = where.locals?.['loop'];
        ran.push(loop === undefined ? action.type : `${action.type}:${String(loop)}`);
      },
      values: () => values,
      onError: (error: Error) => errors.push(error),
      wait: async (ms: number) => {
        waited.push(ms);
      },
    },
  };
}

const step = (type: string): ActionDescriptor => ({ type });

describe('running a script', () => {
  it('runs a plain list in order, as it always did', async () => {
    const bed = bench();
    await runScript([step('one'), step('two')], bed.context, bed.host);

    assert.deepEqual(bed.ran, ['one', 'two']);
  });

  it('carries on past a step that fails, and says which', async () => {
    // One bad action must not cost the rest of what somebody asked for; the
    // key shows a warning instead.
    const bed = bench();
    await runScript([step('one'), step('boom'), step('two')], bed.context, bed.host);

    assert.deepEqual(bed.ran, ['one', 'two']);
    assert.equal(bed.errors.length, 1);
  });

  it('waits where a delay says to', async () => {
    const bed = bench();
    await runScript([step('one'), { type: CORE_DELAY, params: { ms: 250 } }, step('two')], bed.context, bed.host);

    assert.deepEqual(bed.waited, [250]);
    assert.deepEqual(bed.ran, ['one', 'two']);
  });
});

describe('if', () => {
  const branch = (when: unknown, then: string, otherwise?: string): ActionDescriptor => ({
    type: CORE_IF,
    params: { when },
    branches: { then: [step(then)], ...(otherwise ? { else: [step(otherwise)] } : {}) },
  });

  it('takes the branch its condition points at', async () => {
    const bed = bench({ 'hw.cpu': 95 });

    await runScript(
      [branch({ source: 'variable', name: 'hw.cpu', operator: '>=', value: 90 }, 'hot', 'calm')],
      bed.context,
      bed.host,
    );

    assert.deepEqual(bed.ran, ['hot']);
  });

  it('takes the other one, and is content with no else at all', async () => {
    const bed = bench({ 'hw.cpu': 10 });

    await runScript(
      [
        branch({ source: 'variable', name: 'hw.cpu', operator: '>=', value: 90 }, 'hot', 'calm'),
        branch({ source: 'variable', name: 'hw.cpu', operator: '>=', value: 90 }, 'hot'),
      ],
      bed.context,
      bed.host,
    );

    assert.deepEqual(bed.ran, ['calm']);
  });

  it('asks about the button it is on without being told which', async () => {
    const bed = bench({}, 'muted');

    await runScript(
      [branch({ source: 'button-state', operator: '==', value: 'muted' }, 'unmute', 'mute')],
      bed.context,
      bed.host,
    );

    assert.deepEqual(bed.ran, ['unmute']);
  });

  it('sits quietly when nothing has been filled in yet', async () => {
    // A block dropped on the grid and not yet configured should do nothing,
    // not throw: half-built is the ordinary state of an editor.
    const bed = bench();
    await runScript([{ type: CORE_IF, branches: { then: [step('one')] } }], bed.context, bed.host);

    assert.deepEqual(bed.ran, []);
    assert.equal(bed.errors.length, 0);
  });
});

describe('for', () => {
  const loop = (params: Record<string, unknown>, body: ActionDescriptor[] = [step('tick')]): ActionDescriptor => ({
    type: CORE_FOR,
    params,
    branches: { do: body },
  });

  it('repeats a fixed number of times, counting from one', async () => {
    const bed = bench();
    await runScript([loop({ times: 3 })], bed.context, bed.host);

    assert.deepEqual(bed.ran, ['tick:1', 'tick:2', 'tick:3']);
  });

  it('takes its count from a variable, and does not spend it', async () => {
    /*
     * The loop counts down a copy. A `for` over `clicks` that emptied `clicks`
     * would be a surprise, and something changing that variable mid-loop must
     * not be able to lengthen the loop.
     */
    const values = { clicks: 3 };
    const bed = bench(values);

    await runScript([loop({ variable: 'clicks' })], bed.context, bed.host);

    assert.deepEqual(bed.ran, ['tick:1', 'tick:2', 'tick:3']);
    assert.equal(values.clicks, 3, 'the variable is read, not consumed');
  });

  it('runs a negative count the same number of times', async () => {
    // "This many, the other way" — where running zero times would turn a sign
    // mistake into a button that silently does nothing.
    const bed = bench({ offset: -2 });
    await runScript([loop({ variable: 'offset' })], bed.context, bed.host);

    assert.deepEqual(bed.ran, ['tick:1', 'tick:2']);
  });

  it('does nothing for zero, for nothing, and for a variable holding text', async () => {
    const bed = bench({ name: 'Intro' });

    await runScript(
      [loop({ times: 0 }), loop({}), loop({ variable: 'name' }), loop({ variable: 'absent' })],
      bed.context,
      bed.host,
    );

    assert.deepEqual(bed.ran, []);
  });

  it('offers how many are left, which is what a countdown needs', async () => {
    const bed = bench();
    const seen: unknown[] = [];

    await runScript([loop({ times: 3 })], bed.context, {
      ...bed.host,
      run: async (_action, where) => {
        seen.push(where.locals?.['loop.left']);
      },
    });

    assert.deepEqual(seen, [2, 1, 0]);
  });

  it('refuses a count past the cap rather than quietly running some of it', async () => {
    /*
     * A count usually comes from a variable, and a variable is whatever a
     * plugin last put in it — a viewer count, a byte count, a mistake. Running
     * the first thousand would be a key that half worked with nothing said
     * about why.
     */
    const bed = bench({ huge: 1_000_000 });

    await assert.rejects(
      runScript([loop({ variable: 'huge' })], bed.context, bed.host),
      (error: Error) => {
        assert.ok(error instanceof ScriptLimitError);
        assert.match(error.message, new RegExp(String(MAX_REPEATS)));
        return true;
      },
    );

    assert.deepEqual(bed.ran, [], 'and nothing ran at all');
  });

  it('stops a script that runs too many steps in total', async () => {
    // Loops within loops, each inside the cap and together far past it.
    const bed = bench();
    const inner = loop({ times: MAX_REPEATS });

    await assert.rejects(
      runScript([loop({ times: MAX_REPEATS }, [inner])], bed.context, bed.host),
      (error: Error) => {
        assert.match(error.message, new RegExp(String(MAX_STEPS)));
        return true;
      },
    );
  });

  it('nests, with the inner loop seeing its own counter', async () => {
    const bed = bench();
    await runScript([loop({ times: 2 }, [loop({ times: 2 })])], bed.context, bed.host);

    assert.deepEqual(bed.ran, ['tick:1', 'tick:2', 'tick:1', 'tick:2']);
  });
});

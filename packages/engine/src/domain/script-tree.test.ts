import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CORE_FOR, CORE_IF } from './action.js';
import type { ActionDescriptor } from './action.js';
import { insertStep, isInside, listAt, moveStep, removeStep, stepAt, updateStep } from './script-tree.js';

/**
 * one
 * if ── then ── two
 *            ── three
 * four
 */
const SCRIPT: readonly ActionDescriptor[] = [
  { type: 'one' },
  { type: CORE_IF, branches: { then: [{ type: 'two' }, { type: 'three' }] } },
  { type: 'four' },
];

describe('finding a step in a script with blocks in it', () => {
  it('reads one at the top and one inside a branch', () => {
    assert.equal(stepAt(SCRIPT, [0])?.type, 'one');
    assert.equal(stepAt(SCRIPT, [1, 'then', 1])?.type, 'three');
  });

  it('answers with nothing for a path that leads nowhere', () => {
    assert.equal(stepAt(SCRIPT, [9]), undefined);
    assert.equal(stepAt(SCRIPT, [1, 'else', 0]), undefined);
    assert.equal(stepAt(SCRIPT, []), undefined);
  });

  it('gives the list a path points into', () => {
    assert.equal(listAt(SCRIPT, []).length, 3);
    assert.deepEqual(
      listAt(SCRIPT, [1, 'then']).map((step) => step.type),
      ['two', 'three'],
    );
  });
});

describe('editing it', () => {
  it('inserts into the top list and into a branch', () => {
    const top = insertStep(SCRIPT, [], 1, { type: 'new' });
    assert.deepEqual(top.map((step) => step.type), ['one', 'new', CORE_IF, 'four']);

    const inner = insertStep(SCRIPT, [1, 'then'], 0, { type: 'new' });
    assert.deepEqual(
      inner[1]?.branches?.['then']?.map((step) => step.type),
      ['new', 'two', 'three'],
    );
  });

  it('opens a branch that did not exist yet', () => {
    // Which is how an `else` gets its first step: the block simply has no
    // `else` until something is dropped into it.
    const next = insertStep(SCRIPT, [1, 'else'], 0, { type: 'otherwise' });

    assert.deepEqual(
      next[1]?.branches?.['else']?.map((step) => step.type),
      ['otherwise'],
    );
    assert.equal(next[1]?.branches?.['then']?.length, 2, 'and leaves the other one alone');
  });

  it('removes a step, and forgets a branch it emptied', () => {
    // An `if` whose `else` was emptied should read as one with no else, not as
    // one carrying an empty list nobody can see.
    const one = removeStep(SCRIPT, [1, 'then', 0]);
    assert.deepEqual(one[1]?.branches?.['then']?.map((step) => step.type), ['three']);

    const both = removeStep(one, [1, 'then', 0]);
    assert.equal(both[1]?.branches, undefined);
  });

  it('changes a step in place, keeping what is under it', () => {
    const next = updateStep(SCRIPT, [1], (step) => ({ ...step, params: { when: 'x' } }));

    assert.deepEqual(next[1]?.params, { when: 'x' });
    assert.equal(next[1]?.branches?.['then']?.length, 2);
  });

  it('leaves the original alone', () => {
    insertStep(SCRIPT, [], 0, { type: 'new' });
    removeStep(SCRIPT, [0]);

    assert.deepEqual(SCRIPT.map((step) => step.type), ['one', CORE_IF, 'four']);
  });
});

describe('moving a step', () => {
  it('reorders within one list, counting from where it left', () => {
    const next = moveStep(SCRIPT, [0], [], 3);
    assert.deepEqual(next.map((step) => step.type), [CORE_IF, 'four', 'one']);
  });

  it('carries a step into a branch, and out of one', () => {
    const into = moveStep(SCRIPT, [2], [1, 'then'], 0);
    assert.deepEqual(
      into[1]?.branches?.['then']?.map((step) => step.type),
      ['four', 'two', 'three'],
    );
    assert.deepEqual(into.map((step) => step.type), ['one', CORE_IF]);

    const out = moveStep(SCRIPT, [1, 'then', 0], [], 0);
    assert.deepEqual(out.map((step) => step.type), ['two', 'one', CORE_IF, 'four']);
  });

  it('follows a block that shifted because the step left the list above it', () => {
    /*
     * The move is a remove and then an insert, and removing shifts everything
     * after it — the block being aimed into included. Dragging the first step
     * into the `then` of the block below it was aimed at `[1, 'then']`, and by
     * the time the insert ran that block sat at index 0: the insert missed and
     * the step was simply gone. Found by dragging one in the editor.
     */
    const next = moveStep(SCRIPT, [0], [1, 'then'], 0);

    assert.deepEqual(next.map((step) => step.type), [CORE_IF, 'four']);
    assert.deepEqual(
      next[0]?.branches?.['then']?.map((step) => step.type),
      ['one', 'two', 'three'],
      'and it arrived where it was aimed',
    );
  });

  it('refuses to put a block inside itself', () => {
    /*
     * The one move that must never happen: a block holding itself is a script
     * that contains itself, which saves until something gives out and leaves a
     * profile nobody can open.
     */
    const next = moveStep(SCRIPT, [1], [1, 'then'], 0);

    assert.deepEqual(next, [...SCRIPT], 'the script comes back untouched');
    assert.equal(isInside([1, 'then', 0], [1]), true);
    assert.equal(isInside([0], [1]), false);
  });

  it('handles a loop nested in a fork without losing anything', () => {
    const script: ActionDescriptor[] = [
      {
        type: CORE_IF,
        branches: { then: [{ type: CORE_FOR, branches: { do: [{ type: 'tick' }] } }] },
      },
    ];

    const next = moveStep(script, [0, 'then', 0, 'do', 0], [], 0);

    assert.deepEqual(next.map((step) => step.type), ['tick', CORE_IF]);
    assert.equal(next[1]?.branches?.['then']?.[0]?.branches, undefined, 'the emptied loop keeps no branch');
  });
});

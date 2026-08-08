import assert from 'node:assert/strict';
import { test } from 'node:test';

import { WriteBudget } from './write-budget.js';

test('the cost of a tick is the number of writes over the rate', () => {
  const budget = new WriteBudget(233);

  // Fifteen keys of a stretched picture: ~64ms, which is what a 30fps source
  // asking for a tick every 33ms has to be slowed down to.
  assert.equal(Math.round(budget.costMs(15)), 64);
  assert.equal(budget.costMs(0), 0);
});

test('a slower panel is learned rather than assumed', () => {
  const budget = new WriteBudget(233);

  // Half the nominal rate, reported repeatedly.
  for (let round = 0; round < 20; round++) budget.record(15, 128);

  assert.ok(budget.writesPerSecond < 140, `still believes ${budget.writesPerSecond}/s`);
  assert.ok(budget.writesPerSecond > 110);
});

test('one hiccup does not throttle the panel', () => {
  const budget = new WriteBudget(233);
  budget.record(15, 500);

  // A single slow batch — a stall in the USB stack — moves the estimate a
  // little, not to the floor.
  assert.ok(budget.writesPerSecond > 190, `overreacted to one sample: ${budget.writesPerSecond}`);
});

test('samples too small to mean anything are ignored', () => {
  const budget = new WriteBudget(233);

  budget.record(1, 40); // one write, timer noise rather than bus throughput
  budget.record(15, 0); // no time passed at all

  assert.equal(budget.writesPerSecond, 233);
});

test('a faster panel is learned too', () => {
  const budget = new WriteBudget(100);
  for (let round = 0; round < 20; round++) budget.record(20, 50);

  assert.ok(budget.writesPerSecond > 350, `stuck at ${budget.writesPerSecond}/s`);
});

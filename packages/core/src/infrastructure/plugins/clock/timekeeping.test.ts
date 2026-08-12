import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  FRESH,
  IDLE,
  advance,
  elapsed,
  formatSpan,
  nextPhase,
  pause,
  remaining,
  remainingInPhase,
  restart,
  skipPhase,
  start,
  toggle,
} from './timekeeping.js';
import type { Plan, Pomodoro } from './timekeeping.js';

const T0 = 1_700_000_000_000;
const after = (seconds: number): number => T0 + seconds * 1000;

describe('a span', () => {
  it('counts from the instant it started, not from ticks', () => {
    const running = start(IDLE, T0);

    // The point of the whole design: nothing was called in between.
    assert.equal(elapsed(running, after(0)), 0);
    assert.equal(elapsed(running, after(1)), 1);
    assert.equal(elapsed(running, after(3599)), 3599);
  });

  it('keeps what it has run when paused, and carries on from there', () => {
    const paused = pause(start(IDLE, T0), after(10));
    assert.equal(elapsed(paused, after(90)), 10);

    const resumed = start(paused, after(90));
    assert.equal(elapsed(resumed, after(95)), 15);
  });

  it('ignores a start on something already running', () => {
    const running = start(IDLE, T0);
    assert.deepEqual(start(running, after(50)), running);
  });

  it('toggles both ways', () => {
    const running = toggle(IDLE, T0);
    assert.equal(running.running, true);
    assert.equal(toggle(running, after(5)).running, false);
  });

  it('restarts from nothing and running', () => {
    const carried = pause(start(IDLE, T0), after(30));
    assert.equal(elapsed(restart(after(30)), after(31)), 1);
    assert.equal(elapsed(carried, after(31)), 30);
  });

  it('survives a clock that has gone backwards', () => {
    // NTP correcting the machine mid-run. Better a span that stalls than one
    // that reports a negative age.
    const running = start(IDLE, T0);
    assert.equal(elapsed(running, T0 - 5000), 0);
  });
});

describe('a countdown', () => {
  it('stops at zero rather than going negative', () => {
    const running = start(IDLE, T0);

    assert.equal(remaining(running, 60, after(0)), 60);
    assert.equal(remaining(running, 60, after(59)), 1);
    assert.equal(remaining(running, 60, after(60)), 0);
    // The value a handler waits for stays exactly zero, so it fires once.
    assert.equal(remaining(running, 60, after(600)), 0);
  });
});

describe('a pomodoro', () => {
  const plan: Plan = { work: 60, rest: 20, longRest: 40, rounds: 3 };

  it('follows work, rest, work, rest, work, long rest', () => {
    let state: Pomodoro = { ...FRESH, phase: 'work', round: 1 };
    const seen: string[] = [];

    for (let step = 0; step < 6; step++) {
      seen.push(`${state.phase}#${state.round}`);
      state = { ...state, ...nextPhase(state, plan) };
    }

    assert.deepEqual(seen, ['work#1', 'rest#1', 'work#2', 'rest#2', 'work#3', 'long-rest#3']);
  });

  it('starts a new set after the long rest', () => {
    const state = { ...FRESH, phase: 'long-rest' as const, round: 3 };
    assert.deepEqual(nextPhase(state, plan), { phase: 'work', round: 1 });
  });

  it('rolls forward to wherever the clock actually is', () => {
    // What happens when the plugin went quiet because no key was showing it:
    // 100s in is work(60) done, rest(20) done, and 20s into the second work.
    const running = { ...FRESH, running: true, since: T0 };
    const moved = advance(running, plan, after(100));

    assert.equal(moved.phase, 'work');
    assert.equal(moved.round, 2);
    assert.equal(remainingInPhase(moved, plan, after(100)), 40);
  });

  it('leaves a paused pomodoro exactly where it stands', () => {
    const held = { ...FRESH, running: false, banked: 30 };
    assert.deepEqual(advance(held, plan, after(10_000)), held);
  });

  it('does not spin on a plan somebody set to zero', () => {
    const zero: Plan = { work: 0, rest: 0, longRest: 0, rounds: 1 };
    const running = { ...FRESH, running: true, since: T0 };

    // A phase is never shorter than a second, so a day of it is a finite
    // number of turns rather than a loop with no way out.
    const moved = advance(running, zero, after(86_400));
    assert.equal(moved.running, true);
  });

  it('skips to the next phase without losing whether it was running', () => {
    const running = { ...FRESH, running: true, since: T0 };
    const skipped = skipPhase(running, plan, after(5));

    assert.equal(skipped.phase, 'rest');
    assert.equal(skipped.running, true);
    assert.equal(remainingInPhase(skipped, plan, after(5)), 20);

    const held = skipPhase({ ...FRESH, banked: 12 }, plan, after(5));
    assert.equal(held.running, false);
    assert.equal(held.banked, 0);
  });
});

describe('saying a span', () => {
  it('drops the leading zero on minutes', () => {
    // "04:59" reads as four hours at a glance, and a key is read at a glance.
    assert.equal(formatSpan(299), '4:59');
    assert.equal(formatSpan(7), '0:07');
  });

  it('grows an hours field only once there is one', () => {
    assert.equal(formatSpan(3599), '59:59');
    assert.equal(formatSpan(3600), '1:00:00');
    assert.equal(formatSpan(3661), '1:01:01');
  });

  it('shows nothing below zero as zero', () => {
    assert.equal(formatSpan(-5), '0:00');
  });
});

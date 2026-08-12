/**
 * Keeping time, with nothing that touches the outside.
 *
 * Split out because it is the whole of what can be wrong here and none of it
 * needs a clock on the wall: every function takes `now`. The plugin above adds
 * timers, variables and a manifest, and has almost no arithmetic left in it.
 *
 * Nothing counts. A running span remembers the instant it started and works
 * out the rest by subtraction, so a tick that arrives late, twice, or not at
 * all costs nothing — which matters here more than usual, because this plugin
 * deliberately stops ticking whenever nobody is looking at it.
 */

/** A stretch of time that may be running, paused, or not started. */
export interface Span {
  readonly running: boolean;
  /** When the current run began, in milliseconds since the epoch. */
  readonly since?: number;
  /** Seconds already banked by earlier runs, if it was paused and resumed. */
  readonly banked: number;
}

export const IDLE: Span = { running: false, banked: 0 };

/** How long the span has run, in whole seconds. */
export function elapsed(span: Span, now: number): number {
  if (!span.running || span.since === undefined) return span.banked;
  return span.banked + Math.max(0, Math.floor((now - span.since) / 1000));
}

export function start(span: Span, now: number): Span {
  if (span.running) return span;
  return { running: true, since: now, banked: span.banked };
}

/** Stops where it stands: what has run is kept, and resuming carries on. */
export function pause(span: Span, now: number): Span {
  if (!span.running) return span;
  return { running: false, banked: elapsed(span, now) };
}

export function toggle(span: Span, now: number): Span {
  return span.running ? pause(span, now) : start(span, now);
}

/** Back to nothing, and stopped. */
export function reset(): Span {
  return IDLE;
}

/** Back to nothing, and running: the one people mean by "restart". */
export function restart(now: number): Span {
  return { running: true, since: now, banked: 0 };
}

/** What a countdown has left, which never goes below zero. */
export function remaining(span: Span, total: number, now: number): number {
  return Math.max(0, total - elapsed(span, now));
}

// --- pomodoro -------------------------------------------------------------

export type Phase = 'work' | 'rest' | 'long-rest';

/** The technique's four numbers, in seconds and rounds. */
export interface Plan {
  readonly work: number;
  readonly rest: number;
  readonly longRest: number;
  /** Works before the long rest. */
  readonly rounds: number;
}

export interface Pomodoro extends Span {
  readonly phase: Phase;
  /** Which work of the set this is, from one. */
  readonly round: number;
}

export const FRESH: Pomodoro = { ...IDLE, phase: 'work', round: 1 };

/**
 * How long a phase lasts, never less than a second.
 *
 * A plan with a zero in it would otherwise be a phase that ends the instant it
 * begins, and rolling forward through those is a loop with no way out.
 */
export function phaseLength(phase: Phase, plan: Plan): number {
  const chosen = phase === 'work' ? plan.work : phase === 'rest' ? plan.rest : plan.longRest;
  return Math.max(1, Math.round(chosen));
}

export function remainingInPhase(state: Pomodoro, plan: Plan, now: number): number {
  return Math.max(0, phaseLength(state.phase, plan) - elapsed(state, now));
}

/** The phase after this one, and which round that leaves us in. */
export function nextPhase(state: Pomodoro, plan: Plan): { phase: Phase; round: number } {
  if (state.phase === 'work') {
    return state.round >= plan.rounds
      ? { phase: 'long-rest', round: state.round }
      : { phase: 'rest', round: state.round };
  }

  // A rest hands back to work: the next one of the set, or the first of a new
  // set once the long rest is over.
  return state.phase === 'rest'
    ? { phase: 'work', round: state.round + 1 }
    : { phase: 'work', round: 1 };
}

/**
 * Moves the pomodoro on to whichever phase `now` actually falls in.
 *
 * A loop rather than a single step, because this plugin is allowed to go quiet
 * — no key showing a pomodoro means no tick — and can come back to find two
 * phases have passed. Rolling forward from the recorded start instant lands in
 * the same place as ticking through would have, without having ticked.
 */
export function advance(state: Pomodoro, plan: Plan, now: number): Pomodoro {
  if (!state.running) return state;

  let current = state;
  // Every turn consumes at least a second of a phase, so this ends; the bound
  // is a backstop against a clock that has jumped decades, not a policy.
  for (let guard = 0; guard < 100_000; guard++) {
    const length = phaseLength(current.phase, plan);
    if (elapsed(current, now) < length) return current;

    const consumed = (length - current.banked) * 1000;
    current = {
      ...nextPhase(current, plan),
      running: true,
      since: (current.since ?? now) + consumed,
      banked: 0,
    };
  }

  return current;
}

/** Skips whatever is running now and starts the next phase from the top. */
export function skipPhase(state: Pomodoro, plan: Plan, now: number): Pomodoro {
  return {
    ...nextPhase(state, plan),
    running: state.running,
    ...(state.running ? { since: now } : {}),
    banked: 0,
  };
}

// --- saying it -------------------------------------------------------------

/**
 * A span as a key shows it: `4:59`, and `1:04:59` once there is an hour in it.
 *
 * No leading zero on the first field. `04:59` on a five-minute countdown reads
 * as four hours at a glance, and a key is read at a glance.
 */
export function formatSpan(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = whole % 60;

  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(rest)}`
    : `${minutes}:${pad(rest)}`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

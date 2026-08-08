export type TimerHandle = ReturnType<typeof setTimeout>;

/**
 * Outbound port: time, so that tests can run an animation in a millisecond.
 *
 * Animation here is computed *from the clock* rather than by stepping an
 * index — a frame that arrives late is worth less than the right one — which
 * makes a controllable clock the only way to test playback deterministically.
 */
export interface ClockPort {
  now(): number;
  setTimeout(handler: () => void, delayMs: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}

export const systemClock: ClockPort = {
  now: () => Date.now(),
  setTimeout: (handler, delayMs) => setTimeout(handler, delayMs),
  clearTimeout: (handle) => clearTimeout(handle),
};

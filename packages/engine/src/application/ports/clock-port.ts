export type TimerHandle = { readonly __timer: unique symbol } | unknown;

/**
 * Outbound port for delayed work — currently only long-press detection.
 *
 * Injected rather than calling setTimeout directly so tests can drive time
 * by hand instead of sleeping.
 */
export interface ClockPort {
  setTimeout(callback: () => void, milliseconds: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
  /**
   * Milliseconds on a monotonic clock.
   *
   * Animation picks its frame from the clock rather than by counting, so that
   * a slow write skips ahead instead of dragging everything behind it. That
   * only works if time cannot jump backwards, which is why this is not
   * `Date.now`.
   */
  now(): number;
}

/** The obvious implementation, for production wiring. */
export const systemClock: ClockPort = {
  setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => performance.now(),
};

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
}

/** The obvious implementation, for production wiring. */
export const systemClock: ClockPort = {
  setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

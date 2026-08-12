import { DEFAULT_WRITES_PER_SECOND } from './ports/panel-port.js';

/**
 * How fast the panel actually swallows tiles, learned from watching it.
 *
 * Learned rather than declared, because the rate is not a property of the
 * device alone: it falls by more than three to one between a flat tile and a
 * photograph, and moves again with the USB controller, the driver and whether
 * this is a debug build. See `DEFAULT_WRITES_PER_SECOND` for the measurements
 * and for the shape behind them.
 *
 * What this exists to prevent is the queue. Ask the bus for more than it can
 * carry and each tick adds more work than the next tick's schedule allows, so
 * the backlog grows without bound and the panel falls seconds behind the clock
 * — with every key press queued behind it. Playing at the rate the bus can
 * carry costs smoothness instead, and frames are chosen from the clock, so a
 * slow tick shows every second frame rather than running late.
 *
 * A single rate is a simplification of a straight line — a fixed cost per
 * write plus the payload — and the honest version of this class would budget
 * in bytes as well. What saves the simplification is that it is observed: on a
 * panel showing photographs it settles low, on one showing flat keys it
 * settles high, because that is what it was told.
 */
export class WriteBudget {
  private rate: number;
  /** Weight of a new measurement. Low enough that one slow write — a hiccup in
      the USB stack — does not throttle the panel for the next second. */
  private static readonly SMOOTHING = 0.2;
  /** Below this, a sample says more about the timer than about the bus. */
  private static readonly MIN_SAMPLE_WRITES = 3;

  constructor(nominalWritesPerSecond: number = DEFAULT_WRITES_PER_SECOND) {
    this.rate = nominalWritesPerSecond;
  }

  get writesPerSecond(): number {
    return this.rate;
  }

  /** How long `writes` tiles will take, on the evidence so far. */
  costMs(writes: number): number {
    if (writes <= 0) return 0;
    return (writes / this.rate) * 1000;
  }

  record(writes: number, elapsedMs: number): void {
    if (writes < WriteBudget.MIN_SAMPLE_WRITES || elapsedMs <= 0) return;

    const observed = (writes / elapsedMs) * 1000;
    this.rate = this.rate * (1 - WriteBudget.SMOOTHING) + observed * WriteBudget.SMOOTHING;
  }
}

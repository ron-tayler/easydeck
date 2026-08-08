import { DEFAULT_WRITES_PER_SECOND } from './ports/panel-port.js';

/**
 * How fast the panel actually swallows tiles, learned from watching it.
 *
 * This is the binding constraint on anything animated, and it is easy to
 * measure but impossible to argue with: a 30fps picture stretched over fifteen
 * keys asks for 451 images a second, and the hardware tops out around 233. The
 * old path queued the writes anyway. Each tick added 64ms of work on a 33ms
 * schedule, so the queue grew without bound and the panel fell seconds behind
 * the clock — with every key press queued behind it.
 *
 * The answer is to play at the rate the bus can carry. Frames are chosen from
 * the clock, so a slower tick shows every second frame rather than running
 * slow: the animation keeps time, and only smoothness is lost.
 *
 * Measured rather than assumed, because 233 is one capture of one device on
 * one machine — a different revision, a busy USB controller or a debug build
 * all move it, and guessing high is exactly the failure this prevents.
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

import { randomInt } from 'node:crypto';

/**
 * Devices waiting to be let in.
 *
 * Each waiting device is shown a six-digit code, and the same code appears in
 * the configurator. The code is not a secret and not a password — it answers a
 * different question: *which* of the devices asking right now is the one in my
 * hand. Without it, approving a request while a stranger on the network is
 * also knocking would be a coin toss.
 */

export interface PendingDevice {
  readonly id: string;
  readonly name: string;
  /** Shown on both screens, for the user to match by eye. */
  readonly code: string;
  readonly since: number;
  /** Where it connected from, so an unexpected address is visible. */
  readonly address?: string;
  /**
   * The device is no longer connected, so it is not offered for approval.
   *
   * Kept rather than deleted for a short while, because the number is the
   * whole point: a page that reloaded, or a tablet whose Wi-Fi blinked while
   * its owner walked to the computer, must not come back wearing a different
   * code from the one they are holding in their head.
   */
  readonly gone?: boolean;
}

export interface PendingDevicesOptions {
  /** How long an unanswered request stays on the list. */
  readonly expiryMs?: number;
  /** How long a departed request keeps its code, in case it comes back. */
  readonly goneMs?: number;
  readonly now?: () => number;
}

/** Long enough to walk to the other machine, short enough not to pile up. */
const DEFAULT_EXPIRY_MS = 5 * 60 * 1000;
/** A reload, a sleeping tablet, a blink of Wi-Fi — all shorter than this. */
const DEFAULT_GONE_MS = 30 * 1000;

export class PendingDevices {
  private readonly waiting = new Map<string, PendingDevice>();
  private readonly expiryMs: number;
  private readonly goneMs: number;
  private readonly now: () => number;

  constructor(options: PendingDevicesOptions = {}) {
    this.expiryMs = options.expiryMs ?? DEFAULT_EXPIRY_MS;
    this.goneMs = options.goneMs ?? DEFAULT_GONE_MS;
    this.now = options.now ?? Date.now;
  }

  /**
   * Records a request, or returns the one already standing.
   *
   * A device that reconnects — a reloaded page, a dropped Wi-Fi link — keeps
   * its code rather than being given a new one, or the number on screen would
   * change while the user was walking over to look at it.
   */
  add(id: string, name: string, address?: string): PendingDevice {
    this.sweep();

    const standing = this.waiting.get(id);
    if (standing) {
      // Back again: the same request, with the same number on it.
      const returned = { ...standing, gone: false };
      this.waiting.set(id, returned);
      return returned;
    }

    const request: PendingDevice = {
      id,
      name,
      code: String(randomInt(0, 1_000_000)).padStart(6, '0'),
      since: this.now(),
      ...(address ? { address } : {}),
    };

    this.waiting.set(id, request);
    return request;
  }

  /** Requests worth showing: the ones whose device is still waiting. */
  list(): readonly PendingDevice[] {
    this.sweep();
    return [...this.waiting.values()].filter((request) => !request.gone);
  }

  get(id: string): PendingDevice | undefined {
    this.sweep();
    return this.waiting.get(id);
  }

  remove(id: string): void {
    this.waiting.delete(id);
  }

  /**
   * Marks a request as no longer waiting, keeping its code for a moment.
   *
   * Long enough to survive a reload, short enough that a request nobody
   * returns for expires on its own.
   */
  markGone(id: string): boolean {
    const standing = this.waiting.get(id);
    if (!standing || standing.gone) return false;

    this.waiting.set(id, { ...standing, gone: true, since: this.now() });
    return true;
  }

  private sweep(): void {
    const now = this.now();

    for (const [id, request] of this.waiting) {
      // A departed request is kept only long enough to survive a reload; one
      // still being waited on gets the full window.
      const window = request.gone ? this.goneMs : this.expiryMs;
      if (request.since < now - window) this.waiting.delete(id);
    }
  }
}

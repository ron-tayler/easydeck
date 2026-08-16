import type { DeviceManager, DiscoveredDevice } from '@easydeck/device';

export interface DeviceWatcherOptions {
  readonly manager: DeviceManager;
  /** Names a panel the way the rest of the daemon does; see deck-id.ts. */
  readonly identify: (device: DiscoveredDevice) => string;
  /** A panel that was not there a moment ago. */
  readonly onArrived: (device: DiscoveredDevice, id: string) => Promise<void>;
  /** A panel that has gone, by the same id it arrived under. */
  readonly onGone: (id: string) => Promise<void>;
  /** Which panels are already running, so the first sweep adds nothing twice. */
  readonly known?: Iterable<string>;
  readonly intervalMs?: number;
  readonly onError?: (error: unknown) => void;
}

export interface DeviceWatcher {
  stop(): void;
}

/**
 * Often enough to feel immediate, rarely enough to be invisible.
 *
 * Enumerating the HID bus costs a few milliseconds on a healthy machine — 33ms
 * for 42 devices, measured — and a person plugging a panel in is waiting on it,
 * so this is one of the places to be generous.
 */
const DEFAULT_INTERVAL_MS = 2000;

/**
 * How much of the time a sweep may take up.
 *
 * The cost is not the same everywhere: Windows opens every HID device to read
 * its name, and a machine with a lot of them — or one of them slow to answer —
 * turns a 30ms question into a second-long one. A fixed two-second beat would
 * then spend half the machine's patience on asking whether a panel appeared.
 * So the interval follows what the last sweep actually cost: a tenth of the
 * time, at most, and never faster than the beat above.
 */
const DUTY = 10;

/** Beyond this, waiting longer buys nothing and only delays a plugged-in deck. */
const MAX_INTERVAL_MS = 30_000;

/**
 * Watches the USB bus for panels arriving and leaving.
 *
 * Polling rather than a hotplug event, because node-hid has none: libusb's
 * notifications are not exposed, and every other option is a platform-specific
 * dependency for a question that a list of devices answers exactly.
 *
 * A sweep that fails is skipped rather than fatal — a bus that cannot be
 * enumerated right now will be enumerable in two seconds, and the alternative
 * is a daemon that stops noticing panels because one call went wrong.
 */
export function watchDevices(options: DeviceWatcherOptions): DeviceWatcher {
  const seen = new Set(options.known ?? []);
  const base = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  let stopped = false;
  let sweeping = false;
  let timer: NodeJS.Timeout | undefined;

  const sweep = async (): Promise<void> => {
    // A slow open must not overlap with the next tick: the second sweep would
    // still see the panel as missing and try to open it a second time.
    if (stopped || sweeping) return;
    sweeping = true;

    const started = Date.now();
    try {
      const found = new Map<string, DiscoveredDevice>();
      for (const device of await options.manager.list()) {
        found.set(options.identify(device), device);
      }

      for (const [id, device] of found) {
        if (stopped || seen.has(id)) continue;
        // Recorded before opening, so a panel whose open fails is not retried
        // every two seconds — the next sweep sees it as known and leaves it
        // alone until it is unplugged and plugged back in.
        seen.add(id);
        try {
          await options.onArrived(device, id);
        } catch (error) {
          options.onError?.(error);
        }
      }

      for (const id of [...seen]) {
        if (stopped || found.has(id)) continue;
        seen.delete(id);
        try {
          await options.onGone(id);
        } catch (error) {
          options.onError?.(error);
        }
      }
    } catch (error) {
      options.onError?.(error);
    } finally {
      sweeping = false;
      // Measured rather than assumed: what the sweep cost decides when the
      // next one is worth asking for. See DUTY.
      schedule(Math.min(MAX_INTERVAL_MS, Math.max(base, (Date.now() - started) * DUTY)));
    }
  };

  function schedule(delay: number): void {
    if (stopped) return;

    timer = setTimeout(() => void sweep(), delay);
    // Nothing should be kept alive by this: a daemon whose only remaining
    // reason to run is its own watcher is a daemon that will not quit.
    timer.unref?.();
  }

  schedule(base);

  return {
    stop(): void {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}

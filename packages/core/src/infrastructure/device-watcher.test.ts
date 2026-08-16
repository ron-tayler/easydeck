import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, it } from 'node:test';

import type { DeviceManager, DiscoveredDevice } from '@easydeck/device';

import { watchDevices } from './device-watcher.js';

/**
 * Panels arriving and leaving while the daemon runs.
 *
 * The bus is polled because node-hid has no hotplug event, so everything here
 * is about the sweep behaving: a panel counted once, one that fails to open
 * not retried into a loop, and a panel that leaves noticed.
 */

const TICK = 5;
/** Long enough for several sweeps, short enough not to slow the suite down. */
const settle = (): Promise<void> => delay(TICK * 6);

const device = (path: string): DiscoveredDevice =>
  ({ model: { id: 'd6', name: 'D6' }, hid: { path } }) as unknown as DiscoveredDevice;

/** A bus whose contents the test sets directly. */
function bus(...paths: string[]) {
  let present = paths.map(device);
  return {
    manager: { list: async () => present } as unknown as DeviceManager,
    set: (...next: string[]) => {
      present = next.map(device);
    },
  };
}

const identify = (found: DiscoveredDevice): string => found.hid.path!;

describe('watching the USB bus', () => {
  it('reports a panel that appears, once', async () => {
    const { manager, set } = bus();
    const arrived: string[] = [];

    const watcher = watchDevices({
      manager,
      identify,
      onArrived: async (_device, id) => void arrived.push(id),
      onGone: async () => undefined,
      intervalMs: TICK,
    });

    await settle();
    assert.deepEqual(arrived, [], 'reported a panel on an empty bus');

    set('usb-1');
    await settle();
    watcher.stop();

    assert.deepEqual(arrived, ['usb-1']);
  });

  it('leaves alone the panels it was told are already running', async () => {
    const { manager } = bus('usb-1');
    const arrived: string[] = [];

    const watcher = watchDevices({
      manager,
      identify,
      known: ['usb-1'],
      onArrived: async (_device, id) => void arrived.push(id),
      onGone: async () => undefined,
      intervalMs: TICK,
    });

    await settle();
    watcher.stop();

    assert.deepEqual(arrived, [], 'opened a panel the daemon already had open');
  });

  it('reports a panel that goes, and reports it again when it comes back', async () => {
    const { manager, set } = bus('usb-1');
    const events: string[] = [];

    const watcher = watchDevices({
      manager,
      identify,
      onArrived: async (_device, id) => void events.push(`+${id}`),
      onGone: async (id) => void events.push(`-${id}`),
      intervalMs: TICK,
    });

    await settle();
    set();
    await settle();
    set('usb-1');
    await settle();
    watcher.stop();

    assert.deepEqual(events, ['+usb-1', '-usb-1', '+usb-1']);
  });

  it('does not keep retrying a panel that refuses to open', async () => {
    const { manager } = bus('usb-1');
    const tries: string[] = [];
    const failures: unknown[] = [];

    const watcher = watchDevices({
      manager,
      identify,
      onArrived: async (_device, id) => {
        tries.push(id);
        throw new Error('busy');
      },
      onGone: async () => undefined,
      onError: (error) => failures.push(error),
      intervalMs: TICK,
    });

    await settle();
    watcher.stop();

    // Once, not once every two seconds until somebody notices the log.
    assert.deepEqual(tries, ['usb-1']);
    assert.equal(failures.length, 1);
  });

  it('asks less often when asking is expensive', async () => {
    // A bus that takes 50ms to enumerate — a Windows machine with a lot of HID
    // devices, or one slow to answer. Polling that every 10ms would spend the
    // machine on the question rather than on the program.
    let sweeps = 0;
    const slow = {
      list: async () => {
        sweeps += 1;
        await delay(50);
        return [];
      },
    } as unknown as DeviceManager;

    const watcher = watchDevices({
      manager: slow,
      identify,
      onArrived: async () => undefined,
      onGone: async () => undefined,
      intervalMs: 10,
    });

    await delay(1000);
    watcher.stop();

    // A tenth of the time, so 50ms of work buys 500ms of quiet: two or three
    // sweeps in a second rather than the twenty a fixed beat would take.
    assert.ok(sweeps <= 4, `swept ${sweeps} times in a second despite each sweep costing 50ms`);
    assert.ok(sweeps >= 1, 'never swept at all');
  });

  it('stops sweeping once it is stopped', async () => {
    const { manager, set } = bus();
    const arrived: string[] = [];

    const watcher = watchDevices({
      manager,
      identify,
      onArrived: async (_device, id) => void arrived.push(id),
      onGone: async () => undefined,
      intervalMs: TICK,
    });

    watcher.stop();
    set('usb-1');
    await settle();

    assert.deepEqual(arrived, []);
  });
});

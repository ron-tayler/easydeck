import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { HidConnection } from '../../application/ports/hid-port.js';
import type { KeyEvent } from '../../domain/surface.js';
import { FIFINE_AMPLIGAME_D6 } from './models.js';
import { StreamDockSurface } from './streamdock-surface.js';

/** In-memory HidConnection that records every written report. */
class FakeConnection implements HidConnection {
  writes: Buffer[] = [];
  closedCount = 0;
  /** Simulates the Windows HID stack padding writes to the real report size. */
  reportLength: number | undefined;
  private inputListener: ((report: Uint8Array) => void) | undefined;

  async write(report: Uint8Array): Promise<number> {
    this.writes.push(Buffer.from(report));
    return Math.max(report.length, this.reportLength ?? 0);
  }

  onInput(listener: (report: Uint8Array) => void): void {
    this.inputListener = listener;
  }

  onError(): void {}

  async close(): Promise<void> {
    this.closedCount += 1;
  }

  pressKey(rawKeyId: number, pressed: boolean): void {
    const report = Buffer.alloc(16);
    report.set([0x41, 0x43, 0x4b]); // "ACK"
    report[9] = rawKeyId;
    report[10] = pressed ? 1 : 0;
    this.inputListener?.(report);
  }
}

const body = (report: Buffer): Buffer => report.subarray(6); // strip report id + CRT prefix
const opcode = (report: Buffer): string => body(report).subarray(0, 3).toString('latin1');

async function openSurface() {
  const connection = new FakeConnection();
  const surface = await StreamDockSurface.open(connection, FIFINE_AMPLIGAME_D6, {
    path: 'fake',
    vendorId: 0x3142,
    productId: 0x0007,
  });
  return { connection, surface };
}

describe('StreamDockSurface', () => {
  it('sends the init sequence on open: wake, zero brightness, brightness, clear all, commit', async () => {
    const { connection } = await openSurface();

    assert.deepEqual(connection.writes.map(opcode), ['DIS', 'LIG', 'LIG', 'CLE', 'STP']);
    assert.equal(body(connection.writes[1]!)[5], 0); // init brightness 0
    assert.equal(body(connection.writes[2]!)[5], 70); // default brightness
    assert.equal(body(connection.writes[3]!)[6], 0xff); // clear all keys
    assert.ok(connection.writes.every((w) => w.length === 513));
  });

  it('commits a single-key clear, or the key keeps what it had', async () => {
    // The clear-all path has always sent this; the one-key path did not, and
    // on v2+ firmwares the command alone changes nothing — the key went on
    // showing a frame from a page the deck had already left.
    const { connection, surface } = await openSurface();
    connection.writes = [];

    await surface.clearKey(3);

    assert.deepEqual(connection.writes.map(opcode), ['CLE', 'STP']);
  });

  it('adopts the packet size reported by the HID stack (512 -> 1024 revisions)', async () => {
    const connection = new FakeConnection();
    connection.reportLength = 1025;
    const surface = await StreamDockSurface.open(connection, FIFINE_AMPLIGAME_D6, {
      path: 'fake',
      vendorId: 0x3142,
      productId: 0x0060,
    });
    connection.writes = [];

    const jpeg = Buffer.alloc(1500, 0x77);
    jpeg[0] = 0xff;
    jpeg[1] = 0xd8;
    await surface.setKeyImage(0, jpeg);

    // BAT + 2 chunks of 1024 + STP, all framed at the discovered size
    assert.equal(connection.writes.length, 4);
    assert.ok(connection.writes.every((w) => w.length === 1025));
    assert.equal(connection.writes[1]![1], 0xff); // first jpeg byte right after report id
  });

  it('uploads a key image as BAT header, raw chunks, then STP', async () => {
    const { connection, surface } = await openSurface();
    connection.writes = [];

    const jpeg = Buffer.alloc(700, 0x77);
    jpeg[0] = 0xff;
    jpeg[1] = 0xd8;
    await surface.setKeyImage(0, jpeg); // top-left key -> device image id 11

    assert.equal(connection.writes.length, 4); // BAT + 2 chunks + STP
    const bat = body(connection.writes[0]!);
    assert.equal(bat.subarray(0, 3).toString('latin1'), 'BAT');
    assert.deepEqual([...bat.subarray(3, 8)], [0, 0, 700 >> 8, 700 & 0xff, 11]);
    assert.equal(connection.writes[1]![1], 0xff); // chunk carries raw jpeg bytes
    assert.equal(opcode(connection.writes[3]!), 'STP');
  });

  it('rejects non-JPEG and oversized images without writing anything', async () => {
    const { connection, surface } = await openSurface();
    connection.writes = [];

    await assert.rejects(surface.setKeyImage(0, Buffer.alloc(100)), /JPEG/);

    const oversized = Buffer.alloc(20000);
    oversized[0] = 0xff;
    oversized[1] = 0xd8;
    await assert.rejects(surface.setKeyImage(0, oversized), /at most 10240/);

    assert.equal(connection.writes.length, 0);
  });

  it('translates raw input ids into logical row-major key events', async () => {
    const { connection, surface } = await openSurface();
    const events: Array<[string, KeyEvent]> = [];
    surface.on('keyDown', (e) => events.push(['down', e]));
    surface.on('keyUp', (e) => events.push(['up', e]));

    connection.pressKey(1, true); // raw 1 -> logical 0 (top-left)
    connection.pressKey(1, false);
    connection.pressKey(15, true); // raw 15 -> logical 14 (bottom-right)

    assert.deepEqual(events, [
      ['down', { key: 0, row: 0, col: 0 }],
      ['up', { key: 0, row: 0, col: 0 }],
      ['down', { key: 14, row: 2, col: 4 }],
    ]);
  });

  it('synthesizes a release when a press repeats and ignores duplicate releases', async () => {
    const { connection, surface } = await openSurface();
    const events: string[] = [];
    surface.on('keyDown', (e) => events.push(`down:${e.key}`));
    surface.on('keyUp', (e) => events.push(`up:${e.key}`));

    connection.pressKey(2, true);
    connection.pressKey(2, true); // lost release
    connection.pressKey(2, false);
    connection.pressKey(2, false); // duplicate release

    assert.deepEqual(events, ['down:1', 'up:1', 'down:1', 'up:1']);
  });

  it('close sends disconnect + sleep and releases the connection exactly once', async () => {
    const { connection, surface } = await openSurface();
    connection.writes = [];

    await surface.close();
    await surface.close();

    assert.deepEqual(connection.writes.map(opcode), ['CLE', 'HAN']);
    assert.deepEqual([...body(connection.writes[0]!).subarray(5, 7)], [0x44, 0x43]); // "DC"
    assert.equal(connection.closedCount, 1);
    await assert.rejects(surface.setKeyImage(0, Buffer.from([0xff, 0xd8])), /closed/);
  });
});

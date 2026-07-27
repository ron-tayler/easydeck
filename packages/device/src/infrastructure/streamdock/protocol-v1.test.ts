import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CLEAR_ALL_KEYS,
  commands,
  decodeInputReport,
  frameCommand,
  frameImageChunks,
  V1_PACKET_SIZE,
} from './protocol-v1.js';

const CRT = [0x43, 0x52, 0x54, 0x00, 0x00];

describe('frameCommand', () => {
  it('produces a 513-byte report: report id, CRT prefix, body, zero padding', () => {
    const report = frameCommand(commands.wake());

    assert.equal(report.length, V1_PACKET_SIZE + 1);
    assert.equal(report[0], 0x00);
    assert.deepEqual([...report.subarray(1, 6)], CRT);
    assert.deepEqual([...report.subarray(6, 9)], [0x44, 0x49, 0x53]); // "DIS"
    assert.ok(report.subarray(9).every((b) => b === 0));
  });

  it('rejects bodies that do not fit the packet', () => {
    assert.throws(() => frameCommand(new Array(V1_PACKET_SIZE).fill(0)), RangeError);
  });
});

describe('commands', () => {
  it('brightness clamps and rounds the value', () => {
    assert.deepEqual(commands.brightness(150).at(-1), 100);
    assert.deepEqual(commands.brightness(-5).at(-1), 0);
    assert.deepEqual(commands.brightness(49.6).at(-1), 50);
  });

  it('beginImage encodes a big-endian length and the device key id', () => {
    const body = commands.beginImage(11, 0x2837);
    assert.deepEqual(body, [0x42, 0x41, 0x54, 0x00, 0x00, 0x28, 0x37, 11]);
  });

  it('clearKey targets one key or all keys', () => {
    assert.deepEqual(commands.clearKey(5), [0x43, 0x4c, 0x45, 0x00, 0x00, 0x00, 5]);
    assert.deepEqual(commands.clearKey(CLEAR_ALL_KEYS).at(-1), 0xff);
  });

  it('disconnect is CLE followed by ASCII "DC"', () => {
    assert.deepEqual(commands.disconnect(), [0x43, 0x4c, 0x45, 0x00, 0x00, 0x44, 0x43]);
  });
});

describe('frameImageChunks', () => {
  it('splits data into report-id-prefixed, zero-padded chunks', () => {
    const data = Buffer.alloc(V1_PACKET_SIZE + 10, 0xab);
    const chunks = frameImageChunks(data);

    assert.equal(chunks.length, 2);
    assert.ok(chunks.every((c) => c.length === V1_PACKET_SIZE + 1 && c[0] === 0x00));
    assert.ok(chunks[0]!.subarray(1).every((b) => b === 0xab));
    assert.ok(chunks[1]!.subarray(1, 11).every((b) => b === 0xab));
    assert.ok(chunks[1]!.subarray(11).every((b) => b === 0));
  });

  it('a 10 KiB image fits in exactly 20 chunks', () => {
    assert.equal(frameImageChunks(Buffer.alloc(10240)).length, 20);
  });
});

describe('decodeInputReport', () => {
  const ackReport = (keyId: number, state: number, leadingReportId = false): Buffer => {
    const base = leadingReportId ? 1 : 0;
    const report = Buffer.alloc(base + 16);
    report.set([0x41, 0x43, 0x4b], base); // "ACK"
    report[base + 9] = keyId;
    report[base + 10] = state;
    return report;
  };

  it('decodes a key press and release', () => {
    assert.deepEqual(decodeInputReport(ackReport(3, 1)), { type: 'key', rawKeyId: 3, pressed: true });
    assert.deepEqual(decodeInputReport(ackReport(3, 0)), { type: 'key', rawKeyId: 3, pressed: false });
  });

  it('accepts reports with a leading report id byte', () => {
    assert.deepEqual(decodeInputReport(ackReport(15, 1, true)), { type: 'key', rawKeyId: 15, pressed: true });
  });

  it('reports key id 0 as a firmware reset', () => {
    assert.deepEqual(decodeInputReport(ackReport(0, 0)), { type: 'reset' });
  });

  it('ignores reports without the ACK prefix', () => {
    assert.equal(decodeInputReport(Buffer.alloc(16)), null);
  });
});

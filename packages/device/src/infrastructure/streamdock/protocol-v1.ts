/**
 * Stream Dock family wire protocol, "v1" flavour (512-byte packets).
 *
 * Reverse-engineered from three independent working implementations:
 * mirajazz (Rust, drives the FIFINE D6 via opendeck-ampgd6),
 * bitfocus/companion-surface-mirabox-stream-dock and
 * rigor789/mirabox-streamdock-node. See docs/d6-protocol.md at the repo root.
 *
 * Framing: every write is one HID output report of `packetSize + 1` bytes —
 * a 0x00 report id, then the payload zero-padded to `packetSize`. Commands
 * start with the ASCII prefix "CRT" + 0x00 0x00, followed by an ASCII opcode.
 * Image bytes are sent as raw chunks with no prefix at all.
 *
 * Everything in this module is a pure function so it can be unit-tested
 * without hardware.
 */

export const V1_PACKET_SIZE = 512;
export const REPORT_ID = 0x00;

const CMD_PREFIX = [0x43, 0x52, 0x54, 0x00, 0x00]; // "CRT"
const ACK = [0x41, 0x43, 0x4b]; // "ACK" — prefix of every input report

const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

/** Command bodies (everything after the "CRT\0\0" prefix). */
export const commands = {
  /** Wakes the screen; also the first packet of the init sequence. */
  wake: (): number[] => ascii('DIS'),

  /** Puts the device to sleep. */
  sleep: (): number[] => ascii('HAN'),

  /** Backlight brightness, 0..100. */
  brightness: (percent: number): number[] => {
    const value = Math.round(Math.min(100, Math.max(0, percent)));
    return [...ascii('LIG'), 0x00, 0x00, value];
  },

  /** Restores the boot logo on one key display (or all with CLEAR_ALL_KEYS). */
  clearKey: (imageKeyId: number): number[] => [...ascii('CLE'), 0x00, 0x00, 0x00, imageKeyId],

  /** Commits previously uploaded images to the displays. */
  commit: (): number[] => ascii('STP'),

  /**
   * Announces an image upload for one key display. The JPEG bytes follow as
   * raw chunks (see `frameImageChunks`), then `commit` makes them visible.
   */
  beginImage: (imageKeyId: number, byteLength: number): number[] => [
    ...ascii('BAT'),
    (byteLength >>> 24) & 0xff,
    (byteLength >>> 16) & 0xff,
    (byteLength >>> 8) & 0xff,
    byteLength & 0xff,
    imageKeyId,
  ],

  /** Tells the firmware the host is going away (sent before closing). */
  disconnect: (): number[] => [...ascii('CLE'), 0x00, 0x00, ...ascii('DC')],

  /** Periodic keep-alive used by some family members (not the D6). */
  keepAlive: (): number[] => ascii('CONNECT'),

  /** Some devices need an explicit mode before accepting other commands. */
  setMode: (mode: number): number[] => [...ascii('MOD'), 0x00, 0x00, 0x30 + mode],
} as const;

/** Passed to `commands.clearKey` to clear every display at once. */
export const CLEAR_ALL_KEYS = 0xff;

/** Frames a command body into a full HID output report. */
export function frameCommand(body: readonly number[], packetSize: number = V1_PACKET_SIZE): Buffer {
  const payloadLength = CMD_PREFIX.length + body.length;
  if (payloadLength > packetSize) {
    throw new RangeError(`Command payload is ${payloadLength} bytes, the packet size is ${packetSize}`);
  }

  const report = Buffer.alloc(packetSize + 1);
  report[0] = REPORT_ID;
  report.set(CMD_PREFIX, 1);
  report.set(body, 1 + CMD_PREFIX.length);
  return report;
}

/** Splits raw image data into zero-padded HID output reports. */
export function frameImageChunks(data: Uint8Array, packetSize: number = V1_PACKET_SIZE): Buffer[] {
  const chunks: Buffer[] = [];

  for (let offset = 0; offset < data.byteLength; offset += packetSize) {
    const report = Buffer.alloc(packetSize + 1);
    report[0] = REPORT_ID;
    report.set(data.subarray(offset, offset + packetSize), 1);
    chunks.push(report);
  }

  return chunks;
}

export type InputEvent =
  | { readonly type: 'key'; readonly rawKeyId: number; readonly pressed: boolean }
  /** The firmware reports a reset; any held keys should be released. */
  | { readonly type: 'reset' };

/**
 * Decodes an input report. Reports start with "ACK"; byte 9 carries the
 * device key id (0 = reset) and byte 10 the pressed state. Some HID stacks
 * prepend the report id, so both alignments are accepted.
 */
export function decodeInputReport(data: Uint8Array): InputEvent | null {
  let base = -1;
  if (startsWith(data, ACK, 0)) base = 0;
  else if (data[0] === REPORT_ID && startsWith(data, ACK, 1)) base = 1;
  if (base < 0 || data.length < base + 11) return null;

  const rawKeyId = data[base + 9]!;
  const pressed = data[base + 10]! !== 0;

  if (rawKeyId === 0) return { type: 'reset' };
  return { type: 'key', rawKeyId, pressed };
}

function startsWith(data: Uint8Array, prefix: readonly number[], offset: number): boolean {
  return prefix.every((byte, i) => data[offset + i] === byte);
}

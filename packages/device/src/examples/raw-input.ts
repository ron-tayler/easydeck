/**
 * Prints raw input reports, with no decoding in the way.
 *
 * Run with:  pnpm --filter @easydeck/device raw-input
 *
 * Use it to answer questions this package's own abstractions would hide —
 * most usefully, what the firmware actually reports when several keys are
 * held at once. Each line shows the bytes the protocol cares about (offset 9
 * is the key id, offset 10 the state) plus how they decode.
 */
import { FIFINE_AMPLIGAME_D6, NodeHidPort, protocolV1 } from '../index.js';
import type { HidDeviceInfo } from '../index.js';

const MODEL = FIFINE_AMPLIGAME_D6;

function matches(info: HidDeviceInfo): boolean {
  const idMatches = MODEL.usbIds.some(
    (id) => id.vendorId === info.vendorId && id.productId === info.productId,
  );
  if (!idMatches) return false;
  if (MODEL.usage && info.usagePage !== undefined) return info.usagePage === MODEL.usage.page;
  return true;
}

async function main(): Promise<void> {
  const port = new NodeHidPort();
  const device = (await port.enumerate()).find(matches);
  if (!device) {
    console.error('No supported device found.');
    process.exitCode = 1;
    return;
  }

  const connection = await port.open(device);
  console.log(`Opened ${MODEL.name} at ${device.path}`);

  // The D6 stays silent until it has seen the wake and brightness packets.
  await connection.write(protocolV1.frameCommand(protocolV1.commands.wake(), MODEL.packetSize));
  await connection.write(protocolV1.frameCommand(protocolV1.commands.brightness(0), MODEL.packetSize));
  await connection.write(protocolV1.frameCommand(protocolV1.commands.brightness(60), MODEL.packetSize));

  console.log('Listening. Try holding two keys at once, then releasing them');
  console.log('one by one. Ctrl+C to exit.\n');

  const started = Date.now();
  let count = 0;

  connection.onInput((report) => {
    const decoded = protocolV1.decodeInputReport(report);
    const head = [...report.subarray(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join(' ');
    const ms = String(Date.now() - started).padStart(6);
    const summary =
      decoded === null
        ? 'not an input report'
        : decoded.type === 'reset'
          ? 'reset'
          : `rawKey=${decoded.rawKeyId} ${decoded.pressed ? 'DOWN' : 'up  '} -> logical ${MODEL.inputKeyIds.indexOf(decoded.rawKeyId)}`;

    console.log(`${ms}ms  #${String(++count).padStart(3)}  ${head}  |  ${summary}`);
  });

  connection.onError((error) => console.error('HID error:', error.message));

  process.on('SIGINT', () => {
    void connection.close().finally(() => process.exit(0));
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

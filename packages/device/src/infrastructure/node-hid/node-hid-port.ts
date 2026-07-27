import HID from 'node-hid';

import type { HidConnection, HidDeviceInfo, HidPort } from '../../application/ports/hid-port.js';
import { DeviceOpenError } from '../../domain/errors.js';

/**
 * node-hid adapter. HID needs no drivers on any of the three platforms —
 * this is the whole reason the project talks HID instead of raw USB.
 */
export class NodeHidPort implements HidPort {
  async enumerate(): Promise<HidDeviceInfo[]> {
    const devices = await HID.devicesAsync();

    return devices
      .filter((d): d is typeof d & { path: string } => typeof d.path === 'string' && d.path.length > 0)
      .map((d) => ({
        path: d.path,
        vendorId: d.vendorId,
        productId: d.productId,
        usagePage: d.usagePage,
        usage: d.usage,
        interface: d.interface,
        serialNumber: d.serialNumber,
        manufacturer: d.manufacturer,
        product: d.product,
      }));
  }

  async open(device: HidDeviceInfo): Promise<HidConnection> {
    const handle = await HID.HIDAsync.open(device.path);
    return new NodeHidConnection(handle);
  }
}

class NodeHidConnection implements HidConnection {
  constructor(private readonly handle: HID.HIDAsync) {}

  async write(report: Uint8Array): Promise<number> {
    const buffer = Buffer.isBuffer(report) ? report : Buffer.from(report);
    const written = await this.handle.write(buffer);
    if (written < buffer.length) {
      throw new DeviceOpenError(`Short HID write: ${written} of ${buffer.length} bytes`);
    }
    return written;
  }

  onInput(listener: (report: Uint8Array) => void): void {
    this.handle.on('data', listener);
  }

  onError(listener: (error: Error) => void): void {
    this.handle.on('error', listener);
  }

  async close(): Promise<void> {
    await this.handle.close();
  }
}

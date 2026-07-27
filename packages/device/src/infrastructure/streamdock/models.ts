import type { DeviceModel } from '../../domain/device-model.js';

/**
 * FIFINE AmpliGame D6 — 15 keys (3x5) with 112x112 displays.
 *
 * A SINOWEALTH-based Stream Dock clone, protocol v1. Image commands number
 * the keys bottom-left row first (1-based), while input reports count
 * row-major from the top-left (1..15). Displays take baseline JPEG, mounted
 * upside down.
 *
 * Every value here is taken from a USB capture of the vendor software rather
 * than guessed: it sends 112x112 JPEGs at 4:2:0. That size is not arbitrary —
 * 4:2:0 has a 16x16 MCU and 112 divides by 16 exactly, so no partial block
 * ever lands on an edge. Other drivers for this family settle for 100x100,
 * which leaves a rim of the previous frame visible because the firmware
 * neither scales nor clears.
 */
export const FIFINE_AMPLIGAME_D6: DeviceModel = {
  id: 'fifine-ampligame-d6',
  name: 'FIFINE AmpliGame D6',
  protocol: 'streamdock-v1',
  usbIds: [
    { vendorId: 0x3142, productId: 0x0007 }, // FIFINE
    { vendorId: 0x3142, productId: 0x0060 }, // FIFINE, "HOTSPOTEKUSB HID DEMO" revision
    { vendorId: 0x258a, productId: 0x0150 }, // SINOWEALTH (earlier revision)
  ],
  usage: { page: 0xffa0, id: 0x01 },
  layout: { rows: 3, cols: 5 },
  keyImage: {
    encoding: 'jpeg',
    width: 112,
    height: 112,
    rotationDegrees: 180,
    maxBytes: 10240,
  },
  packetSize: 512,
  imageKeyIds: [11, 12, 13, 14, 15, 6, 7, 8, 9, 10, 1, 2, 3, 4, 5],
  inputKeyIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  // The vendor software sends CONNECT roughly every 8 seconds.
  supportsKeepAlive: true,
};

export const ALL_MODELS: readonly DeviceModel[] = [FIFINE_AMPLIGAME_D6];

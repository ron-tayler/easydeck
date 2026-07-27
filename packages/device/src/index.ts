/**
 * @easydeck/device — the device zone.
 *
 * Self-sufficient: everything above this package talks to the `Surface` and
 * `DeviceManager` abstractions and never sees HID reports or protocol bytes.
 *
 * Layout (DDD-flavoured):
 *   domain/          — Surface, DeviceModel, KeyLayout, errors. No dependencies.
 *   application/     — DeviceManager + outbound ports (HidPort, SurfaceFactory).
 *   infrastructure/  — node-hid adapter and the Stream Dock v1 protocol driver.
 */

export type { KeyLayout } from './domain/key-layout.js';
export { keyCount, isValidKey, toRowCol, toKeyIndex } from './domain/key-layout.js';
export type { KeyImageFormat } from './domain/key-image.js';
export type { DeviceModel, UsbId, HidUsage } from './domain/device-model.js';
export type { Surface, SurfaceEvents, SurfaceEventMap, SurfaceInfo, KeyEvent } from './domain/surface.js';
export {
  DeviceError,
  DeviceNotFoundError,
  DeviceOpenError,
  DeviceDisconnectedError,
  UnsupportedModelError,
  InvalidImageError,
  ImageTooLargeError,
} from './domain/errors.js';

export type { HidPort, HidConnection, HidDeviceInfo } from './application/ports/hid-port.js';
export type { SurfaceFactory, SurfaceOpenOptions } from './application/ports/surface-factory.js';
export { DeviceManager } from './application/device-manager.js';
export type { DiscoveredDevice } from './application/device-manager.js';

export { FIFINE_AMPLIGAME_D6, ALL_MODELS } from './infrastructure/streamdock/models.js';
export { StreamDockSurface, streamDockSurfaceFactory } from './infrastructure/streamdock/streamdock-surface.js';
export * as protocolV1 from './infrastructure/streamdock/protocol-v1.js';
export { NodeHidPort } from './infrastructure/node-hid/node-hid-port.js';

import { DeviceManager } from './application/device-manager.js';
import { ALL_MODELS } from './infrastructure/streamdock/models.js';
import { NodeHidPort } from './infrastructure/node-hid/node-hid-port.js';
import { streamDockSurfaceFactory } from './infrastructure/streamdock/streamdock-surface.js';

/** Convenience composition root: node-hid + every known model and protocol. */
export function createDeviceManager(): DeviceManager {
  return new DeviceManager(new NodeHidPort(), [streamDockSurfaceFactory], ALL_MODELS);
}

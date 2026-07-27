import type { DeviceModel } from '../../domain/device-model.js';
import type { Surface } from '../../domain/surface.js';
import type { HidConnection, HidDeviceInfo } from './hid-port.js';

export interface SurfaceOpenOptions {
  /** Initial brightness, 0..100. Defaults to 70. */
  readonly brightness?: number;
  /** Clear all key displays right after opening. Defaults to true. */
  readonly clearOnOpen?: boolean;
}

/**
 * Outbound port: turns an open HID connection into a live Surface.
 *
 * One factory exists per wire protocol; the DeviceManager picks the factory
 * whose `supports` accepts the model. This keeps the application layer free
 * of any protocol knowledge.
 */
export interface SurfaceFactory {
  supports(model: DeviceModel): boolean;
  create(
    connection: HidConnection,
    model: DeviceModel,
    hidInfo: HidDeviceInfo,
    options?: SurfaceOpenOptions,
  ): Promise<Surface>;
}

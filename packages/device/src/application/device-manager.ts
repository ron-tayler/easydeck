import type { DeviceModel } from '../domain/device-model.js';
import { DeviceNotFoundError, DeviceOpenError, UnsupportedModelError } from '../domain/errors.js';
import type { Surface } from '../domain/surface.js';
import type { HidDeviceInfo, HidPort } from './ports/hid-port.js';
import type { SurfaceFactory, SurfaceOpenOptions } from './ports/surface-factory.js';

export interface DiscoveredDevice {
  readonly model: DeviceModel;
  readonly hid: HidDeviceInfo;
}

/**
 * Application service: discovers supported devices on the HID bus and opens
 * them as Surfaces. Hotplug watching will land here later.
 */
export class DeviceManager {
  constructor(
    private readonly hid: HidPort,
    private readonly factories: readonly SurfaceFactory[],
    private readonly models: readonly DeviceModel[],
  ) {}

  async list(): Promise<DiscoveredDevice[]> {
    const all = await this.hid.enumerate();
    const found: DiscoveredDevice[] = [];

    for (const info of all) {
      const model = this.matchModel(info);
      if (model) found.push({ model, hid: info });
    }

    return found;
  }

  async open(device: DiscoveredDevice, options?: SurfaceOpenOptions): Promise<Surface> {
    const factory = this.factories.find((f) => f.supports(device.model));
    if (!factory) {
      throw new UnsupportedModelError(`No protocol implementation registered for model '${device.model.id}'`);
    }

    let connection;
    try {
      connection = await this.hid.open(device.hid);
    } catch (cause) {
      throw new DeviceOpenError(
        `Could not open '${device.model.name}' at ${device.hid.path}.`,
        { cause },
      );
    }

    try {
      return await factory.create(connection, device.model, device.hid, options);
    } catch (cause) {
      await connection.close().catch(() => undefined);
      throw cause;
    }
  }

  async openFirst(options?: SurfaceOpenOptions): Promise<Surface> {
    const [first] = await this.list();
    if (!first) throw new DeviceNotFoundError();
    return this.open(first, options);
  }

  private matchModel(info: HidDeviceInfo): DeviceModel | undefined {
    return this.models.find((model) => {
      const idMatches = model.usbIds.some(
        (id) => id.vendorId === info.vendorId && id.productId === info.productId,
      );
      if (!idMatches) return false;

      // Composite devices expose several HID interfaces (including a real
      // keyboard). When the OS reports usage information, require the vendor
      // control interface; when it does not, fall back to vid/pid alone.
      if (model.usage && info.usagePage !== undefined) {
        return info.usagePage === model.usage.page && (info.usage === undefined || info.usage === model.usage.id);
      }

      return true;
    });
  }
}

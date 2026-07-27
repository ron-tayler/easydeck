import { EventEmitter } from 'node:events';

import type { HidConnection, HidDeviceInfo } from '../../application/ports/hid-port.js';
import type { SurfaceFactory, SurfaceOpenOptions } from '../../application/ports/surface-factory.js';
import type { DeviceModel } from '../../domain/device-model.js';
import {
  DeviceDisconnectedError,
  ImageTooLargeError,
  InvalidImageError,
} from '../../domain/errors.js';
import { isValidKey, keyCount, toRowCol } from '../../domain/key-layout.js';
import type { KeyLayout } from '../../domain/key-layout.js';
import type { KeyImageFormat } from '../../domain/key-image.js';
import type { KeyEvent, Surface, SurfaceEventMap, SurfaceInfo } from '../../domain/surface.js';
import {
  CLEAR_ALL_KEYS,
  commands,
  decodeInputReport,
  frameCommand,
  frameImageChunks,
} from './protocol-v1.js';

const JPEG_MAGIC = [0xff, 0xd8];
const DEFAULT_BRIGHTNESS = 70;

/** Surface implementation for Stream Dock protocol v1 devices (FIFINE D6). */
export class StreamDockSurface extends EventEmitter<SurfaceEventMap> implements Surface {
  readonly info: SurfaceInfo;

  /** All writes are funneled through this chain so that a multi-report image
   * upload can never interleave with another command. */
  private writeChain: Promise<unknown> = Promise.resolve();
  private pressedKeys = new Set<number>();
  private closed = false;
  /**
   * The model's packet size is a default: D6 hardware revisions disagree
   * (512 vs 1024). The Windows HID stack pads every write to the interface's
   * real report length and reports it back, so the first command tells us the
   * true size. Image chunking must use it — zero padding inside a JPEG stream
   * would corrupt the image.
   */
  private effectivePacketSize: number;

  private constructor(
    private readonly connection: HidConnection,
    private readonly model: DeviceModel,
    hidInfo: HidDeviceInfo,
  ) {
    super();
    this.effectivePacketSize = model.packetSize;
    this.info = {
      modelId: model.id,
      modelName: model.name,
      serialNumber: hidInfo.serialNumber,
      path: hidInfo.path,
    };
  }

  static async open(
    connection: HidConnection,
    model: DeviceModel,
    hidInfo: HidDeviceInfo,
    options: SurfaceOpenOptions = {},
  ): Promise<StreamDockSurface> {
    const surface = new StreamDockSurface(connection, model, hidInfo);

    connection.onInput((report) => surface.handleInput(report));
    connection.onError((error) => surface.handleError(error));

    // Init sequence replicated byte-for-byte from mirajazz: the D6 ignores
    // the host until it has seen a wake plus a brightness packet.
    await surface.enqueue(async () => {
      await surface.sendCommand(commands.wake());
      await surface.sendCommand(commands.brightness(0));
      await surface.sendCommand(commands.brightness(options.brightness ?? DEFAULT_BRIGHTNESS));
      if (options.clearOnOpen !== false) {
        await surface.sendCommand(commands.clearKey(CLEAR_ALL_KEYS));
        await surface.sendCommand(commands.commit());
      }
    });

    return surface;
  }

  get layout(): KeyLayout {
    return this.model.layout;
  }

  get keyImage(): KeyImageFormat {
    return this.model.keyImage;
  }

  async setKeyImage(key: number, image: Uint8Array): Promise<void> {
    const imageKeyId = this.imageKeyId(key);

    if (image.byteLength < 2 || image[0] !== JPEG_MAGIC[0] || image[1] !== JPEG_MAGIC[1]) {
      throw new InvalidImageError(`Key image must be a JPEG (got ${image.byteLength} bytes with no JPEG marker)`);
    }
    if (image.byteLength > this.model.keyImage.maxBytes) {
      throw new ImageTooLargeError(image.byteLength, this.model.keyImage.maxBytes);
    }

    await this.enqueue(async () => {
      await this.sendCommand(commands.beginImage(imageKeyId, image.byteLength));
      for (const chunk of frameImageChunks(image, this.effectivePacketSize)) {
        await this.connection.write(chunk);
      }
      await this.sendCommand(commands.commit());
    });
  }

  async clearKey(key: number): Promise<void> {
    const imageKeyId = this.imageKeyId(key);
    await this.enqueue(() => this.sendCommand(commands.clearKey(imageKeyId)));
  }

  async clearAllKeys(): Promise<void> {
    await this.enqueue(async () => {
      await this.sendCommand(commands.clearKey(CLEAR_ALL_KEYS));
      // v2+ firmwares need a commit for the clear to take effect; harmless on v1.
      await this.sendCommand(commands.commit());
    });
  }

  async setBrightness(percent: number): Promise<void> {
    await this.enqueue(() => this.sendCommand(commands.brightness(percent)));
  }

  async wake(): Promise<void> {
    await this.enqueue(() => this.sendCommand(commands.wake()));
  }

  async sleep(): Promise<void> {
    await this.enqueue(() => this.sendCommand(commands.sleep()));
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    // Best effort: tell the firmware we are leaving, then release the handle.
    await this.writeChain.catch(() => undefined);
    try {
      await this.sendCommand(commands.disconnect());
      await this.sendCommand(commands.sleep());
    } catch {
      // The device may already be gone; closing the handle is what matters.
    }
    await this.connection.close();
  }

  private imageKeyId(key: number): number {
    if (!isValidKey(this.model.layout, key)) {
      throw new RangeError(`Key index ${key} is out of range (0..${keyCount(this.model.layout) - 1})`);
    }
    return this.model.imageKeyIds[key]!;
  }

  private async sendCommand(body: readonly number[]): Promise<void> {
    const written = await this.connection.write(frameCommand(body, this.effectivePacketSize));

    const reported = written - 1; // minus the report id byte
    if (reported !== this.effectivePacketSize && (reported === 512 || reported === 1024)) {
      this.effectivePacketSize = reported;
    }
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new DeviceDisconnectedError());
    const result = this.writeChain.then(task, task);
    this.writeChain = result.catch(() => undefined);
    return result;
  }

  private handleInput(report: Uint8Array): void {
    const event = decodeInputReport(report);
    if (!event) return;

    if (event.type === 'reset') {
      // Firmware reset: release everything we believe is held.
      for (const key of [...this.pressedKeys]) this.emitKey('keyUp', key);
      this.pressedKeys.clear();
      return;
    }

    const key = this.model.inputKeyIds.indexOf(event.rawKeyId);
    if (key < 0) return;

    if (event.pressed) {
      if (this.pressedKeys.has(key)) {
        // Duplicate press means the release report was lost — synthesize it
        // so downstream actions still fire once per physical press.
        this.emitKey('keyUp', key);
      }
      this.pressedKeys.add(key);
      this.emitKey('keyDown', key);
    } else {
      if (!this.pressedKeys.delete(key)) return; // duplicate release
      this.emitKey('keyUp', key);
    }
  }

  private emitKey(type: 'keyDown' | 'keyUp', key: number): void {
    const { row, col } = toRowCol(this.model.layout, key);
    const event: KeyEvent = { key, row, col };
    this.emit(type, event);
  }

  private handleError(error: Error): void {
    this.emit('error', error);
    if (!this.closed) {
      this.closed = true;
      this.emit('disconnected');
    }
  }
}

export const streamDockSurfaceFactory: SurfaceFactory = {
  supports: (model) => model.protocol === 'streamdock-v1',
  create: (connection, model, hidInfo, options) => StreamDockSurface.open(connection, model, hidInfo, options),
};

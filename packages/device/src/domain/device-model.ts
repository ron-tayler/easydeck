import type { KeyImageFormat } from './key-image.js';
import type { KeyLayout } from './key-layout.js';

export interface UsbId {
  readonly vendorId: number;
  readonly productId: number;
}

export interface HidUsage {
  readonly page: number;
  readonly id: number;
}

/**
 * Static passport of a supported device model.
 *
 * A model is pure data: which USB ids it appears under, how its keys are laid
 * out, what its displays expect, and which wire protocol drives it. Adding
 * support for a new Stream Dock family device should ideally be just another
 * one of these.
 */
export interface DeviceModel {
  readonly id: string;
  readonly name: string;
  /** Discriminator used to pick a protocol implementation for this model. */
  readonly protocol: 'streamdock-v1';
  readonly usbIds: readonly UsbId[];
  /**
   * HID usage of the vendor control interface. These devices are composite
   * (they also expose a regular keyboard interface); this selects the right
   * interface during discovery so we never touch the keyboard one.
   */
  readonly usage?: HidUsage;
  readonly layout: KeyLayout;
  readonly keyImage: KeyImageFormat;
  /** HID output report payload size, excluding the report id byte. */
  readonly packetSize: number;
  /** Device-side key id used by image/clear commands, indexed by logical key. */
  readonly imageKeyIds: readonly number[];
  /** Device-side key id found in input reports, indexed by logical key. */
  readonly inputKeyIds: readonly number[];
  /** Whether the device expects periodic keep-alive packets. */
  readonly supportsKeepAlive: boolean;
}

/**
 * Outbound port: everything the device zone needs from a HID stack.
 *
 * The only implementation today wraps node-hid, but tests use an in-memory
 * fake, and a WebHID adapter would slot in here as well.
 */
export interface HidDeviceInfo {
  readonly path: string;
  readonly vendorId: number;
  readonly productId: number;
  readonly usagePage?: number;
  readonly usage?: number;
  readonly interface?: number;
  readonly serialNumber?: string;
  readonly manufacturer?: string;
  readonly product?: string;
}

export interface HidConnection {
  /**
   * Writes one output report, including the leading report id byte.
   * Returns the number of bytes actually written: on Windows the HID stack
   * pads reports to the interface's real report length, and drivers use that
   * feedback to discover the device's true packet size.
   */
  write(report: Uint8Array): Promise<number>;
  onInput(listener: (report: Uint8Array) => void): void;
  onError(listener: (error: Error) => void): void;
  close(): Promise<void>;
}

export interface HidPort {
  enumerate(): Promise<HidDeviceInfo[]>;
  open(device: HidDeviceInfo): Promise<HidConnection>;
}

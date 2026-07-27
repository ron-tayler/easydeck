/** Base class for every error raised by the device zone. */
export class DeviceError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class DeviceNotFoundError extends DeviceError {
  constructor(message = 'No supported device found. Check that it is plugged in and that the cable carries data.') {
    super(message);
  }
}

export class DeviceOpenError extends DeviceError {}

export class DeviceDisconnectedError extends DeviceError {
  constructor(message = 'The device connection is closed') {
    super(message);
  }
}

export class UnsupportedModelError extends DeviceError {}

export class InvalidImageError extends DeviceError {}

export class ImageTooLargeError extends DeviceError {
  constructor(
    readonly byteLength: number,
    readonly maxBytes: number,
  ) {
    super(`Encoded key image is ${byteLength} bytes, the device accepts at most ${maxBytes} bytes`);
  }
}

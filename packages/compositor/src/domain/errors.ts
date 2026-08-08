export class CompositorError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CompositorError';
  }
}

/** A scene that could never be shown: overlapping or out-of-bounds regions. */
export class InvalidSceneError extends CompositorError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidSceneError';
  }
}

/** Base class for every error raised by the engine zone. */
export class EngineError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** A profile document is structurally invalid and cannot be loaded. */
export class InvalidProfileError extends EngineError {}

/** An action referenced a type that no handler is registered for. */
export class UnknownActionError extends EngineError {
  constructor(readonly actionType: string) {
    super(`No handler registered for action type '${actionType}'`);
  }
}

/** An action handler threw. Carries enough context to point at the culprit. */
export class ActionFailedError extends EngineError {
  constructor(
    readonly actionType: string,
    readonly buttonId: string,
    options?: ErrorOptions,
  ) {
    super(`Action '${actionType}' on button '${buttonId}' failed`, options);
  }
}

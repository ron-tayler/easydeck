/**
 * @easydeck/engine — the logic zone.
 *
 * Owns the model a profile is written in (Profile -> Page -> Button -> State),
 * the reactive variables that make buttons reflect the world, and the
 * dispatch of actions bound to key events.
 *
 * Self-contained by design: it depends on neither the device nor the renderer
 * zone, reaching them through the ports in `application/ports` instead. That
 * is what lets the whole engine be tested without hardware, a canvas or a
 * single byte of JPEG.
 */

export type { VariableValue, VariableChange } from './domain/variables.js';
export { VariableStore } from './domain/variables.js';
export { referencedVariables, renderTemplate, hasPlaceholders } from './domain/template.js';
export type { ButtonVisual, ButtonVisualTemplate, IconSpec, LabelSpec } from './domain/visual.js';
export type {
  ActionDescriptor,
  ActionContext,
  ActionHandler,
  ButtonEvent,
} from './domain/action.js';
export { BUTTON_EVENTS, stringParam, numberParam, valueParam } from './domain/action.js';
export type {
  ProfileDefinition,
  PageDefinition,
  ButtonDefinition,
  ButtonStateDefinition,
} from './domain/profile.js';
export { validateProfile } from './domain/validate-profile.js';
export {
  EngineError,
  InvalidProfileError,
  UnknownActionError,
  ActionFailedError,
} from './domain/errors.js';

export type { SurfacePort } from './application/ports/surface-port.js';
export type { KeyRendererPort } from './application/ports/renderer-port.js';
export type { ClockPort, TimerHandle } from './application/ports/clock-port.js';
export { systemClock } from './application/ports/clock-port.js';
export { ActionRegistry } from './application/action-registry.js';
export { registerBuiltinActions } from './application/builtin-actions.js';
export { DeckController } from './application/deck-controller.js';
export type { DeckControllerOptions, DeckControllerEvents } from './application/deck-controller.js';

import { ActionRegistry } from './application/action-registry.js';
import { registerBuiltinActions } from './application/builtin-actions.js';

/** An action registry with the built-in, I/O-free actions already in it. */
export function createActionRegistry(): ActionRegistry {
  return registerBuiltinActions(new ActionRegistry());
}

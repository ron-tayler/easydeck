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

export type {
  VariableValue,
  VariableChange,
  VariableType,
  VariableOption,
  VariableDeclaration,
  VariableArgument,
} from './domain/variables.js';
export {
  VariableStore,
  VARIABLE_TYPES,
  coerceVariable,
  inferVariableType,
  initialVariableValue,
  parseVariableKey,
  variableKey,
} from './domain/variables.js';
export { referencedVariables, renderTemplate, hasPlaceholders } from './domain/template.js';
export { variablesReadBy } from './domain/profile-variables.js';
export type {
  ButtonVisual,
  ButtonVisualTemplate,
  BackdropSlice,
  IconSpec,
  LabelSpec,
} from './domain/visual.js';
export type {
  ActionDescriptor,
  ActionContext,
  ActionHandler,
  ButtonEvent,
} from './domain/action.js';
export { BUTTON_EVENTS, stringParam, numberParam, valueParam } from './domain/action.js';
export type {
  ProfileDefinition,
  FolderDefinition,
  PageDefinition,
  ButtonDefinition,
  ButtonStateDefinition,
  DeckLocation,
  StateRange,
} from './domain/profile.js';
export { PROFILE_FORMAT_VERSION, MAX_PAGES_PER_FOLDER } from './domain/profile.js';
export { isStateRange, withinRange } from './domain/profile.js';
export { ProfileTree } from './domain/profile-tree.js';
export { validateProfile } from './domain/validate-profile.js';
export {
  EngineError,
  InvalidProfileError,
  UnknownActionError,
  ActionFailedError,
} from './domain/errors.js';

export type { PresenterPort } from './application/ports/presenter-port.js';
export { GestureRecognizer } from './application/gesture-recognizer.js';
export type { GestureRecognizerOptions } from './application/gesture-recognizer.js';
export type {
  Scene,
  SceneAsset,
  SceneImage,
  SceneLabel,
  SceneRegion,
} from './domain/scene.js';
export { sceneKeys, sceneSignature } from './domain/scene.js';
export type { ClockPort, TimerHandle } from './application/ports/clock-port.js';
export { systemClock } from './application/ports/clock-port.js';
export { ActionRegistry } from './application/action-registry.js';
export {
  registerBuiltinActions,
  EASYDECK_PLUGIN_ID,
  VARIABLES_PLUGIN_ID,
  navigationManifest,
  variablesManifest,
} from './application/builtin-actions.js';
export type {
  PluginManifest,
  PluginCommand,
  ButtonPreset,
  PresetButton,
  ActionDefinition,
  ParamDefinition,
  ParamOption,
  ParamType,
  LocalizedText,
} from './domain/plugin.js';
export type {
  OptionLoader,
  Plugin,
  PluginHost,
  PluginStatus,
  RouteHandler,
  RouteRequest,
  RouteResponse,
} from './domain/plugin-host.js';
export { PLUGIN_API_VERSION, localized } from './domain/plugin.js';
export { DeckController } from './application/deck-controller.js';
export type {
  DeckControllerOptions,
  DeckControllerEvents,
  KeyView,
} from './application/deck-controller.js';

import { ActionRegistry } from './application/action-registry.js';
import { registerBuiltinActions } from './application/builtin-actions.js';

/** An action registry with the built-in, I/O-free actions already in it. */
export function createActionRegistry(): ActionRegistry {
  return registerBuiltinActions(new ActionRegistry());
}

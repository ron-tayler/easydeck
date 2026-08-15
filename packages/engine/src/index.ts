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
export type { IconParam, IconBinding } from './domain/icon-params.js';
export {
  readIconParams,
  iconParamsProblem,
  resolveIconParams,
  applyIconParams,
  easydeckMetadata,
  svgTextOf,
  svgSourceOf,
} from './domain/icon-params.js';
export type { IconColorSlot } from './domain/icon-colors.js';
export {
  iconPaletteProblem,
  readIconPalette,
  resolveIconColors,
  usesCurrentColor,
  withRootColor,
} from './domain/icon-colors.js';
export type { DrawableIcon } from './domain/icon-source.js';
export { drawableIcon } from './domain/icon-source.js';
export type { IconLayer, PlacedPicture } from './domain/icon-layout.js';
export {
  ICON_CANVAS,
  composeIcon,
  isComposedIcon,
  readIconLayers,
  readLayerSource,
} from './domain/icon-layout.js';
export { variablesReadBy } from './domain/profile-variables.js';
export type { Condition, ConditionOperator, ConditionSource } from './domain/condition.js';
export { evaluateCondition } from './domain/condition.js';
export { CORE_DELAY, CORE_FOR, CORE_IF, CORE_STEPS, isCoreStep } from './domain/action.js';
export { MAX_DEPTH, MAX_REPEATS, MAX_STEPS, ScriptLimitError, runScript } from './application/script-runner.js';
export type { ScriptHost } from './application/script-runner.js';
export type { StepPath } from './domain/script-tree.js';
export {
  insertStep,
  isInside,
  listAt,
  moveStep,
  removeStep,
  stepAt,
  updateStep,
} from './domain/script-tree.js';
export type { KeyboardKey, KeyGroup } from './domain/keyboard-keys.js';
export {
  KEYBOARD_KEYS,
  MAX_HOTKEY_KEYS,
  formatHotkey,
  hotkeyProblem,
  keyboardKey,
  orderedHotkey,
  parseHotkey,
} from './domain/keyboard-keys.js';
export type {
  ButtonVisual,
  ButtonVisualTemplate,
  BackdropSlice,
  IconSpec,
  LabelSpec,
} from './domain/visual.js';
export type {
  BackgroundSpec,
  GradientBackground,
  GradientSpot,
  GradientStop,
  LinearGradient,
} from './domain/background.js';
export {
  DEFAULT_BACKGROUND,
  backgroundBase,
  backgroundCss,
  backgroundSignature,
  colorAt,
  contrastInk,
  gradientLine,
  hasGradient,
  linearGradientCss,
  mixColors,
  opacityOf,
  orderedStops,
  sampleStops,
  shade,
  withBase,
  withOpacity,
  withoutGradient,
} from './domain/background.js';
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
  Ticker,
} from './domain/plugin-host.js';
export type {
  SurfaceDefinition,
  SurfaceFrame,
  SurfaceProvider,
  SurfaceRequest,
  SurfaceSpec,
  WidgetOnScreen,
  WidgetOverride,
} from './domain/surface-spec.js';
export { surfaceKey } from './domain/surface-spec.js';
export { PLUGIN_API_VERSION, localized, readList } from './domain/plugin.js';
export { definePlugin } from './domain/plugin-module.js';
export type { PluginActivation, PluginModule } from './domain/plugin-module.js';
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

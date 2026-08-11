/**
 * @easydeck/core — the composition root.
 *
 * The only place that knows about every other zone at once: it opens a
 * surface from @easydeck/device, builds a renderer from @easydeck/renderer,
 * and hands both to @easydeck/engine through the adapters below. It also owns
 * everything that touches the machine — stored profiles, settings, the
 * actions that launch programs or press keys, and the API a configurator
 * talks to.
 */

// Re-exported because they appear in this package's own public interface:
// a consumer should not have to depend on @easydeck/engine to name the types
// core hands it.
export type {
  ProfileDefinition,
  FolderDefinition,
  PageDefinition,
  ButtonDefinition,
  ButtonStateDefinition,
  ActionDescriptor,
  ButtonEvent,
  ButtonVisual,
  IconSpec,
  IconParam,
  IconBinding,
  LabelSpec,
  KeyView,
  VariableValue,
  VariableType,
  VariableOption,
  VariableDeclaration,
  VariableArgument,
  PluginManifest,
  PluginCommand,
  ButtonPreset,
  PresetButton,
  PluginStatus,
  StateRange,
  ActionDefinition,
  ParamDefinition,
  ParamOption,
  ParamType,
  LocalizedText,
  KeyboardKey,
  KeyGroup,
  Condition,
  ConditionOperator,
  ConditionSource,
  StepPath,
} from '@easydeck/engine';
export { PLUGIN_API_VERSION, localized } from '@easydeck/engine';

export type { DaemonSettings } from './domain/settings.js';
export { DEFAULT_SETTINGS, normalizeSettings } from './domain/settings.js';
export {
  DaemonError,
  ProfileNotFoundError,
  InvalidProfileIdError,
  NoProfilesError,
} from './domain/errors.js';
export type {
  RequestMessage,
  ResponseMessage,
  EventMessage,
  ServerMessage,
  ApiEvent,
  DeckState,
  DeckSummary,
} from './domain/api-messages.js';
export { API_PROTOCOL_VERSION, isRequestMessage } from './domain/api-messages.js';

export type {
  ProfileRepository,
  ProfileSummary,
  SettingsRepository,
} from './application/ports/repositories.js';
export type {
  AppFolder,
  DeckFacade,
  ApiSource,
  InstalledPluginInfo,
  InstalledPluginSummary,
} from './application/ports/deck-facade.js';
export type { DeckEvents } from './application/ports/deck-events.js';
export { ApiHandler } from './application/api-handler.js';
export { DeckService } from './application/deck-service.js';
export type { DeckServiceEvents, DeckServiceOptions } from './application/deck-service.js';

export {
  configDir,
  profilesDir,
  pluginsDir,
  iconsDir,
  settingsFile,
} from './infrastructure/config-paths.js';
export type { Library, LibraryImage } from './infrastructure/icon-library.js';
export { registerEasyDeckFolderActions } from './infrastructure/actions/folder-actions.js';
export { PluginRuntime } from './application/plugin-runtime.js';
export type {
  PluginState,
  PluginRuntimeEvents,
  PluginRuntimeOptions,
} from './application/plugin-runtime.js';
export { PluginSettingsStore } from './infrastructure/plugins/plugin-settings-store.js';
export {
  HardwarePlugin,
  hardwareManifest,
  findDisks,
  registerHardwarePlugin,
  HARDWARE_PLUGIN_ID,
} from './infrastructure/plugins/hardware-plugin.js';
export { registerObsPlugin, obsManifest, OBS_PLUGIN_ID } from './infrastructure/plugins/obs/obs-plugin.js';
export { registerVtsPlugin, vtsManifest, VTS_PLUGIN_ID } from './infrastructure/plugins/vts/vts-plugin.js';
export { ObsConnection } from './infrastructure/plugins/obs/obs-connection.js';
export { plainSecretVault } from './application/ports/secret-vault.js';
export type { SecretVault } from './application/ports/secret-vault.js';
export { pluginSettingsDir, secretsDir } from './infrastructure/config-paths.js';
export { migrateProfile } from './infrastructure/migrate-profile.js';
export { writeZip } from './infrastructure/zip-writer.js';
export { exportProfile, importProfile } from './infrastructure/profile-archive.js';
export type { ZipFile } from './infrastructure/zip-writer.js';
export { FileProfileRepository, assertSafeProfileId } from './infrastructure/file-profile-repository.js';
export { FileSettingsRepository } from './infrastructure/file-settings-repository.js';
export { registerSystemActions } from './infrastructure/actions/system-actions.js';
export { registerDeviceActions } from './infrastructure/actions/device-actions.js';
export type { BrightnessControl } from './infrastructure/actions/device-actions.js';
export { registerKeyboardActions } from './infrastructure/actions/keyboard-actions.js';
export type { KeyboardActionsResult } from './infrastructure/actions/keyboard-actions.js';
export { registerMediaActions } from './infrastructure/actions/media-actions.js';
export type { MediaActionsResult } from './infrastructure/actions/media-actions.js';
export { toComposerPort } from './infrastructure/composer-adapter.js';
export {
  toEncoderPort,
  toPanelFormat,
  toPanelPort,
  toPresenterPort,
} from './infrastructure/panel-adapter.js';
export { startApiServer } from './infrastructure/api/websocket-server.js';
export { findUiDirectory } from './infrastructure/api/ui-directory.js';
export { localAddresses } from './infrastructure/api/network-addresses.js';
export type { NetworkAddress } from './infrastructure/api/network-addresses.js';
export type { ApiServerOptions, RunningApiServer } from './infrastructure/api/websocket-server.js';
export { loadOrCreateToken, tokenMatches, originAllowed } from './infrastructure/api/auth-token.js';

export { DeckRegistry } from './application/deck-registry.js';
export { DeviceDirectory } from './application/device-directory.js';
export type { DeviceSummary } from './application/device-directory.js';
export type { DeckEntry, DeckRegistryEvents } from './application/deck-registry.js';
export { createPhysicalDeck } from './infrastructure/physical-deck.js';
export { deckIdFor } from './infrastructure/deck-id.js';

export { startDeck } from './start-deck.js';
export type { StartDeckOptions } from './start-deck.js';
export { createStarterProfile } from './starter-profile.js';

/**
 * @easydeck/daemon — the composition root.
 *
 * The only place that knows about every other zone at once: it opens a
 * surface from @easydeck/device, builds a renderer from @easydeck/renderer,
 * and hands both to @easydeck/engine through the adapters below. It also owns
 * everything that touches the machine — stored profiles, settings, and the
 * actions that launch programs or press keys.
 *
 * Still to come: the WebSocket API for the configurator, and autostart.
 */

export type { DaemonSettings } from './domain/settings.js';
export { DEFAULT_SETTINGS, normalizeSettings } from './domain/settings.js';
export {
  DaemonError,
  ProfileNotFoundError,
  InvalidProfileIdError,
  NoProfilesError,
} from './domain/errors.js';

export type {
  ProfileRepository,
  ProfileSummary,
  SettingsRepository,
} from './application/ports/repositories.js';

export { configDir, profilesDir, settingsFile } from './infrastructure/config-paths.js';
export { FileProfileRepository, assertSafeProfileId } from './infrastructure/file-profile-repository.js';
export { FileSettingsRepository } from './infrastructure/file-settings-repository.js';
export { registerSystemActions } from './infrastructure/actions/system-actions.js';
export { registerDeviceActions } from './infrastructure/actions/device-actions.js';
export { registerKeyboardActions } from './infrastructure/actions/keyboard-actions.js';
export type { KeyboardActionsResult } from './infrastructure/actions/keyboard-actions.js';
export { toSurfacePort } from './infrastructure/surface-adapter.js';
export { toKeyRendererPort } from './infrastructure/renderer-adapter.js';

export { startDeck } from './start-deck.js';
export type { RunningDeck, StartDeckOptions } from './start-deck.js';

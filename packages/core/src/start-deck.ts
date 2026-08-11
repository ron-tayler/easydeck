import { DeviceNotFoundError, createDeviceManager } from '@easydeck/device';
import type { Surface } from '@easydeck/device';
import { ActionRegistry, createActionRegistry } from '@easydeck/engine';
import type { ProfileDefinition } from '@easydeck/engine';

import { DeckService } from './application/deck-service.js';
import type { ProfileRepository, SettingsRepository } from './application/ports/repositories.js';
import { NoProfilesError, ProfileNotFoundError } from './domain/errors.js';
import { DEFAULT_SETTINGS } from './domain/settings.js';
import type { DaemonSettings } from './domain/settings.js';
import { registerDeviceActions } from './infrastructure/actions/device-actions.js';
import { registerEasyDeckFolderActions } from './infrastructure/actions/folder-actions.js';
import { registerKeyboardActions } from './infrastructure/actions/keyboard-actions.js';
import { ButtonSecretStore } from './infrastructure/button-secrets.js';
import { registerMediaActions } from './infrastructure/actions/media-actions.js';
import { registerSystemActions } from './infrastructure/actions/system-actions.js';
import { FileProfileRepository } from './infrastructure/file-profile-repository.js';
import { FileSettingsRepository } from './infrastructure/file-settings-repository.js';
import { DeckRegistry } from './application/deck-registry.js';
import { PluginRuntime } from './application/plugin-runtime.js';
import { PluginSettingsStore } from './infrastructure/plugins/plugin-settings-store.js';
import { registerHardwarePlugin } from './infrastructure/plugins/hardware-plugin.js';
import { registerObsPlugin } from './infrastructure/plugins/obs/obs-plugin.js';
import { registerVtsPlugin } from './infrastructure/plugins/vts/vts-plugin.js';
import { openTarget } from './infrastructure/actions/system-actions.js';
import type { DeviceDirectory } from './application/device-directory.js';
import type { SecretVault } from './application/ports/secret-vault.js';
import { deckIdFor } from './infrastructure/deck-id.js';
import { createPhysicalDeck } from './infrastructure/physical-deck.js';

export interface StartDeckOptions {
  /** Profile to run. Omit to take it from storage. */
  readonly profile?: ProfileDefinition;
  readonly profiles?: ProfileRepository;
  readonly settings?: SettingsRepository;
  /** Overrides the stored brightness. */
  readonly brightness?: number;
  /**
   * Registry to run actions from. Omit to get the built-ins plus the
   * daemon's own system, device and (if available) keyboard actions.
   */
  readonly actions?: ActionRegistry;
  /** Reload the active profile when its file changes. On by default. */
  readonly watchProfiles?: boolean;
  /** Devices allowed in, and devices asking to be. */
  readonly devices?: DeviceDirectory;
  /** Brings the API server in line with the stored settings. */
  readonly applyNetwork?: () => Promise<{ port: number; networkAccess: boolean } | undefined>;
  /**
   * How a plugin's tokens are sealed on disk.
   *
   * Supplied by the desktop app, which has the platform key store; without
   * one they are written as they are, and the file says so.
   */
  readonly secrets?: SecretVault;
}

/**
 * Opens the first supported device and runs a profile on it.
 *
 * This is the whole stack in one call, and what the daemon and its examples
 * are built around.
 */
export async function startDeck(options: StartDeckOptions = {}): Promise<DeckService> {
  const profiles = options.profiles ?? new FileProfileRepository();
  const settingsRepository = options.settings ?? new FileSettingsRepository();
  const settings = await settingsRepository.load();
  const profile = options.profile ?? (await resolveProfile(profiles, settings));

  const manager = createDeviceManager();
  const devices = await manager.list();
  if (devices.length === 0) throw new DeviceNotFoundError();

  const initialBrightness = options.brightness ?? settings.brightness;
  const opened: Surface[] = [];

  try {
    /*
     * Every panel that is plugged in, not just the first.
     *
     * Each becomes a deck of its own: its own profile, page and history, but
     * the same variables, because there is one truth about the machine and
     * several ways to reach it.
     */
    for (const device of devices) {
      opened.push(await manager.open(device, { brightness: initialBrightness }));
    }

    /*
     * Brightness belongs to the service — it clamps, persists and reports it —
     * but actions have to be registered before the service can be built. This
     * holder closes the cycle, and hands the plugin the one operation it
     * needs rather than the whole service.
     */
    let service: DeckService | undefined;
    const brightness = {
      current: () => service?.currentBrightness ?? initialBrightness,
      set: async (percent: number) => {
        if (service) await service.setBrightness(percent);
        else {
          const clamped = Math.min(100, Math.max(0, Math.round(percent)));
          for (const surface of opened) await surface.setBrightness(clamped);
        }
      },
    };

    const warnings: string[] = [];
    // Only when the caller did not bring a registry of its own: a test or an
    // example that supplies one is asking for exactly what it listed.
    const builtIn = options.actions === undefined;
    let actions = options.actions;
    let registry: DeckRegistry | undefined;

    // Sealed the same way a plugin's tokens are, and outside every profile —
    // which is the whole point of it. See button-secrets.ts.
    const buttonSecrets = new ButtonSecretStore(options.secrets);

    if (!actions) {
      actions = registerSystemActions(createActionRegistry());
      registerEasyDeckFolderActions(actions);
      registerDeviceActions(actions, (deckId) => registry?.get(deckId)?.surface, brightness);
      const keyboard = await registerKeyboardActions(actions, buttonSecrets);
      if (keyboard.reason) warnings.push(keyboard.reason);
      const media = await registerMediaActions(actions);
      if (media.reason) warnings.push(media.reason);
    }

    registry = new DeckRegistry(actions);

    for (const [index, surface] of opened.entries()) {
      const device = devices[index]!;
      const id = deckIdFor(device);
      const binding = settings.decks?.[id];

      const deck = await createPhysicalDeck({
        surface,
        id,
        name: binding?.name ?? device.model.name,
        actions,
        variables: registry.variables,
      });

      await registry.add(deck, await profileForDeck(profiles, binding?.profileId, profile));
    }

    /*
     * Plugins with a life of their own, as opposed to a list of actions.
     *
     * Nothing is installed here yet — the built-ins are actions and nothing
     * more. It exists from the start so that a plugin which does hold a
     * connection has somewhere to hold it, and so its variables land in the
     * store every deck reads.
     */
    const plugins = new PluginRuntime({
      settings: new PluginSettingsStore(options.secrets),
      variables: registry.variables,
      openExternal: (url) => openTarget(url),
      log: (pluginId, level, message) => {
        if (level === 'error') warnings.push(`${pluginId}: ${message}`);
      },
    });

    if (builtIn) {
      await registerHardwarePlugin(actions, plugins);
      await registerObsPlugin(actions, plugins);
      await registerVtsPlugin(actions, plugins);
    }

    const watchDirectory =
      options.watchProfiles !== false && profiles instanceof FileProfileRepository
        ? profiles.path
        : undefined;

    service = new DeckService({
      decks: registry,
      ...(options.devices ? { devices: options.devices } : {}),
      ...(options.applyNetwork ? { applyNetwork: options.applyNetwork } : {}),
      actions,
      plugins,
      profiles,
      buttonSecrets,
      settings: settingsRepository,
      settingsValue: { ...settings, brightness: initialBrightness },
      warnings,
      watchDirectory,
    });
    return service;
  } catch (error) {
    for (const surface of opened) await surface.close().catch(() => undefined);
    throw error;
  }
}

/**
 * The profile this deck is bound to, or the daemon's default.
 *
 * A binding that no longer resolves — the profile was deleted, or the settings
 * were edited by hand — falls back rather than refusing to start: a deck
 * showing the wrong profile is recoverable from the configurator, and a deck
 * that will not come up is not.
 */
async function profileForDeck(
  profiles: ProfileRepository,
  profileId: string | undefined,
  fallback: ProfileDefinition,
): Promise<ProfileDefinition> {
  if (!profileId) return fallback;

  try {
    if (await profiles.has(profileId)) return await profiles.load(profileId);
  } catch {
    // Unreadable is the same as missing as far as starting up is concerned.
  }

  return fallback;
}

async function resolveProfile(
  profiles: ProfileRepository,
  settings: DaemonSettings,
): Promise<ProfileDefinition> {
  if (settings.activeProfileId) {
    if (await profiles.has(settings.activeProfileId)) return profiles.load(settings.activeProfileId);
    throw new ProfileNotFoundError(settings.activeProfileId);
  }

  // No preference recorded: run whatever is there, so a fresh install that
  // just dropped a profile in the folder still starts.
  const [first] = await profiles.list();
  if (!first) {
    throw new NoProfilesError(
      profiles instanceof FileProfileRepository ? profiles.path : 'the profile repository',
    );
  }
  return profiles.load(first.id);
}

export { DEFAULT_SETTINGS };

import { createDeviceManager } from '@easydeck/device';
import { ActionRegistry, DeckController, createActionRegistry } from '@easydeck/engine';
import type { ProfileDefinition } from '@easydeck/engine';
import { createKeyRenderer } from '@easydeck/renderer';

import { DeckService } from './application/deck-service.js';
import type { ProfileRepository, SettingsRepository } from './application/ports/repositories.js';
import { NoProfilesError, ProfileNotFoundError } from './domain/errors.js';
import { DEFAULT_SETTINGS } from './domain/settings.js';
import type { DaemonSettings } from './domain/settings.js';
import { registerDeviceActions } from './infrastructure/actions/device-actions.js';
import { registerEasyDeckFolderActions } from './infrastructure/actions/easydeck-actions.js';
import { registerKeyboardActions } from './infrastructure/actions/keyboard-actions.js';
import { registerSystemActions } from './infrastructure/actions/system-actions.js';
import { FileProfileRepository } from './infrastructure/file-profile-repository.js';
import { FileSettingsRepository } from './infrastructure/file-settings-repository.js';
import { toKeyRendererPort } from './infrastructure/renderer-adapter.js';
import { toSurfacePort } from './infrastructure/surface-adapter.js';

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

  const surface = await createDeviceManager().openFirst({
    brightness: options.brightness ?? settings.brightness,
  });

  try {
    const renderer = await createKeyRenderer();

    const warnings: string[] = [];
    let actions = options.actions;
    if (!actions) {
      actions = registerSystemActions(createActionRegistry());
      registerEasyDeckFolderActions(actions);
      registerDeviceActions(actions, surface);
      const keyboard = await registerKeyboardActions(actions);
      if (keyboard.reason) warnings.push(keyboard.reason);
    }

    const controller = new DeckController(
      toSurfacePort(surface),
      toKeyRendererPort(renderer, surface.keyImage),
      actions,
    );

    controller.load(profile);
    await controller.start();

    const watchDirectory =
      options.watchProfiles !== false && profiles instanceof FileProfileRepository
        ? profiles.path
        : undefined;

    return new DeckService({
      surface,
      controller,
      actions,
      profiles,
      settings: settingsRepository,
      settingsValue: { ...settings, brightness: options.brightness ?? settings.brightness },
      warnings,
      watchDirectory,
    });
  } catch (error) {
    await surface.close().catch(() => undefined);
    throw error;
  }
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

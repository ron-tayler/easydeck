import { createDeviceManager } from '@easydeck/device';
import type { Surface } from '@easydeck/device';
import { ActionRegistry, DeckController, createActionRegistry } from '@easydeck/engine';
import type { ProfileDefinition } from '@easydeck/engine';
import { createKeyRenderer } from '@easydeck/renderer';

import { NoProfilesError, ProfileNotFoundError } from './domain/errors.js';
import { DEFAULT_SETTINGS } from './domain/settings.js';
import type { DaemonSettings } from './domain/settings.js';
import type { ProfileRepository, SettingsRepository } from './application/ports/repositories.js';
import { registerDeviceActions } from './infrastructure/actions/device-actions.js';
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
}

export interface RunningDeck {
  readonly surface: Surface;
  readonly controller: DeckController;
  readonly settings: DaemonSettings;
  /** Set when keyboard emulation could not be loaded; everything else works. */
  readonly warning?: string;
  stop(): Promise<void>;
}

/**
 * Opens the first supported device and runs a profile on it.
 *
 * This is the whole stack in one call, and the shape the daemon's service is
 * built around.
 */
export async function startDeck(options: StartDeckOptions = {}): Promise<RunningDeck> {
  const settingsRepository = options.settings ?? new FileSettingsRepository();
  const settings = await settingsRepository.load();
  const profile = options.profile ?? (await resolveProfile(options.profiles, settings));

  const surface = await createDeviceManager().openFirst({
    brightness: options.brightness ?? settings.brightness,
  });

  try {
    const renderer = await createKeyRenderer();

    let warning: string | undefined;
    let actions = options.actions;
    if (!actions) {
      actions = registerSystemActions(createActionRegistry());
      registerDeviceActions(actions, surface);
      const keyboard = await registerKeyboardActions(actions);
      warning = keyboard.reason;
    }

    const controller = new DeckController(
      toSurfacePort(surface),
      toKeyRendererPort(renderer, surface.keyImage),
      actions,
    );

    controller.load(profile);
    await controller.start();

    return {
      surface,
      controller,
      settings,
      warning,
      async stop() {
        await controller.stop();
        await surface.clearAllKeys();
        await surface.close();
      },
    };
  } catch (error) {
    await surface.close().catch(() => undefined);
    throw error;
  }
}

async function resolveProfile(
  repository: ProfileRepository | undefined,
  settings: DaemonSettings,
): Promise<ProfileDefinition> {
  const profiles = repository ?? new FileProfileRepository();

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

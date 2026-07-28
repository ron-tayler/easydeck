import { createDeviceManager } from '@easydeck/device';
import {
  ActionRegistry,
  CachingKeyRenderer,
  DeckController,
  createActionRegistry,
} from '@easydeck/engine';
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

    const initialBrightness = options.brightness ?? settings.brightness;

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
        else await surface.setBrightness(Math.min(100, Math.max(0, Math.round(percent))));
      },
    };

    const warnings: string[] = [];
    let actions = options.actions;
    if (!actions) {
      actions = registerSystemActions(createActionRegistry());
      registerEasyDeckFolderActions(actions);
      registerDeviceActions(actions, surface, brightness);
      const keyboard = await registerKeyboardActions(actions);
      if (keyboard.reason) warnings.push(keyboard.reason);
    }

    /*
     * Wrapped in a cache, because the same visual is asked for again every
     * time a page is revisited — and rendering one is a rasterize, a quality
     * search and, for an animation, a full GIF decode with every frame
     * re-encoded. Without it, switching scenes redoes all of that.
     */
    const controller = new DeckController(
      toSurfacePort(surface),
      new CachingKeyRenderer(toKeyRendererPort(renderer, surface.keyImage)),
      actions,
    );

    controller.load(profile);
    await controller.start();

    const watchDirectory =
      options.watchProfiles !== false && profiles instanceof FileProfileRepository
        ? profiles.path
        : undefined;

    service = new DeckService({
      surface,
      controller,
      actions,
      profiles,
      settings: settingsRepository,
      settingsValue: { ...settings, brightness: initialBrightness },
      warnings,
      watchDirectory,
    });
    return service;
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

import { createDeviceManager } from '@easydeck/device';
import type { DiscoveredDevice, Surface } from '@easydeck/device';
import { ActionRegistry, createActionRegistry } from '@easydeck/engine';
import type { ProfileDefinition, SurfaceProvider } from '@easydeck/engine';

import { DeckService } from './application/deck-service.js';
import type { ProfileRepository, SettingsRepository } from './application/ports/repositories.js';
import { NoProfilesError, ProfileNotFoundError } from './domain/errors.js';
import { DEFAULT_SETTINGS } from './domain/settings.js';
import type { DaemonSettings } from './domain/settings.js';
import { registerDeviceActions } from './infrastructure/actions/device-actions.js';
import { registerEasyDeckFolderActions } from './infrastructure/actions/folder-actions.js';
import { registerKeyboardActions } from './infrastructure/actions/keyboard-actions.js';
import { ButtonSecretStore } from './infrastructure/button-secrets.js';
import { mediaManifest, registerMediaActions } from './infrastructure/actions/media-actions.js';
import { registerAudioActions } from './infrastructure/actions/audio-actions.js';
import { registerSystemActions, registerSystemPlugin } from './infrastructure/actions/system-actions.js';
import { FileProfileRepository } from './infrastructure/file-profile-repository.js';
import { FileSettingsRepository } from './infrastructure/file-settings-repository.js';
import { DeckRegistry } from './application/deck-registry.js';
import { PluginRuntime } from './application/plugin-runtime.js';
import { PluginSettingsStore, adoptRenamedPluginFiles } from './infrastructure/plugins/plugin-settings-store.js';
import { registerClockPlugin } from './infrastructure/plugins/clock/clock-plugin.js';
import { registerHardwarePlugin } from './infrastructure/plugins/hardware-plugin.js';
import { loadCodePlugins } from './infrastructure/plugins/code-plugins.js';
import { pluginsDir } from './infrastructure/config-paths.js';
import { choosePluginSource } from './infrastructure/plugins/choose-plugin-source.js';
import { openTarget } from './infrastructure/actions/system-actions.js';
import type { DeviceDirectory } from './application/device-directory.js';
import type { SecretVault } from './application/ports/secret-vault.js';
import { deckIdFor } from './infrastructure/deck-id.js';
import { createPhysicalDeck } from './infrastructure/physical-deck.js';
import { watchDevices } from './infrastructure/device-watcher.js';
import { createVirtualDeck } from './infrastructure/virtual-deck.js';
import type { LogFile } from './infrastructure/log-file.js';

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
  /**
   * Notice panels being plugged in and unplugged. On by default.
   *
   * Off for a one-shot example or a test, which would otherwise keep a timer
   * polling the USB bus long after it had said what it came to say.
   */
  readonly watchDevices?: boolean;
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
  /**
   * Where to write what happened.
   *
   * Supplied by whoever owns the process — the desktop app starts one before
   * anything else, so a failure during startup is written down too. Without
   * one nothing is logged, which is what a test wants.
   */
  readonly log?: LogFile;
}

/**
 * The built-ins that moved to the plugins repository, old id to new.
 *
 * Named here rather than in the settings store because this list is history —
 * the eviction of August 2026 — and the store is machinery. Profiles get the
 * same renames in migrate-profile.ts, format version 7.
 */
const EVICTED_PLUGIN_IDS: Readonly<Record<string, string>> = {
  obs: 'ed.obs',
  vts: 'ed.vts',
  soundpad: 'ed.soundpad',
  yandex: 'ed.yandex',
};

/**
 * Opens every supported panel that is plugged in and runs a profile on each.
 *
 * This is the whole stack in one call, and what the daemon and its examples
 * are built around.
 *
 * None plugged in is a normal way to start, not a failure: the deck becomes a
 * virtual one, and a panel plugged in later joins on its own.
 */
export async function startDeck(options: StartDeckOptions = {}): Promise<DeckService> {
  const profiles = options.profiles ?? new FileProfileRepository();
  const settingsRepository = options.settings ?? new FileSettingsRepository();
  const settings = await settingsRepository.load();
  const profile = options.profile ?? (await resolveProfile(profiles, settings));

  const manager = createDeviceManager();
  const initialBrightness = options.brightness ?? settings.brightness;

  /**
   * The panels this run has open, by deck id.
   *
   * A map rather than a list because panels come and go while the daemon runs:
   * a sweep of the USB bus has to be able to say which of the devices it found
   * are already ours.
   */
  const opened = new Map<string, Surface>();

  try {
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
          for (const surface of opened.values()) await surface.setBrightness(clamped);
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

    /*
     * The same knot the brightness holder ties, for the same reason: decks are
     * built before the plugin runtime exists, and a deck needs to be able to
     * ask a plugin for a picture. Forwarding through a closure keeps the order
     * of construction free while handing the deck one operation rather than
     * the whole runtime.
     */
    let plugins: PluginRuntime | undefined;
    const surfaces: SurfaceProvider = async (request) =>
      plugins ? plugins.drawSurface(request) : undefined;

    /**
     * Opens one panel and gives it a deck of its own.
     *
     * Its own profile, page and history, but the same variables as every other
     * deck, because there is one truth about the machine and several ways to
     * reach it.
     *
     * The binding is read from disk each time rather than from the snapshot
     * taken at startup: a panel plugged in an hour later must run whatever it
     * has been bound to since.
     */
    const attach = async (device: DiscoveredDevice, id: string): Promise<void> => {
      const surface = await manager.open(device, { brightness: brightness.current() });
      opened.set(id, surface);

      try {
        const binding = (await settingsRepository.load()).decks?.[id];
        const deck = await createPhysicalDeck({
          surface,
          id,
          name: binding?.name ?? device.model.name,
          actions,
          variables: registry!.variables,
          surfaces,
        });

        await registry!.add(deck, await profileForDeck(profiles, binding?.profileId, profile));
      } catch (error) {
        opened.delete(id);
        await surface.close().catch(() => undefined);
        throw error;
      }
    };

    /** Lets go of a panel that has been unplugged, deck and all. */
    const detach = async (id: string): Promise<void> => {
      opened.delete(id);
      // The registry closes the surface as it goes; a panel that is already
      // gone simply fails at that, which it is allowed to do.
      await registry!.removeDeck(id);
    };

    /*
     * Every panel that is plugged in, not just the first.
     *
     * One that refuses to open — busy, or claimed by the vendor's own driver —
     * is a warning rather than the end of the run. Before, it was the end of
     * the run: a single stuck panel left somebody with no window to read about
     * it in.
     */
    for (const device of await manager.list()) {
      const id = deckIdFor(device);
      try {
        await attach(device, id);
      } catch (error) {
        options.log?.error(`The panel '${device.model.name}' could not be opened`, error);
        warnings.push(`${device.model.name}: ${(error as Error).message}`);
      }
    }

    /*
     * Nothing plugged in, so a deck that is not a device.
     *
     * Everything a person opens the window for hangs off a deck — the profile
     * being edited, the page being looked at, even the network settings that
     * would let a tablet in. See virtual-deck.ts.
     */
    if (registry.size === 0) {
      await registry.add(
        createVirtualDeck({ profile, actions, variables: registry.variables, surfaces }),
        profile,
      );
      options.log?.info('No panel is plugged in — running on the virtual deck');
    }

    /*
     * Plugins with a life of their own, as opposed to a list of actions.
     *
     * Nothing is installed here yet — the built-ins are actions and nothing
     * more. It exists from the start so that a plugin which does hold a
     * connection has somewhere to hold it, and so its variables land in the
     * store every deck reads.
     */
    // Settings filed under a plugin's old name follow it to the new one:
    // obs became ed.obs when it moved to the plugins repository, and the
    // password typed before the move has to keep opening OBS after it.
    await adoptRenamedPluginFiles(EVICTED_PLUGIN_IDS);

    plugins = new PluginRuntime({
      settings: new PluginSettingsStore(options.secrets),
      variables: registry.variables,
      openExternal: (url) => openTarget(url),
      // Any plugin may point any widget somewhere else — see plugin-host.ts
      // for why forbidding it would be a fiction.
      setWidgetParam: (pluginId, buttonId, name, value) =>
        registry?.setWidgetParam(buttonId, name, value, pluginId),
      redraw: () => registry?.redraw(),
      log: (pluginId, level, message) => {
        options.log?.write(level, `${pluginId}: ${message}`);
        if (level === 'error') warnings.push(`${pluginId}: ${message}`);
      },
    });

    if (builtIn) {
      // The system plugin's actions were registered long before the runtime
      // existed; this gives it the one thing that needs one — the list of
      // installed programs behind "Run program".
      await registerSystemPlugin(plugins);

      // Sound devices ride with the media plugin, and only where Windows has
      // the interfaces they need.
      const audio = await registerAudioActions(actions, plugins, mediaManifest);
      if (audio.reason) warnings.push(audio.reason);

      await registerClockPlugin(actions, plugins);
      await registerHardwarePlugin(actions, plugins);
    }

    /*
     * Plugins that arrived as code, after the built-ins so a downloaded
     * folder can never claim a built-in's id — the registry refuses the
     * second claimant, and the built-ins got there first.
     */
    const pluginSource = await choosePluginSource();

    const code = await loadCodePlugins(pluginsDir(), actions, plugins);
    for (const problem of code.problems) {
      options.log?.error(`Plugin '${problem.id}' could not be loaded`, problem.problem);
      warnings.push(`plugin ${problem.id}: ${problem.problem}`);
    }
    if (code.loaded.length > 0) options.log?.info(`Plugins loaded: ${code.loaded.join(', ')}`);

    const watchDirectory =
      options.watchProfiles !== false && profiles instanceof FileProfileRepository
        ? profiles.path
        : undefined;

    /*
     * Stopped with the deck, and stopped first: a sweep that lands while
     * everything is being taken down would open a panel nobody is going to
     * close.
     */
    let watcher: { stop(): void } | undefined;

    service = new DeckService({
      /*
       * The store's shelf: the published one, or a checkout being worked on.
       *
       * Chosen here because this is the composition root and the only place
       * that gets to decide. See choose-plugin-source.ts for the rule.
       */
      pluginSource,
      ...(options.log ? { log: options.log } : {}),
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
      onStop: () => watcher?.stop(),
    });

    /*
     * Panels arriving and leaving while the daemon runs.
     *
     * Without this, plugging a panel in means restarting the program — and the
     * program is now perfectly happy to start with nothing plugged in, so that
     * would be the normal way to use it rather than a corner.
     */
    if (options.watchDevices !== false) {
      const running = service;
      watcher = watchDevices({
        manager,
        identify: deckIdFor,
        known: opened.keys(),
        onArrived: async (device, id) => {
          await attach(device, id);
          options.log?.info(`Panel plugged in: ${device.model.name}`);
          await running.decksChanged();
        },
        onGone: async (id) => {
          await detach(id);
          options.log?.info(`Panel unplugged: ${id}`);
          await running.decksChanged();
        },
        onError: (error) => options.log?.error('Watching the USB bus failed', error),
      });
    }

    return service;
  } catch (error) {
    for (const surface of opened.values()) await surface.close().catch(() => undefined);
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

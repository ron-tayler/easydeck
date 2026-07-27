import { EventEmitter } from 'node:events';
import { watch } from 'node:fs';
import type { FSWatcher } from 'node:fs';

import type { Surface } from '@easydeck/device';
import type {
  ActionRegistry,
  DeckController,
  KeyView,
  PluginManifest,
  ProfileDefinition,
  VariableValue,
} from '@easydeck/engine';

import type { DeckState } from '../domain/api-messages.js';
import { ProfileNotFoundError } from '../domain/errors.js';
import type { DaemonSettings } from '../domain/settings.js';
import type { DeckEvents } from './ports/deck-events.js';
import type { DeckFacade } from './ports/deck-facade.js';
import type { ProfileRepository, ProfileSummary, SettingsRepository } from './ports/repositories.js';

/** Alias kept for readability at the call sites; see DeckEvents. */
export type DeckServiceEvents = DeckEvents;

export interface DeckServiceOptions {
  readonly surface: Surface;
  readonly controller: DeckController;
  readonly actions: ActionRegistry;
  readonly profiles: ProfileRepository;
  readonly settings: SettingsRepository;
  readonly settingsValue: DaemonSettings;
  readonly warnings?: readonly string[];
  /** Directory to watch for externally edited profiles. */
  readonly watchDirectory?: string;
}

/** Debounce for filesystem events: editors save in several bursts. */
const RELOAD_DEBOUNCE_MS = 200;

/**
 * The running deck, as everything above it sees it.
 *
 * Owns the pieces `startDeck` assembled and adds what a UI needs on top:
 * profile management, live reload when a profile changes on disk, and a
 * single event stream describing what the deck is doing.
 */
export class DeckService extends EventEmitter<DeckServiceEvents> implements DeckFacade {
  private readonly warnings: string[];
  private brightness: number;
  private activeProfileId?: string;
  private watcher?: FSWatcher;
  private reloadTimer?: NodeJS.Timeout;
  private stopped = false;

  constructor(private readonly options: DeckServiceOptions) {
    super();
    this.warnings = [...(options.warnings ?? [])];
    this.brightness = options.settingsValue.brightness;
    this.activeProfileId = options.controller.profileId;

    options.controller.on('locationChanged', (location) => this.emit('locationChanged', location));
    options.controller.on('error', (error) => this.emit('actionError', error.message));
    options.controller.variables.onChange(() =>
      this.emit('variablesChanged', options.controller.variables.snapshot()),
    );

    options.surface.on('keyDown', (event) => this.emit('keyDown', event.key));
    options.surface.on('keyUp', (event) => this.emit('keyUp', event.key));

    if (options.watchDirectory) this.startWatching(options.watchDirectory);
  }

  onDeckEvent<E extends keyof DeckEvents>(event: E, listener: (...args: DeckEvents[E]) => void): void {
    // The cast only bridges Node's conditional listener typing; the signature
    // above is the one callers see, and it is exact.
    this.on(event, listener as never);
  }

  get surface(): Surface {
    return this.options.surface;
  }

  get controller(): DeckController {
    return this.options.controller;
  }

  async state(): Promise<DeckState> {
    const { surface, controller, actions } = this.options;

    return {
      protocolVersion: 1,
      device: {
        model: surface.info.modelName,
        rows: surface.layout.rows,
        cols: surface.layout.cols,
        keyWidth: surface.keyImage.width,
        keyHeight: surface.keyImage.height,
      },
      activeProfileId: controller.profileId,
      location: controller.currentLocation,
      folderPath: controller.folderPath.map((folder) => ({ id: folder.id, name: folder.name })),
      pages: controller.currentFolderPages.map((page) => ({ id: page.id, name: page.name })),
      brightness: this.brightness,
      variables: controller.variables.snapshot(),
      actionTypes: actions.types().sort(),
      warnings: this.warnings,
    };
  }

  async pageView(): Promise<readonly KeyView[]> {
    return this.options.controller.view();
  }

  async plugins(): Promise<readonly PluginManifest[]> {
    return this.options.actions.plugins();
  }

  listProfiles(): Promise<ProfileSummary[]> {
    return this.options.profiles.list();
  }

  getProfile(id: string): Promise<ProfileDefinition> {
    return this.options.profiles.load(id);
  }

  async saveProfile(profile: ProfileDefinition): Promise<void> {
    await this.options.profiles.save(profile);
    this.emit('profilesChanged');
    // Saving the profile that is on screen should show up immediately;
    // that is the whole point of editing it from a configurator.
    if (profile.id === this.activeProfileId) await this.applyProfile(profile);
  }

  async deleteProfile(id: string): Promise<void> {
    if (id === this.activeProfileId) {
      throw new Error(`Profile '${id}' is running; activate another one before deleting it`);
    }
    await this.options.profiles.remove(id);
    this.emit('profilesChanged');
  }

  async activateProfile(id: string): Promise<void> {
    if (!(await this.options.profiles.has(id))) throw new ProfileNotFoundError(id);

    const profile = await this.options.profiles.load(id);
    await this.applyProfile(profile);
    this.activeProfileId = id;
    await this.persistSettings({ activeProfileId: id });
  }

  setVariable(name: string, value: VariableValue): void {
    this.options.controller.variables.set(name, value);
  }

  goToPage(pageId: string): void {
    this.options.controller.goToPage(pageId);
  }

  openFolder(folderId: string): void {
    this.options.controller.openFolder(folderId);
  }

  goUp(): void {
    this.options.controller.goUp();
  }

  goHome(): void {
    this.options.controller.goHome();
  }

  goBack(): void {
    this.options.controller.goBack();
  }

  async setBrightness(percent: number): Promise<void> {
    const clamped = Math.min(100, Math.max(0, Math.round(percent)));
    await this.options.surface.setBrightness(clamped);
    this.brightness = clamped;
    await this.persistSettings({ brightness: clamped });
  }

  simulateKey(key: number): void {
    this.options.controller.simulatePress(key);
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;

    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    this.watcher?.close();

    await this.options.controller.stop();
    await this.options.surface.clearAllKeys().catch(() => undefined);
    await this.options.surface.close();
  }

  private async applyProfile(profile: ProfileDefinition): Promise<void> {
    this.options.controller.load(profile);
    this.activeProfileId = profile.id;
    this.options.controller.invalidate();
    this.emit('state', await this.state());
  }

  private async persistSettings(patch: Partial<DaemonSettings>): Promise<void> {
    const current = await this.options.settings.load();
    await this.options.settings.save({ ...current, ...patch });
  }

  /**
   * Reloads the active profile when its file changes underneath us.
   *
   * Editing the JSON in a text editor and seeing the panel update is the
   * fastest feedback loop available until the configurator exists — and it
   * keeps working afterwards, for anyone who prefers an editor.
   */
  private startWatching(directory: string): void {
    try {
      this.watcher = watch(directory, { persistent: false }, () => this.scheduleReload());
    } catch {
      // Watching is a convenience; a platform that cannot do it still runs.
    }
  }

  private scheduleReload(): void {
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => {
      void this.reloadActive();
    }, RELOAD_DEBOUNCE_MS);
  }

  private async reloadActive(): Promise<void> {
    this.emit('profilesChanged');
    if (this.stopped || !this.activeProfileId) return;

    try {
      const profile = await this.options.profiles.load(this.activeProfileId);
      await this.applyProfile(profile);
    } catch (error) {
      // A half-saved or broken file must not take the running deck down —
      // keep showing the last good profile and say what is wrong.
      this.emit('actionError', `Reload failed: ${(error as Error).message}`);
    }
  }
}

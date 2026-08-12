import { EventEmitter } from 'node:events';
import { watch } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import type { FSWatcher } from 'node:fs';

import type { Surface } from '@easydeck/device';
import { DeckController } from '@easydeck/engine';
import type {
  ActionRegistry,
  ButtonEvent,
  KeyView,
  LocalizedText,
  ParamOption,
  PluginManifest,
  PluginStatus,
  SurfaceFrame,
  SurfaceRequest,
  ProfileDefinition,
  VariableValue,
} from '@easydeck/engine';

import type { DeckState, NetworkState } from '../domain/api-messages.js';
import { NoProfilesError, ProfileNotFoundError } from '../domain/errors.js';
import { configDir, iconsDir, pluginsDir, profilesDir } from '../infrastructure/config-paths.js';
import { readLibrary } from '../infrastructure/icon-library.js';
import { readInstalledPlugins } from '../infrastructure/plugins/installed-plugins.js';
import { PluginAssets } from '../infrastructure/plugins/plugin-assets.js';
import { secretId } from '../infrastructure/button-secrets.js';
import type { ButtonSecretStore } from '../infrastructure/button-secrets.js';
import { exportProfile, importProfile } from '../infrastructure/profile-archive.js';
import type { Library, LibraryImage } from '../infrastructure/icon-library.js';
import type { DaemonSettings, DeckBinding } from '../domain/settings.js';
import { localAddresses } from '../infrastructure/api/network-addresses.js';
import { DEFAULT_PORT } from '../infrastructure/api/websocket-server.js';
import { NetworkDeck } from '../infrastructure/network-deck.js';
import type { DeckEntry, DeckRegistry } from './deck-registry.js';
import type { PluginRuntime } from './plugin-runtime.js';
import { openTarget } from '../infrastructure/actions/system-actions.js';
import type { DeviceDirectory } from './device-directory.js';
import type { DeckEvents } from './ports/deck-events.js';
import type { AppFolder, DeckFacade, InstalledPluginSummary } from './ports/deck-facade.js';
import type { ProfileRepository, ProfileSummary, SettingsRepository } from './ports/repositories.js';

/** Alias kept for readability at the call sites; see DeckEvents. */
export type DeckServiceEvents = DeckEvents;

export interface DeckServiceOptions {
  /**
   * Every deck that is running.
   *
   * The service still speaks about one at a time — the API has no notion of
   * decks yet — and acts on the first. Everything below it is already plural,
   * so making the API plural is a change to this file rather than to the
   * machinery underneath.
   */
  readonly decks: DeckRegistry;
  readonly actions: ActionRegistry;
  readonly profiles: ProfileRepository;
  readonly settings: SettingsRepository;
  readonly settingsValue: DaemonSettings;
  readonly warnings?: readonly string[];
  /**
   * What the API server ended up listening on.
   *
   * Set after the fact, because the deck is built before the server is. Until
   * it is known the configurator simply shows no network section, which is
   * right for a run with no server at all.
   */
  readonly listening?: { readonly port: number; readonly networkAccess: boolean };
  /**
   * Devices allowed in, and devices asking to be.
   *
   * Optional so a headless test can build a service without one; anything
   * serving an API has it.
   */
  readonly devices?: DeviceDirectory;
  /**
   * Starts, stops or restarts the API server to match the settings.
   *
   * Owned by whoever built the server — the desktop app or the headless
   * runner — because only they can rebuild a socket. Without it the settings
   * are merely stored, which is what a run with no server wants.
   */
  readonly applyNetwork?: () => Promise<{ port: number; networkAccess: boolean } | undefined>;
  /** Directory to watch for externally edited profiles. */
  readonly watchDirectory?: string;
  /**
   * The plugins that have a life of their own, if any are running.
   *
   * Optional because a deck runs perfectly well without one: the built-in
   * navigation, system and media plugins are actions and nothing else. It
   * appears the moment a plugin needs to hold a connection open.
   */
  readonly plugins?: PluginRuntime;
  /**
   * Passwords the buttons type, which no profile holds.
   *
   * Optional so a headless test can build a service without one; anything a
   * person configures has it.
   */
  readonly buttonSecrets?: ButtonSecretStore;
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
/**
 * Merges one message tree over another, branch by branch.
 *
 * A plugin translating `actions.mine.label` must not wipe out the rest of
 * `actions`, which a plain object spread at the top level would do.
 */
function merge(base: unknown, extra: unknown): unknown {
  if (!isTree(base) || !isTree(extra)) return extra;

  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    merged[key] = key in merged ? merge(merged[key], value) : value;
  }

  return merged;
}

function isTree(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class DeckService extends EventEmitter<DeckServiceEvents> implements DeckFacade {
  /** Pictures that arrive with a plugin; see plugin-assets.ts. */
  private readonly assets = new PluginAssets();
  private readonly warnings: string[];
  private brightness: number;
  private listening?: { port: number; networkAccess: boolean };
  private activeProfileId?: string;
  private watcher?: FSWatcher;
  private reloadTimer?: NodeJS.Timeout;
  private stopped = false;

  constructor(private readonly options: DeckServiceOptions) {
    super();
    this.warnings = [...(options.warnings ?? [])];
    this.brightness = options.settingsValue.brightness;
    this.activeProfileId = options.decks.first?.controller.profileId;
    this.publishBrightness();

    for (const deck of options.decks.list()) this.follow(deck);
    /*
     * Decks that arrive later are followed too.
     *
     * This used to happen once, over the decks that existed at startup — which
     * is every panel plugged in and no tablet at all, since a network deck
     * attaches when its page connects. The configurator therefore never heard
     * a tablet change page: watching it showed a view frozen wherever it had
     * been when the window opened.
     */
    options.decks.on('added', (deck) => this.follow(deck));

    options.decks.on('error', (error) => this.emit('actionError', error.message));
    // What the profiles read, told to the plugins that publish it — now and
    // after every change, since a key added to a profile is a key somebody
    // expects to start working without restarting anything.
    this.publishWatched();
    options.decks.on('changed', () => this.publishWatched());
    options.decks.on('added', () => this.publishWatched());

    options.plugins?.on('status', (pluginId, status, message) =>
      this.emit('pluginStatusChanged', { pluginId, status, ...(message ? { message } : {}) }),
    );
    // A plugin that fails is worth the same line in the log as a failed
    // action, and nothing more: its status already says so on its own gear.
    options.plugins?.on('error', (error) => this.emit('actionError', error.message));
    options.devices?.on('changed', () => this.emit('devicesChanged'));
    options.decks.variables.onChange(() =>
      this.emit('variablesChanged', options.decks.variables.snapshot()),
    );


    if (options.watchDirectory) this.startWatching(options.watchDirectory);
  }

  /** Repeats one deck's own news, stamped with which deck it came from. */
  private follow(deck: DeckEntry): void {
    const deckId = deck.id;

    deck.controller.on('locationChanged', (location) =>
      this.emit('locationChanged', { deckId, location }),
    );
    deck.controller.on('painted', (keys) => this.emit('viewChanged', { deckId, keys }));
    deck.surface?.on('keyDown', (event) => this.emit('keyDown', { deckId, key: event.key }));
    deck.surface?.on('keyUp', (event) => this.emit('keyUp', { deckId, key: event.key }));
  }

  onDeckEvent<E extends keyof DeckEvents>(event: E, listener: (...args: DeckEvents[E]) => void): void {
    // The cast only bridges Node's conditional listener typing; the signature
    // above is the one callers see, and it is exact.
    this.on(event, listener as never);
  }

  get surface(): Surface {
    return this.deck.surface!;
  }

  get controller(): DeckController {
    return this.deck.controller;
  }

  async state(): Promise<DeckState> {
    const { actions } = this.options;
    const { surface, controller } = this.deck;
    const network = await this.networkState();

    return {
      protocolVersion: 1,
      decks: this.options.decks.list().map((deck) => ({
        id: deck.id,
        name: deck.name,
        online: deck.online,
        rows: deck.controller.layout.rows,
        cols: deck.controller.layout.cols,
        ...(deck.surface ? { model: deck.surface.info.modelName } : {}),
        keyWidth: deck.surface?.keyImage.width ?? 0,
        keyHeight: deck.surface?.keyImage.height ?? 0,
        ...(deck.controller.profileId ? { profileId: deck.controller.profileId } : {}),
        ...(deck.controller.currentLocation ? { location: deck.controller.currentLocation } : {}),
        folderPath: deck.controller.folderPath.map((folder) => ({ id: folder.id, name: folder.name })),
        pages: deck.controller.currentFolderPages.map((page) => ({ id: page.id, name: page.name })),
      })),
      activeDeckId: this.deck.id,
      brightness: this.brightness,
      network,
      variables: this.options.decks.variables.snapshot(),
      variableDeclarations: this.options.decks.declarations(),
      actionTypes: actions.types().sort(),
      warnings: this.warnings,
    };
  }

  async pageView(deckId?: string): Promise<readonly KeyView[]> {
    return this.deckOf(deckId).controller.view();
  }

  /**
   * The installed plugins, with their presets' pictures in place.
   *
   * A preset names a picture as `plugin:hardware/cpu-gauge.svg`, and this is
   * where that becomes a picture. Expanded on the way out rather than at
   * registration so a plugin's folder can be changed without restarting, and
   * so what a window receives is an ordinary preset it need know nothing about.
   */
  async plugins(): Promise<readonly PluginManifest[]> {
    return this.assets.expandAll(this.options.actions.plugins());
  }

  /**
   * Packs a stored profile into an archive.
   *
   * Read from storage rather than from the running deck: "export this profile"
   * means the thing on disk, not whichever page a deck happens to be showing.
   */
  async exportProfile(profileId: string): Promise<{ name: string; base64: string }> {
    const profile = await this.options.profiles.load(profileId);
    const archive = exportProfile(profile);

    return {
      name: `${profile.name || profileId}.easydeck`,
      base64: Buffer.from(archive).toString('base64'),
    };
  }

  /**
   * Reads an archive in, under a folder of its own.
   *
   * Never over an existing profile: an import is somebody's work arriving, and
   * quietly replacing what they already had would be the one mistake here that
   * cannot be undone. The empty id says "not stored yet", and storage files it
   * under its name — numbering it if somebody already has one so called.
   */
  async importProfile(base64: string): Promise<{ id: string }> {
    const profile = importProfile(Buffer.from(base64, 'base64'));
    const id = await this.options.profiles.save({ ...profile, id: '' });
    this.emit('profilesChanged');

    return { id };
  }

  /** The running plugins, for whoever configures them. */
  get pluginRuntime(): PluginRuntime | undefined {
    return this.options.plugins;
  }

  /**
   * What a plugin's settings window needs to draw itself.
   *
   * Values come back without the secrets — the manifest says which fields are
   * secret and this reports only whether each is filled. A configurator that
   * never receives a token cannot leak one, and it has no use for the value
   * anyway: the field it draws is a password box.
   */
  async pluginSettings(pluginId: string): Promise<{
    readonly values: Record<string, VariableValue>;
    readonly filledSecrets: readonly string[];
    readonly status: PluginStatus;
    readonly message?: LocalizedText;
  }> {
    const runtime = this.requirePlugins();
    const state = runtime.status(pluginId);
    if (!state) throw new Error(`No plugin '${pluginId}' is running`);

    const secret = new Set(
      (state.manifest.settings ?? []).filter((param) => param.secret).map((param) => param.name),
    );
    const stored = await runtime.settingsOf(pluginId);
    const values: Record<string, VariableValue> = {};
    for (const [name, value] of Object.entries(stored)) {
      if (!secret.has(name)) values[name] = value;
    }

    return {
      values,
      filledSecrets: await runtime.filledSecretsOf(pluginId),
      status: state.status,
      ...(state.message ? { message: state.message } : {}),
    };
  }

  async savePluginSettings(
    pluginId: string,
    values: Readonly<Record<string, VariableValue>>,
  ): Promise<void> {
    await this.requirePlugins().configure(pluginId, values);
  }

  async runPluginCommand(pluginId: string, command: string): Promise<void> {
    await this.requirePlugins().runCommand(pluginId, command);
  }

  /** The choices behind a parameter declared with `optionsFrom`. */
  async pluginOptions(
    pluginId: string,
    source: string,
    params: Readonly<Record<string, unknown>> = {},
  ): Promise<readonly ParamOption[]> {
    const runtime = this.options.plugins;
    if (!runtime) return [];
    return runtime.optionsFor(pluginId, source, params);
  }

  /**
   * One frame of a widget, drawn on demand rather than for the panel.
   *
   * The editor's preview goes through here: the same plugin, the same call,
   * so what somebody sees while choosing colours is the picture the key will
   * actually show and not an impression of it.
   */
  async drawSurface(request: SurfaceRequest): Promise<SurfaceFrame | undefined> {
    return this.options.plugins?.drawSurface(request);
  }

  /** Where every plugin with a life of its own has got to. */
  pluginStatuses(): Record<string, { status: PluginStatus; message?: LocalizedText }> {
    const statuses: Record<string, { status: PluginStatus; message?: LocalizedText }> = {};
    for (const state of this.options.plugins?.list() ?? []) {
      statuses[state.manifest.id] = {
        status: state.status,
        ...(state.message ? { message: state.message } : {}),
      };
    }
    return statuses;
  }

  /** Tells the plugins which of their variables anything is reading. */
  private publishWatched(): void {
    this.options.plugins?.setWatched(this.options.decks.variablesRead());
  }

  private requirePlugins(): PluginRuntime {
    const runtime = this.options.plugins;
    if (!runtime) throw new Error('No plugins are running');
    return runtime;
  }

  /**
   * What is installed in the plugins folder, with its translations.
   *
   * Read on every call, like the icon folder and for the same reason: a plugin
   * is a thing you drop in and expect to see, not a thing you restart for.
   */
  async installedPlugins(): Promise<InstalledPluginSummary> {
    const { plugins, broken } = await readInstalledPlugins(pluginsDir());

    const messages: Record<string, unknown> = {};
    for (const plugin of plugins) {
      for (const [locale, tree] of Object.entries(plugin.messages)) {
        // Later plugins win over earlier ones, and every plugin wins over the
        // built-in text: a pack that names its own actions has to be able to.
        messages[locale] = merge(messages[locale], tree);
      }
    }

    return {
      plugins: plugins.map((plugin) => ({
        id: plugin.id,
        name: plugin.name,
        ...(plugin.version ? { version: plugin.version } : {}),
        ...(plugin.description ? { description: plugin.description } : {}),
        kind: plugin.kind,
        icons: plugin.icons.length,
        locales: Object.keys(plugin.messages).sort(),
      })),
      broken,
      messages,
    };
  }

  listProfiles(): Promise<ProfileSummary[]> {
    return this.options.profiles.list();
  }

  /**
   * The icon folder and every plugin's pictures, as one library.
   *
   * Read on every call: the point of a folder is that you can drop a file in
   * it and see it appear without restarting anything.
   *
   * Plugins come after the loose folder, and each under its own name, so a
   * pack someone installed never quietly shadows a file they put there
   * themselves.
   */
  async listIcons(): Promise<Library> {
    const [own, installed] = await Promise.all([
      readLibrary(iconsDir()),
      readInstalledPlugins(pluginsDir()),
    ]);

    const fromPlugins = installed.plugins.flatMap((plugin) => plugin.icons);
    return { images: [...own.images, ...fromPlugins], omitted: own.omitted };
  }

  getProfile(id: string): Promise<ProfileDefinition> {
    return this.options.profiles.load(id);
  }

  /**
   * Stores a profile and says where it ended up.
   *
   * Renaming a profile renames its folder, so the id a configurator sent may
   * not be the id that comes back. Everything holding the old one is moved
   * over here rather than left pointing at a folder that no longer exists.
   */
  async saveProfile(profile: ProfileDefinition): Promise<{ id: string }> {
    const was = profile.id;
    const id = await this.options.profiles.save(profile);
    const saved = { ...profile, id };

    if (id !== was) await this.refile(was, id);

    // A button deleted, or its password action removed, must not leave the
    // password on disk. Done after the write, so what was just saved counts as
    // referring to its own secrets.
    await this.options.buttonSecrets?.sweep(profilesDir()).catch(() => undefined);

    this.emit('profilesChanged');
    // Saving the profile that is on screen should show up immediately;
    // that is the whole point of editing it from a configurator.
    if (was === this.activeProfileId || id === this.activeProfileId) {
      await this.applyProfile(saved, was);
    }

    return { id };
  }

  /**
   * Follows a profile that has moved folder.
   *
   * The decks showing it and the settings remembering it both hold the old id;
   * a rename that left either behind would show as a deck falling back to
   * some other profile at the next launch.
   */
  private async refile(was: string, id: string): Promise<void> {
    if (this.activeProfileId === was) this.activeProfileId = id;

    const stored = await this.options.settings.load();
    const decks = Object.fromEntries(
      Object.entries(stored.decks ?? {}).map(([deckId, binding]) => [
        deckId,
        binding.profileId === was ? { ...binding, profileId: id } : binding,
      ]),
    );

    await this.options.settings.save({
      ...stored,
      ...(stored.activeProfileId === was ? { activeProfileId: id } : {}),
      ...(Object.keys(decks).length > 0 ? { decks } : {}),
    });
  }

  async deleteProfile(id: string): Promise<void> {
    if (id === this.activeProfileId) {
      throw new Error(`Profile '${id}' is running; activate another one before deleting it`);
    }
    await this.options.profiles.remove(id);
    await this.options.buttonSecrets?.sweep(profilesDir()).catch(() => undefined);
    this.emit('profilesChanged');
  }

  /**
   * What a button's password field should show, which is never the password.
   *
   * Only whether one is set. A configurator that cannot receive a password
   * cannot leak one, and it has no use for the value: the control it draws is
   * a row of dots and a button to replace them.
   */
  async buttonSecrets(): Promise<readonly string[]> {
    return (await this.options.buttonSecrets?.filled()) ?? [];
  }

  /**
   * Stores a password and answers with the reference to put in the button.
   *
   * The reference is what the profile holds; passing the old one back in keeps
   * a change of password from being a change to the document.
   */
  async saveButtonSecret(value: string, reference?: string): Promise<{ reference: string }> {
    const store = this.options.buttonSecrets;
    if (!store) throw new Error('Passwords are unavailable: no secret store was configured');

    return { reference: await store.save(value, reference ? secretId(reference) : undefined) };
  }

  async clearButtonSecret(reference: string): Promise<void> {
    await this.options.buttonSecrets?.clear(reference);
  }

  async activateProfile(id: string, deckId?: string): Promise<void> {
    if (!(await this.options.profiles.has(id))) throw new ProfileNotFoundError(id);

    const deck = this.deckOf(deckId);
    const profile = await this.options.profiles.load(id);

    await this.options.decks.setProfile(deck.id, profile);
    this.activeProfileId = this.deck.controller.profileId;

    /*
     * Remembered against the deck, not against the daemon: this is what makes
     * two panels run different profiles tomorrow as well as today. The
     * daemon-wide id stays as the fallback for a deck nobody has set up.
     */
    await this.persistSettings({ activeProfileId: id });
    await this.persistDeckBinding(deck.id, { profileId: id });
    this.emit('state', await this.state());
  }

  async attachNetworkDeck(options: {
    readonly deviceId: string;
    readonly name: string;
    readonly rows: number;
    readonly cols: number;
    readonly send: (scene: unknown, doublePressKeys: readonly number[]) => void;
  }): Promise<{ readonly deckId: string }> {
    const deckId = `net-${options.deviceId}`;
    const existing = this.options.decks.get(deckId);

    // A device that reconnects rejoins the deck it had, rather than starting a
    // second one: its page, its history and its profile are still there.
    if (existing) await this.options.decks.removeDeck(deckId);

    const presenter = new NetworkDeck({ rows: options.rows, cols: options.cols }, (scene, keys) =>
      options.send(scene, keys),
    );

    const controller = new DeckController(presenter, this.options.actions, {
      variables: this.options.decks.variables,
      deckId,
    });

    const binding = (await this.options.settings.load()).decks?.[deckId];
    const profile = await this.profileFor(binding?.profileId);

    await this.options.decks.add(
      { id: deckId, name: binding?.name ?? options.name, controller, presenter },
      profile,
    );

    this.emit('state', await this.state());
    return { deckId };
  }

  async detachDeck(deckId: string): Promise<void> {
    await this.options.decks.removeDeck(deckId);
    this.emit('state', await this.state());
  }

  reportGesture(deckId: string, key: number, gesture: string): void {
    const deck = this.options.decks.get(deckId);
    const presenter = deck?.presenter;
    if (presenter instanceof NetworkDeck) presenter.report(key, gesture as ButtonEvent);
  }

  reportPressed(deckId: string, key: number, pressed: boolean): void {
    if (!this.options.decks.get(deckId)) return;
    this.emit(pressed ? 'keyDown' : 'keyUp', { deckId, key });
  }

  /** The profile a deck should run, falling back to whatever is available. */
  private async profileFor(profileId: string | undefined): Promise<ProfileDefinition> {
    if (profileId && (await this.options.profiles.has(profileId))) {
      return this.options.profiles.load(profileId);
    }

    const current = this.deckOf(undefined).controller.profileId;
    if (current && (await this.options.profiles.has(current))) {
      return this.options.profiles.load(current);
    }

    const [first] = await this.options.profiles.list();
    if (!first) throw new NoProfilesError('the profile repository');
    return this.options.profiles.load(first.id);
  }

  async listDevices(): Promise<{
    devices: readonly { id: string; name: string; approvedAt?: string; online: boolean }[];
    pending: readonly { id: string; name: string; code: string; address?: string }[];
  }> {
    const directory = this.options.devices;
    if (!directory) return { devices: [], pending: [] };

    return { devices: await directory.devices(), pending: directory.waiting() };
  }

  async approveDevice(deviceId: string): Promise<void> {
    await this.options.devices?.approve(deviceId);
  }

  async revokeDevice(deviceId: string): Promise<void> {
    await this.options.devices?.revoke(deviceId);
  }

  async renameDeck(deckId: string, name: string): Promise<void> {
    const deck = this.deckOf(deckId);
    this.options.decks.rename(deck.id, name);

    await this.persistDeckBinding(deck.id, { name });
    this.emit('state', await this.state());
  }

  setVariable(name: string, value: VariableValue): void {
    this.options.decks.variables.set(name, value);
  }

  deleteVariable(name: string): void {
    this.options.decks.variables.delete(name);
  }

  goToPage(pageId: string, deckId?: string): void {
    this.deckOf(deckId).controller.goToPage(pageId);
  }

  openFolder(folderId: string, deckId?: string): void {
    this.deckOf(deckId).controller.openFolder(folderId);
  }

  goUp(deckId?: string): void {
    this.deckOf(deckId).controller.goUp();
  }

  goHome(deckId?: string): void {
    this.deckOf(deckId).controller.goHome();
  }

  goBack(deckId?: string): void {
    this.deckOf(deckId).controller.goBack();
  }

  /** What the panel is set to now, for anything computing a change from it. */
  get currentBrightness(): number {
    return this.brightness;
  }

  /**
   * Shows the user one of EasyDeck's folders.
   *
   * Created first, because a folder that has never been used does not exist
   * yet — and opening nothing is a confusing way to learn that plugins go in
   * a directory you were about to be shown.
   */
  async openAppFolder(folder: AppFolder): Promise<void> {
    const directory = {
      config: configDir,
      profiles: profilesDir,
      plugins: pluginsDir,
      icons: iconsDir,
    }[folder]();

    await mkdir(directory, { recursive: true });
    openTarget(directory);
  }

  async setBrightness(percent: number): Promise<void> {
    const clamped = Math.min(100, Math.max(0, Math.round(percent)));
    // One number for the whole machine: every panel follows it.
    for (const deck of this.options.decks.list()) {
      await deck.surface?.setBrightness(clamped).catch(() => undefined);
    }
    this.brightness = clamped;
    this.publishBrightness();
    await this.persistSettings({ brightness: clamped });
  }

  /**
   * Mirrors brightness into the variable the deck plugin declares, so a key can
   * show or follow it. Published from here because this is where the value is
   * actually decided — anywhere else would be a second copy to keep in step.
   */
  private publishBrightness(): void {
    this.options.decks.variables.set('deck.brightness', this.brightness);
  }

  simulateKey(key: number, deckId?: string): void {
    this.deckOf(deckId).controller.simulatePress(key);
  }

  simulateLongPress(key: number, deckId?: string): void {
    this.deckOf(deckId).controller.simulateLongPress(key);
  }

  simulateDoublePress(key: number, deckId?: string): void {
    this.deckOf(deckId).controller.simulateDoublePress(key);
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;

    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    this.watcher?.close();

    // Before the decks: a plugin clears its variables on the way out, and it
    // should do that while there is still something to repaint.
    await this.options.plugins?.stopAll();
    await this.options.decks.stop();
  }

  /**
   * Reloads a profile everywhere it is being shown.
   *
   * Every deck running it, not just the active one: two decks may share a
   * profile, and editing a button that only one of them refreshed would leave
   * the other showing a version that no longer exists anywhere.
   */
  private async applyProfile(profile: ProfileDefinition, was = profile.id): Promise<void> {
    const showing = this.options.decks
      .list()
      .filter((deck) => deck.controller.profileId === was);

    // Nothing is showing it — an edit to a profile that is merely stored. The
    // active deck takes it, which is what activating a profile means.
    const targets = showing.length > 0 ? showing : [this.deck];

    for (const deck of targets) {
      const { controller } = deck;

      /*
       * Editing one button reloads the whole profile it belongs to. Landing
       * back on the first page and resetting every counter each time would
       * make a configurator unusable, so reloading the *same* profile keeps
       * where the deck was. Switching profiles still starts clean, which is
       * what switching is for.
       *
       * Variables are not restored here any more: they belong to the machine
       * rather than to a deck, and reloading a profile no longer disturbs them.
       *
       * The states forced by `set-button-state` are the same kind of thing as
       * the location, and were being lost for the same reason: they live in
       * memory because the profile has no field for "which state this key
       * happens to be showing", and a reload started them over. Editing one
       * key therefore reset every other key on the page whose state had been
       * set by an action rather than bound to a variable.
       */
      const sameProfile = controller.profileId === was;
      const previousLocation = sameProfile ? controller.currentLocation : undefined;
      const previousStates = sameProfile ? controller.forcedStates : undefined;

      controller.load(profile);

      if (previousLocation) {
        try {
          controller.goToPage(previousLocation.pageId);
        } catch {
          // The edit removed the page the deck was on; the profile's own
          // starting point is the sensible place to be instead.
        }
      }

      if (previousStates) controller.restoreForcedStates(previousStates);

      controller.invalidate();
    }

    this.activeProfileId = this.deck.controller.profileId;
    this.emit('state', await this.state());

    // A saved profile may have gained a key that reads something new.
    this.publishWatched();
  }

  /**
   * Tells the service where the API server actually ended up.
   *
   * Called by whoever started it: the port may differ from the setting — the
   * stored one could have been taken — and a configurator that showed the
   * setting rather than the truth would send people to the wrong address.
   *
   * Undefined means there is no server, which is the normal state until
   * network access is switched on.
   */
  setListening(listening: { port: number; networkAccess: boolean } | undefined): void {
    this.listening = listening;
    void this.state().then((state) => this.emit('state', state));
  }

  /**
   * How the daemon can be reached, as the configurator shows it.
   *
   * Always answered, even with no server running: "switched off" is a state
   * worth showing, and the section that lets you switch it on cannot be the
   * one that disappears when it is off.
   */
  private async networkState(): Promise<NetworkState> {
    const stored = await this.options.settings.load();

    return {
      port: this.listening?.port ?? stored.port ?? DEFAULT_PORT,
      running: this.listening !== undefined,
      /*
       * The truth, not the wish. These two can differ — a port that was taken,
       * a server that has not been told to start — and a switch describing the
       * setting rather than the socket is a switch that lies.
       */
      networkAccess: this.listening !== undefined,
      networkDecks: stored.networkDecks === true,
      extensionsApi: stored.extensionsApi === true,
      // Addresses only while it is actually reachable at them: a list of IPs
      // for a server that is switched off is an invitation to try them and
      // wonder why nothing happens.
      addresses: this.listening ? localAddresses().map(({ address }) => ({ address })) : [],
    };
  }

  /**
   * Changes how the daemon can be reached, and makes it so.
   *
   * The server is started, stopped or rebuilt here rather than at the next
   * launch: telling someone to restart the program is asking them to do the
   * work the program could have done. Network access is a feature of this
   * program, not its nature — turning it off must take the socket away.
   */
  async setNetworkSettings(patch: {
    networkAccess?: boolean;
    networkDecks?: boolean;
    extensionsApi?: boolean;
    port?: number;
  }): Promise<void> {
    await this.persistSettings(patch);

    try {
      this.listening = await this.options.applyNetwork?.();
    } catch (error) {
      // A port that could not be taken leaves no server, and the switch has to
      // say so rather than stay on because the setting did.
      this.listening = undefined;
      this.emit('state', await this.state());
      throw error;
    }

    this.emit('state', await this.state());
  }

  /** The deck a request with no deck named acts on. */
  private get deck() {
    return this.deckOf(undefined);
  }

  /**
   * The deck a request is about.
   *
   * An unknown id falls back to the active deck rather than failing: a UI can
   * be holding an id for a panel that has just been unplugged, and answering
   * about *some* deck is more useful than an error nobody can act on.
   */
  private deckOf(deckId: string | undefined) {
    const named = deckId === undefined ? undefined : this.options.decks.get(deckId);
    const deck = named ?? this.options.decks.first;
    if (!deck) throw new Error('No deck is running');
    return deck;
  }

  /**
   * Merges one deck's binding into the stored settings.
   *
   * Read back from disk rather than patched onto the snapshot taken at start:
   * bindings accumulate one deck at a time, and writing from a stale copy
   * would drop whatever was set since.
   */
  private async persistDeckBinding(deckId: string, patch: Partial<DeckBinding>): Promise<void> {
    const current = await this.options.settings.load();
    await this.options.settings.save({
      ...current,
      decks: { ...current.decks, [deckId]: { ...current.decks?.[deckId], ...patch } },
    });
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

import type {
  KeyView,
  LocalizedText,
  ParamDefinition,
  ParamOption,
  PluginManifest,
  PluginStatus,
  SurfaceFrame,
  SurfaceRequest,
  ProfileDefinition,
  VariableValue,
} from '@easydeck/engine';

import type { DeckState } from '../../domain/api-messages.js';
import type { Library, LibraryImage } from '../../infrastructure/icon-library.js';
import type { DeckEvents } from './deck-events.js';
import type { ProfileSummary } from './repositories.js';

/**
 * Everything the API is allowed to do, as one interface.
 *
 * The request handler talks to this rather than to the live deck, so the
 * whole protocol layer can be tested against a few lines of fake — no device,
 * no renderer, no sockets.
 */
/** One installed plugin, as a window needs to describe it. */
export interface InstalledPluginInfo {
  readonly id: string;
  readonly name: string;
  readonly version?: string;
  readonly description?: string;
  readonly kind: 'easydeck' | 'stream-deck-icons';
  /** How many pictures it contributes, which is most of what a pack is. */
  readonly icons: number;
  /** Locale codes it translates, so the window can say what it covers. */
  readonly locales: readonly string[];
}

export interface InstalledPluginSummary {
  readonly plugins: readonly InstalledPluginInfo[];
  /** Plugins that could not be read, named so the user can find them. */
  readonly broken: readonly { readonly id: string; readonly problem: string }[];
  /**
   * Translations to lay over the built-in text, by locale code.
   *
   * Sent with the list rather than fetched separately: the window needs them
   * before it draws anything a plugin named.
   */
  readonly messages: Readonly<Record<string, unknown>>;
}

/**
 * A row of the store: what it is, and where the user stands.
 *
 * The listing and the installed state together, because every row draws both
 * — the name and the picture from one, the button's word from the other. What
 * it deliberately does *not* carry is the manifest; see `storePlugin`.
 */
export interface StorePlugin {
  readonly id: string;
  readonly author: string;
  readonly version: string;
  readonly apiVersion: number;
  /** How large the download is, for a row that says so before it starts. */
  readonly bytes: number;
  readonly name: LocalizedText;
  readonly description?: LocalizedText;
  /** What the author is called, as opposed to their slug. */
  readonly by?: LocalizedText;
  /** The one picture a row shows; a `plugin:<id>/<path>` reference. */
  readonly cover?: string;
  /** The version already on this machine, absent when there is none. */
  readonly installedVersion?: string;
  /** Whether this build can run it at all. See PLUGIN_API_VERSION. */
  readonly compatible: boolean;
}

/** The folders a configurator may ask to have opened. */
export type AppFolder = 'config' | 'profiles' | 'plugins' | 'icons';

export interface DeckFacade {
  state(): Promise<DeckState>;
  /** The current page, resolved — what each key is showing right now. */
  pageView(deckId?: string): Promise<readonly KeyView[]>;
  /**
   * Installed plugins with their action declarations.
   *
   * The configurator builds its action picker and every parameter form from
   * these, which is why a plugin describes its parameters as data.
   */
  plugins(): Promise<readonly PluginManifest[]>;

  /**
   * What is installed in the plugins folder, and what it brings with it.
   *
   * Separate from `plugins()`, which lists what can run actions. A plugin may
   * carry only pictures and text and still be something the user installed,
   * expects to see listed, and expects to be able to remove.
   */
  installedPlugins(): Promise<InstalledPluginSummary>;

  /**
   * What can be installed, and which of it already is.
   *
   * The store, in one call. `installed` is answered here rather than left for
   * the window to work out by comparing two lists — the comparison needs the
   * version as well as the id, and getting it slightly wrong shows "Install"
   * on something already installed.
   */
  storePlugins(options?: { readonly refresh?: boolean }): Promise<readonly StorePlugin[]>;

  /**
   * Everything about one plugin, for its card.
   *
   * Apart from the list because it is nearly all of the weight: the manifest
   * was 97 to 99 per cent of every index entry, so four plugins cost a
   * hundred kilobytes to draw four names. Fetched for the one somebody
   * opened, and remembered for as long as the store is open.
   */
  storePlugin(pluginId: string): Promise<PluginManifest | undefined>;

  /**
   * One of a store listing's pictures, as a data URL.
   *
   * Asked for by reference rather than sent with the list: the cover of every
   * plugin is small and the screenshots are not, and a store that fetched
   * every screenshot to draw a list of names would be slow on the one screen
   * that must not be.
   */
  storeImage(pluginId: string, reference: string): Promise<string | undefined>;

  /**
   * Fetches a plugin and unpacks it into the plugins folder.
   *
   * Replacing an installed plugin is refused unless asked for, because two
   * plugins with one id may be one plugin updated or two authors' plugins
   * colliding, and only the person in front of the window can say which.
   */
  installPlugin(pluginId: string, options?: { readonly replace?: boolean }): Promise<void>;

  /** Removes an installed plugin. Its settings and tokens stay behind. */
  removePlugin(pluginId: string): Promise<void>;

  /**
   * Installs a plugin from bytes somebody supplied rather than from a store.
   *
   * Base64 for the same reason an exported profile is: one protocol, and a
   * second binary channel for one button is not worth having. The archive is
   * checked for being a plugin at all — the extension it arrives under is the
   * same one a profile uses.
   */
  installPluginArchive(base64: string, options?: { readonly replace?: boolean }): Promise<string>;

  /**
   * One frame of a widget, for a window rather than for the panel.
   *
   * A picture that is different every second cannot be chosen blind — somebody
   * setting the colour of a graph has to see the graph — and this is the same
   * call the panel makes, answered for the editor.
   */
  drawSurface(request: SurfaceRequest): Promise<SurfaceFrame | undefined>;

  /**
   * The declaration of a field whose type depends on an earlier answer.
   *
   * Answers `shapeFrom`. Today only the widget action needs it: which control
   * to draw for "the new value" is not knowable until the setting has been
   * picked, and the answer is the setting's own declaration rather than a
   * restatement of it.
   */
  paramShape(
    source: string,
    params?: Readonly<Record<string, unknown>>,
  ): Promise<ParamDefinition | undefined>;

  /**
   * What a plugin's settings window needs to draw itself.
   *
   * Never the secrets themselves — only which of them are filled in. A
   * configurator that cannot receive a token cannot leak one, and it has no
   * use for the value: the control it draws is a password box.
   */
  pluginSettings(pluginId: string): Promise<{
    readonly values: Record<string, VariableValue>;
    readonly filledSecrets: readonly string[];
    readonly status: PluginStatus;
    readonly message?: LocalizedText;
  }>;

  savePluginSettings(
    pluginId: string,
    values: Readonly<Record<string, VariableValue>>,
  ): Promise<void>;

  /** Runs one of the buttons at the foot of a plugin's settings window. */
  runPluginCommand(pluginId: string, command: string): Promise<void>;

  /**
   * The choices behind a parameter declared with `optionsFrom`.
   *
   * Empty where the plugin cannot answer — it is not running, or whatever it
   * talks to is closed — which is what lets a key be set up before the
   * program it drives is even started.
   */
  pluginOptions(
    pluginId: string,
    source: string,
    params?: Readonly<Record<string, unknown>>,
  ): Promise<readonly ParamOption[]>;

  /**
   * A profile as one file: the document plus its pictures, zipped.
   *
   * Base64 because it travels over the same JSON protocol as everything else,
   * and the alternative — a second, binary channel — would exist for one
   * button in the settings window.
   */
  exportProfile(profileId: string): Promise<{ readonly name: string; readonly base64: string }>;

  /** Reads such a file back, under a fresh id if that one is taken. */
  importProfile(base64: string): Promise<{ readonly id: string }>;

  /** Where every plugin that holds a connection has got to, right now. */
  pluginStatuses(): Record<string, { status: PluginStatus; message?: LocalizedText }>;

  /**
   * Pictures from the user's icon folder, for the configurator to offer.
   *
   * Served by the daemon because only it can read that folder — a browser
   * talking over the API certainly cannot.
   */
  /**
   * The user's icon folder, and how much of it was left out.
   *
   * The count matters: a picture sitting in the folder and missing from the
   * picker, with nothing said about it, reads as the program having lost it.
   */
  listIcons(): Promise<Library>;

  listProfiles(): Promise<ProfileSummary[]>;
  getProfile(id: string): Promise<ProfileDefinition>;
  /** Stores it, and answers with the id it is filed under — renames move it. */
  saveProfile(profile: ProfileDefinition): Promise<{ id: string }>;

  /**
   * Passwords a button types, which live outside every profile.
   *
   * The list is of references that have something behind them; a value only
   * ever travels inward. See button-secrets.ts.
   */
  buttonSecrets(): Promise<readonly string[]>;
  saveButtonSecret(value: string, reference?: string): Promise<{ reference: string }>;
  clearButtonSecret(reference: string): Promise<void>;
  deleteProfile(id: string): Promise<void>;
  /** Puts a profile on a deck. Without one, on whichever deck is active. */
  activateProfile(id: string, deckId?: string): Promise<void>;

  /**
   * Changes how the daemon can be reached.
   *
   * The port and network access take effect on the next start; the rest are
   * checked per request and apply at once.
   */
  setNetworkSettings(patch: {
    networkAccess?: boolean;
    networkDecks?: boolean;
    extensionsApi?: boolean;
    port?: number;
  }): Promise<void>;

  /**
   * Devices allowed in, and devices asking to be.
   *
   * Ordinary facade methods rather than something the socket handles, so the
   * desktop window — which talks over IPC — can show the queue and answer it.
   */
  listDevices(): Promise<{
    readonly devices: readonly { id: string; name: string; approvedAt?: string; online: boolean }[];
    readonly pending: readonly { id: string; name: string; code: string; address?: string }[];
  }>;
  approveDevice(deviceId: string): Promise<void>;
  revokeDevice(deviceId: string): Promise<void>;

  /**
   * Devices allowed in, and devices asking to be.
   *
   * Ordinary facade methods rather than something the socket handles, so the
   * desktop window — which talks over IPC — can show the queue and answer it.
   */
  listDevices(): Promise<{
    readonly devices: readonly { id: string; name: string; approvedAt?: string; online: boolean }[];
    readonly pending: readonly { id: string; name: string; code: string; address?: string }[];
  }>;
  approveDevice(deviceId: string): Promise<void>;
  revokeDevice(deviceId: string): Promise<void>;

  /** Renames a deck, so two identical panels can be told apart. */
  renameDeck(deckId: string, name: string): Promise<void>;

  /**
   * Registers a deck that lives on another device and draws for itself.
   *
   * It gets a profile, a page and a history like any other deck — the only
   * difference is that scenes go out over the wire instead of to a compositor.
   */
  attachNetworkDeck(options: {
    readonly deviceId: string;
    readonly name: string;
    readonly rows: number;
    readonly cols: number;
    readonly send: (scene: unknown, doublePressKeys: readonly number[]) => void;
  }): Promise<{ readonly deckId: string }>;

  /** Removes a network deck, for a device that went away. */
  detachDeck(deckId: string): Promise<void>;

  /** A gesture the device recognised for itself. */
  reportGesture(deckId: string, key: number, gesture: string): void;

  /** Contact and release, for the configurator's live highlight. */
  reportPressed(deckId: string, key: number, pressed: boolean): void;

  /*
   * Variables belong to the machine, so these take no deck: there is one
   * truth about the mic, and every deck reads it.
   */
  setVariable(name: string, value: VariableValue): void;
  deleteVariable(name: string): void;

  /*
   * Navigation belongs to a deck. Turning a page on the tablet must leave the
   * panel on the desk where it was, which is the whole point of several decks
   * rather than several views of one.
   */
  openFolder(folderId: string, deckId?: string): void;
  goToPage(pageId: string, deckId?: string): void;
  goUp(deckId?: string): void;
  goHome(deckId?: string): void;
  goBack(deckId?: string): void;

  /**
   * Opens one of EasyDeck's own folders in the system file manager.
   *
   * Named rather than given as a path: the caller is a window that must not
   * be able to ask for an arbitrary directory, and only the daemon knows
   * where these live anyway — they move with the platform, and with
   * `EASYDECK_CONFIG_DIR` during development.
   */
  openAppFolder(folder: AppFolder): Promise<void>;

  setBrightness(percent: number): Promise<void>;
  /** Runs a key's actions as if it had been pressed, for testing from a UI. */
  simulateKey(key: number, deckId?: string): void;
  /** Runs a key's long-press actions, without waiting out the hold. */
  simulateLongPress(key: number, deckId?: string): void;
  /** Runs a key's double-press actions, without waiting out the window. */
  simulateDoublePress(key: number, deckId?: string): void;
}

/**
 * What the API server needs: the operations plus the event stream.
 *
 * Satisfied both by a live `DeckService` and by a host that owns one and
 * outlives it, which is what lets the API keep serving across a lock cycle.
 */
export interface ApiSource extends DeckFacade {
  /**
   * Subscribes to deck events.
   *
   * An explicit method rather than the emitter's own `on`: Node types that
   * one through a conditional the compiler cannot narrow while the event
   * parameter is still generic, so requiring it here would make every
   * implementation fail to satisfy the interface.
   */
  onDeckEvent<E extends keyof DeckEvents>(event: E, listener: (...args: DeckEvents[E]) => void): void;
}

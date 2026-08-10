import type { KeyView, PluginManifest, ProfileDefinition, VariableValue } from '@easydeck/engine';

import type { DeckState } from '../../domain/api-messages.js';
import type { LibraryImage } from '../../infrastructure/icon-library.js';
import type { DeckEvents } from './deck-events.js';
import type { ProfileSummary } from './repositories.js';

/**
 * Everything the API is allowed to do, as one interface.
 *
 * The request handler talks to this rather than to the live deck, so the
 * whole protocol layer can be tested against a few lines of fake — no device,
 * no renderer, no sockets.
 */
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
   * Pictures from the user's icon folder, for the configurator to offer.
   *
   * Served by the daemon because only it can read that folder — a browser
   * talking over the API certainly cannot.
   */
  listIcons(): Promise<readonly LibraryImage[]>;

  listProfiles(): Promise<ProfileSummary[]>;
  getProfile(id: string): Promise<ProfileDefinition>;
  saveProfile(profile: ProfileDefinition): Promise<void>;
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

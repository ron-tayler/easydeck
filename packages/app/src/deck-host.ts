import { EventEmitter } from 'node:events';

import {
  ApiHandler,
  FileProfileRepository,
  FileSettingsRepository,
  configDir,
  createStarterProfile,
  startDeck,
  startApiServer,
} from '@easydeck/core';
import type {
  ApiSource,
  DeckEvents,
  DeckService,
  DeckState,
  KeyView,
  PluginManifest,
  ProfileDefinition,
  ProfileSummary,
  RunningApiServer,
  VariableValue,
} from '@easydeck/core';

export type HostStatus =
  | { readonly state: 'starting' }
  | {
      readonly state: 'running';
      readonly device: string;
      readonly profileId?: string;
    }
  /** Released on purpose because the workstation is locked or asleep. */
  | { readonly state: 'locked' }
  | { readonly state: 'error'; readonly message: string }
  | { readonly state: 'stopped' };

export interface DeckHostEvents extends DeckEvents {
  status: [status: HostStatus];
}

/**
 * Owns the deck inside the Electron main process.
 *
 * The deck itself is disposable: it is fully released when the workstation
 * locks and rebuilt when it unlocks. The host is what stays — so the API is
 * bound here rather than to a deck instance, and clients survive a lock cycle
 * without noticing anything but a status change.
 *
 * It implements the same facade the API serves, delegating to whichever deck
 * is current, which is also why `main.ts` can stay about windows.
 */
export class DeckHost extends EventEmitter<DeckHostEvents> implements ApiSource {
  private deck?: DeckService;
  private api?: RunningApiServer;
  private readonly handler = new ApiHandler(this);
  private current: HostStatus = { state: 'stopped' };
  private locked = false;
  /** Serializes lifecycle changes so a fast lock-unlock cannot interleave. */
  private gate: Promise<void> = Promise.resolve();

  get status(): HostStatus {
    return this.current;
  }

  get running(): boolean {
    return this.deck !== undefined;
  }

  get apiHandler(): ApiHandler {
    return this.handler;
  }

  onDeckEvent<E extends keyof DeckEvents>(event: E, listener: (...args: DeckEvents[E]) => void): void {
    // The cast only bridges Node's conditional listener typing; the signature
    // above is the one callers see, and it is exact.
    this.on(event, listener as never);
  }

  async start(): Promise<void> {
    this.gate = this.gate.then(() => this.openDeck()).catch(() => undefined);
    await this.gate;

    if (!this.api) {
      this.api = await startApiServer({ service: this, configDirectory: configDir() });
    }
  }

  /**
   * Releases the deck exactly as quitting would: the panel is cleared and the
   * USB handle closed, so as far as the device is concerned EasyDeck is gone.
   *
   * Merely blanking the screen would not do. The device keeps reporting key
   * presses, and EasyDeck actions launch programs and press hotkeys — so a
   * locked machine with a live deck is a machine anyone walking past can
   * start things on. Letting go of the device entirely is the honest answer.
   */
  async suspend(): Promise<void> {
    this.gate = this.gate.then(() => this.closeDeck(true)).catch(() => undefined);
    return this.gate;
  }

  /** Brings the deck back with the active profile. */
  async resume(): Promise<void> {
    this.gate = this.gate
      .then(async () => {
        if (!this.locked) return;
        this.locked = false;
        await this.openDeck();
      })
      .catch(() => undefined);
    return this.gate;
  }

  async stop(): Promise<void> {
    this.gate = this.gate
      .then(async () => {
        const api = this.api;
        this.api = undefined;
        await api?.close().catch(() => undefined);
        await this.closeDeck(false);
      })
      .catch(() => undefined);
    return this.gate;
  }

  // --- the facade the API is served from ---------------------------------

  state(): Promise<DeckState> {
    return this.require().state();
  }

  pageView(): Promise<readonly KeyView[]> {
    return this.require().pageView();
  }

  plugins(): Promise<readonly PluginManifest[]> {
    return this.require().plugins();
  }

  listProfiles(): Promise<ProfileSummary[]> {
    return this.require().listProfiles();
  }

  getProfile(id: string): Promise<ProfileDefinition> {
    return this.require().getProfile(id);
  }

  saveProfile(profile: ProfileDefinition): Promise<void> {
    return this.require().saveProfile(profile);
  }

  deleteProfile(id: string): Promise<void> {
    return this.require().deleteProfile(id);
  }

  activateProfile(id: string): Promise<void> {
    return this.require().activateProfile(id);
  }

  setVariable(name: string, value: VariableValue): void {
    this.require().setVariable(name, value);
  }

  deleteVariable(name: string): void {
    this.require().deleteVariable(name);
  }

  openFolder(folderId: string): void {
    this.require().openFolder(folderId);
  }

  goToPage(pageId: string): void {
    this.require().goToPage(pageId);
  }

  goUp(): void {
    this.require().goUp();
  }

  goHome(): void {
    this.require().goHome();
  }

  goBack(): void {
    this.require().goBack();
  }

  setBrightness(percent: number): Promise<void> {
    return this.require().setBrightness(percent);
  }

  simulateKey(key: number): void {
    this.require().simulateKey(key);
  }

  simulateLongPress(key: number): void {
    this.require().simulateLongPress(key);
  }

  private require(): DeckService {
    if (!this.deck) {
      throw new Error(this.locked ? 'The deck is paused while the screen is locked' : 'The deck is not running');
    }
    return this.deck;
  }

  // --- internals ---------------------------------------------------------

  private async openDeck(): Promise<void> {
    if (this.deck) return;
    this.setStatus({ state: 'starting' });

    try {
      const profiles = new FileProfileRepository();
      const settings = new FileSettingsRepository();

      if ((await profiles.list()).length === 0) {
        await profiles.save(createStarterProfile(configDir()));
      }

      const deck = await startDeck({ profiles, settings });
      this.deck = deck;
      this.forward(deck);

      const state = await deck.state();
      this.setStatus({ state: 'running', device: state.device.model, profileId: state.activeProfileId });

      // Opening the device takes a second or two, so a UI that connected
      // first will have been told there is no deck. Announcing the state on
      // every successful start is what brings it back in line.
      this.emit('state', state);
    } catch (error) {
      // No device, a busy device, a broken profile — all are states to show,
      // never reasons for the app to fail to open.
      this.setStatus({ state: 'error', message: describe(error) });
    }
  }

  private async closeDeck(locked: boolean): Promise<void> {
    const deck = this.deck;
    this.deck = undefined;
    this.locked = locked;

    // Best effort: the point is to let go of the device, and a failure here
    // must not leave the host stuck believing a deck is still attached.
    await deck?.stop().catch(() => undefined);
    deck?.removeAllListeners();

    this.setStatus(locked ? { state: 'locked' } : { state: 'stopped' });
  }

  /** Re-emits a deck's events as the host's own, so clients see one stream. */
  private forward(deck: DeckService): void {
    deck.on('state', (state) => this.emit('state', state));
    deck.on('locationChanged', (location) => this.emit('locationChanged', location));
    deck.on('variablesChanged', (variables) => this.emit('variablesChanged', variables));
    deck.on('keyDown', (key) => this.emit('keyDown', key));
    deck.on('keyUp', (key) => this.emit('keyUp', key));
    deck.on('profilesChanged', () => this.emit('profilesChanged'));
    deck.on('actionError', (message) => this.emit('actionError', message));
  }

  private setStatus(status: HostStatus): void {
    this.current = status;
    this.emit('status', status);
  }
}

function describe(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  while (current instanceof Error && parts.length < 4) {
    parts.push(current.message);
    current = current.cause;
  }
  return parts.length > 0 ? parts.join(' <- ') : String(error);
}

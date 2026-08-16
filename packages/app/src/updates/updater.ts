import { EventEmitter } from 'node:events';

import { app } from 'electron';
import updaterPackage from 'electron-updater';

import type { DeckHost } from '../deck-host.js';
import { manifestChannel, releasePageUrl, updateAbility } from './channel.js';
import type { UpdateAbility, UpdateChannel } from './channel.js';
import { loadChannel, saveChannel } from './preferences.js';

// electron-updater is CommonJS and this zone is not, so the named export comes
// off the default import rather than out of the import statement.
const { autoUpdater } = updaterPackage;

/** Where the program is in the business of updating itself. */
export type UpdatePhase =
  | { readonly name: 'idle' }
  | { readonly name: 'checking' }
  /** A newer build exists. `url` is set when it has to be fetched by hand. */
  | { readonly name: 'available'; readonly version: string; readonly url?: string }
  | { readonly name: 'downloading'; readonly version: string; readonly percent: number }
  | { readonly name: 'ready'; readonly version: string }
  | { readonly name: 'error'; readonly message: string };

export interface UpdateStatus {
  readonly channel: UpdateChannel;
  readonly currentVersion: string;
  readonly ability: UpdateAbility;
  readonly phase: UpdatePhase;
  /** When the last check finished, successfully or not. */
  readonly checkedAt?: string;
}

/** A first look shortly after launch, then a quiet one every few hours. */
const FIRST_CHECK_DELAY = 30_000;
const BETWEEN_CHECKS = 6 * 60 * 60 * 1000;

/**
 * Keeping the installation up to date, and saying so.
 *
 * Downloading happens on its own; installing never does. A deck is something
 * people leave running while they work, and a program that decides on its own
 * to restart takes the panel away mid-task. So the file arrives quietly and
 * then waits — for the button, or for the app to be closed anyway.
 *
 * Whether any of this is possible at all is settled once, in `channel.ts`:
 * an unsigned Mac and a deb installed by apt can be told a new version exists
 * but cannot be given it, and they are sent to the release page instead.
 */
export class UpdateService extends EventEmitter<{ status: [UpdateStatus] }> {
  private channel: UpdateChannel = 'stable';
  private phase: UpdatePhase = { name: 'idle' };
  private checkedAt?: string;
  private timer?: NodeJS.Timeout;
  private readonly ability = updateAbility({
    platform: process.platform,
    packaged: app.isPackaged,
    // Set by the AppImage runtime itself, and the only honest way to tell an
    // AppImage from the same build unpacked by a package manager.
    appImage: Boolean(process.env['APPIMAGE']),
  });

  constructor(private readonly host: DeckHost) {
    super();
  }

  get status(): UpdateStatus {
    return {
      channel: this.channel,
      currentVersion: app.getVersion(),
      ability: this.ability,
      phase: this.phase,
      ...(this.checkedAt ? { checkedAt: this.checkedAt } : {}),
    };
  }

  /**
   * Wires up the updater and starts looking.
   *
   * Running from source stops here. There is no installation to replace, and
   * asking anyway only produces an error about a missing `app-update.yml`
   * every six hours for the rest of the session.
   */
  async start(): Promise<void> {
    this.channel = await loadChannel();
    if (!this.ability.self && this.ability.reason === 'development') return;

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.channel = manifestChannel(this.channel);
    autoUpdater.allowPrerelease = this.channel === 'prerelease';

    autoUpdater.on('update-available', (info) => {
      // Fetched here rather than by the updater on its own, so that the two
      // platforms which cannot install anything never spend somebody's
      // bandwidth on a file they will be told to download again by hand.
      if (this.ability.self) {
        this.set({ name: 'downloading', version: info.version, percent: 0 });
        void autoUpdater.downloadUpdate().catch((error: unknown) => this.failed(error));
      } else {
        this.set({ name: 'available', version: info.version, url: releasePageUrl(info.version) });
      }
    });

    autoUpdater.on('update-not-available', () => this.set({ name: 'idle' }));

    autoUpdater.on('download-progress', (progress) => {
      const version = this.phase.name === 'downloading' ? this.phase.version : app.getVersion();
      this.set({ name: 'downloading', version, percent: Math.round(progress.percent) });
    });

    autoUpdater.on('update-downloaded', (info) => this.set({ name: 'ready', version: info.version }));
    autoUpdater.on('error', (error) => this.failed(error));

    this.timer = setTimeout(() => void this.check(), FIRST_CHECK_DELAY);
  }

  /** Stops the clock. Called when the app is on its way out. */
  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  /**
   * Asks whether there is anything newer.
   *
   * Failures are recorded and shown but never thrown at the caller: a laptop
   * that woke up on a network with no route to GitHub is the ordinary case,
   * not something to interrupt anybody about.
   */
  async check(): Promise<UpdateStatus> {
    if (!this.ability.self && this.ability.reason === 'development') return this.status;
    // A check landing on top of a finished download would push the phase back
    // to idle and lose the button that installs it.
    if (this.phase.name === 'ready' || this.phase.name === 'downloading') return this.status;

    this.set({ name: 'checking' });
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      this.failed(error);
    } finally {
      this.checkedAt = new Date().toISOString();
      this.rearm();
    }
    return this.status;
  }

  /**
   * Restarts into the new version.
   *
   * The deck is released first and deliberately: the installer replaces files
   * this process still has open, and a panel that is never told goodbye keeps
   * its last frame lit above a program that no longer exists.
   */
  async install(): Promise<void> {
    if (this.phase.name !== 'ready') return;

    this.dispose();
    await this.host.stop();
    autoUpdater.quitAndInstall();
  }

  /**
   * Moves this installation to the other channel and looks straight away.
   *
   * Going from pre-releases back to stable is a step backwards in version
   * numbers — 0.5.0-rc.1 is newer than 0.4.0 — and an updater refuses to go
   * backwards unless told. Without that permission somebody who tried the
   * pre-release channel could never leave it: they would sit on a build the
   * stable channel has no answer for until stable finally overtook it.
   */
  async setChannel(channel: UpdateChannel): Promise<UpdateStatus> {
    if (channel === this.channel) return this.status;

    this.channel = channel;
    await saveChannel(channel);

    if (this.ability.self || this.ability.reason !== 'development') {
      autoUpdater.channel = manifestChannel(channel);
      autoUpdater.allowPrerelease = channel === 'prerelease';
      autoUpdater.allowDowngrade = channel === 'stable';
    }

    this.phase = { name: 'idle' };
    return this.check();
  }

  private rearm(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.check(), BETWEEN_CHECKS);
  }

  private failed(error: unknown): void {
    this.set({ name: 'error', message: error instanceof Error ? error.message : String(error) });
  }

  private set(phase: UpdatePhase): void {
    this.phase = phase;
    this.emit('status', this.status);
  }
}

/**
 * Updating the installed copy.
 *
 * Not part of the protocol, and deliberately so: the configurator also runs in
 * a browser on another machine, and that page is a deck — it has no business
 * restarting the computer this program is installed on. So this arrives over
 * the desktop bridge alone, and a UI served over the network simply finds it
 * missing and leaves the section out.
 */

/** Which builds this installation is offered. */
export type UpdateChannel = 'stable' | 'prerelease';

/** Why an installation cannot replace itself, when it cannot. */
export type NoSelfUpdate = 'development' | 'unsigned-macos' | 'linux-package';

export type UpdateAbility = { readonly self: true } | { readonly self: false; readonly reason: NoSelfUpdate };

export type UpdatePhase =
  | { readonly name: 'idle' }
  | { readonly name: 'checking' }
  | { readonly name: 'available'; readonly version: string; readonly url?: string }
  | { readonly name: 'downloading'; readonly version: string; readonly percent: number }
  | { readonly name: 'ready'; readonly version: string }
  | { readonly name: 'error'; readonly message: string };

export interface UpdateStatus {
  readonly channel: UpdateChannel;
  readonly currentVersion: string;
  readonly ability: UpdateAbility;
  readonly phase: UpdatePhase;
  readonly checkedAt?: string;
}

export interface UpdateBridge {
  get(): Promise<UpdateStatus>;
  check(): Promise<UpdateStatus>;
  install(): Promise<void>;
  setChannel(channel: UpdateChannel): Promise<UpdateStatus>;
  openRelease(): Promise<void>;
  onChange(listener: (status: UpdateStatus) => void): () => void;
}

/**
 * Wire protocol between the daemon and any UI.
 *
 * Plain JSON over a WebSocket: requests carry an id and get exactly one
 * response with the same id, and the daemon pushes events that belong to no
 * request. Deliberately not JSON-RPC — the shapes below are all it would give
 * us, and a hand-written client stays a dozen lines.
 */

import type { VariableDeclaration } from '@easydeck/engine';

export const API_PROTOCOL_VERSION = 1;

export interface RequestMessage {
  readonly type: 'request';
  readonly id: string;
  readonly method: string;
  readonly params?: Readonly<Record<string, unknown>>;
}

export interface ResponseMessage {
  readonly type: 'response';
  readonly id: string;
  readonly ok: boolean;
  readonly result?: unknown;
  readonly error?: { readonly message: string; readonly name?: string };
}

export interface EventMessage {
  readonly type: 'event';
  readonly event: ApiEvent;
  readonly payload?: unknown;
}

export type ServerMessage = ResponseMessage | EventMessage;

export type ApiEvent =
  /** Full snapshot, sent on connect and after a profile is (re)loaded. */
  | 'state'
  | 'locationChanged'
  /** The panel was repainted; a mirror of it should refresh. */
  | 'viewChanged'
  | 'variablesChanged'
  | 'keyDown'
  | 'keyUp'
  /** The set of stored profiles changed on disk. */
  | 'profilesChanged'
  /** An action failed. Surfaced so a UI can show it instead of a silent no-op. */
  | 'actionError'
  /** This connection is waiting to be approved; carries the code to match. */
  | 'devicePending'
  /** The wait is over: carries the token this device authenticates with. */
  | 'deviceApproved'
  /** This connection will not be entertained, and why. */
  | 'deviceRejected'
  /** The set of known or waiting devices changed. */
  | 'devicesChanged'
  /** A scene for a deck that draws for itself. */
  | 'scene';

/**
 * One deck, as a UI lists it.
 *
 * Everything here is per deck, because everything here can differ between two
 * of them: the profile, the page, even the size of the grid. What is *not*
 * here — variables, profiles on disk, brightness — belongs to the machine and
 * lives on `DeckState`.
 */
export interface DeckSummary {
  readonly id: string;
  readonly name: string;
  /** False once the hardware is gone; the deck keeps its state meanwhile. */
  readonly online: boolean;
  readonly rows: number;
  readonly cols: number;
  /** Absent for a deck with no hardware behind it, such as a tablet. */
  readonly model?: string;
  readonly keyWidth: number;
  readonly keyHeight: number;
  readonly profileId?: string;
  readonly location?: { readonly folderId: string; readonly pageId: string };
  readonly folderPath: readonly { readonly id: string; readonly name: string }[];
  readonly pages: readonly { readonly id: string; readonly name?: string }[];
}

/**
 * How the daemon can be reached, and what it allows.
 *
 * Shown rather than assumed: until this existed there was no way to find out
 * which port the daemon was on short of reading the source, and no way at all
 * to learn the address to type into a tablet.
 */
export interface NetworkState {
  readonly port: number;
  /** Whether a server is up right now. False until network access is on. */
  readonly running: boolean;
  /** What the settings ask for, which may differ from what is running. */
  readonly networkAccess: boolean;
  readonly networkDecks: boolean;
  readonly extensionsApi: boolean;
  /**
   * Addresses this machine can be reached at — empty while the server is off.
   *
   * Bare addresses, with no adapter names: "vEthernet (WSL (Hyper-V
   * firewall))" tells the person holding a tablet nothing they can act on.
   */
  readonly addresses: readonly { readonly address: string }[];
}

/** Snapshot a UI needs to render itself without asking anything else. */
export interface DeckState {
  readonly protocolVersion: number;
  /** Every deck that is running, in the order they were found. */
  readonly decks: readonly DeckSummary[];
  /** The deck a request that names none will act on. */
  readonly activeDeckId?: string;
  readonly brightness: number;
  readonly network: NetworkState;
  readonly variables: Record<string, string | number | boolean>;
  /**
   * What each variable is, alongside what it holds: the configurator needs the
   * type to draw the right control, and the owning plugin to know which ones
   * it must not offer to delete.
   */
  readonly variableDeclarations: readonly VariableDeclaration[];
  readonly actionTypes: readonly string[];
  readonly warnings: readonly string[];
}

export function isRequestMessage(value: unknown): value is RequestMessage {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Partial<RequestMessage>;
  return message.type === 'request' && typeof message.id === 'string' && typeof message.method === 'string';
}

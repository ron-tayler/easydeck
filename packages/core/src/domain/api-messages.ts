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
  | 'actionError';

/** Snapshot a UI needs to render itself without asking anything else. */
export interface DeckState {
  readonly protocolVersion: number;
  readonly device: {
    readonly model: string;
    readonly rows: number;
    readonly cols: number;
    readonly keyWidth: number;
    readonly keyHeight: number;
  };
  readonly activeProfileId?: string;
  /** Where the deck is: which scene, which of its pages. */
  readonly location?: { readonly folderId: string; readonly pageId: string };
  /** Root first, current folder last — a breadcrumb the UI can render. */
  readonly folderPath: readonly { readonly id: string; readonly name: string }[];
  /** Pages of the current folder, in author order, for the page strip. */
  readonly pages: readonly { readonly id: string; readonly name?: string }[];
  readonly brightness: number;
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

import { BrowserWindow, ipcMain } from 'electron';

import type { ApiEvent, EventMessage } from '@easydeck/core';

import type { DeckHost } from './deck-host.js';

export const IPC_REQUEST = 'easydeck:request';
export const IPC_EVENT = 'easydeck:event';
export const IPC_STATUS = 'easydeck:status';

/**
 * Bridges the window to the core over IPC.
 *
 * Note how little there is here: the core's `ApiHandler` already takes a
 * message object and returns a response object, so the same protocol the
 * WebSocket serves works over IPC with no second implementation. One protocol,
 * two transports — and the UI can speak either.
 */
export function registerIpc(host: DeckHost): void {
  // No special case for "not running": the host answers the facade whether a
  // deck is attached or not, turning its absence into an ordinary protocol
  // error the UI can display like any other.
  ipcMain.handle(IPC_REQUEST, (_event, message: unknown) => host.apiHandler.handle(message));

  ipcMain.handle(IPC_STATUS, () => host.status);

  host.on('status', (status) => broadcast(IPC_STATUS, status));

  // The window gets the same event stream the WebSocket serves, in the same
  // protocol shape — so the UI's two transports differ only in how bytes
  // travel, never in what they carry.
  const forward = (event: ApiEvent, payload?: unknown) =>
    broadcast(IPC_EVENT, { type: 'event', event, payload } satisfies EventMessage);

  host.onDeckEvent('state', (state) => forward('state', state));
  host.onDeckEvent('pageChanged', (pageId) => forward('pageChanged', { pageId }));
  host.onDeckEvent('variablesChanged', (variables) => forward('variablesChanged', { variables }));
  host.onDeckEvent('keyDown', (key) => forward('keyDown', { key }));
  host.onDeckEvent('keyUp', (key) => forward('keyUp', { key }));
  host.onDeckEvent('profilesChanged', () => forward('profilesChanged'));
  host.onDeckEvent('actionError', (message) => forward('actionError', { message }));
}

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload);
  }
}

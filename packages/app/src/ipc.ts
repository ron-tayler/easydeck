import { BrowserWindow, ipcMain } from 'electron';

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
}

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload);
  }
}

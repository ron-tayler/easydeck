import { BrowserWindow, ipcMain, shell } from 'electron';

import type { UpdateChannel } from './channel.js';
import type { UpdateService } from './updater.js';

export const IPC_UPDATE_STATUS = 'easydeck:update:status';
export const IPC_UPDATE_CHECK = 'easydeck:update:check';
export const IPC_UPDATE_INSTALL = 'easydeck:update:install';
export const IPC_UPDATE_CHANNEL = 'easydeck:update:channel';
export const IPC_UPDATE_OPEN = 'easydeck:update:open';
export const IPC_UPDATE_CHANGED = 'easydeck:update:changed';

/**
 * The window's door to the updater.
 *
 * Deliberately not part of the protocol the core serves. That protocol has two
 * transports and the other one is a browser on a second machine — which has
 * nothing to update and no business being told to restart this one. Updating
 * belongs to the copy installed here, so it travels over IPC alone and the
 * configurator simply does not offer the section when the bridge is absent.
 */
export function registerUpdateIpc(updates: UpdateService): void {
  ipcMain.handle(IPC_UPDATE_STATUS, () => updates.status);
  ipcMain.handle(IPC_UPDATE_CHECK, () => updates.check());
  ipcMain.handle(IPC_UPDATE_INSTALL, () => updates.install());

  ipcMain.handle(IPC_UPDATE_CHANNEL, (_event, channel: unknown) =>
    updates.setChannel(channel === 'prerelease' ? 'prerelease' : ('stable' satisfies UpdateChannel)),
  );

  // No address is taken from the window. The renderer asks to open "the
  // release being offered" and the answer comes from state held here, so a
  // page that got up to something cannot turn this into a way to launch a
  // browser at an address of its choosing.
  ipcMain.handle(IPC_UPDATE_OPEN, async () => {
    const phase = updates.status.phase;
    if (phase.name === 'available' && phase.url) await shell.openExternal(phase.url);
  });

  updates.on('status', (status) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(IPC_UPDATE_CHANGED, status);
    }
  });
}

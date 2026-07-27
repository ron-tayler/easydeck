// CommonJS on purpose: Electron loads preload scripts as CJS.
const { contextBridge, ipcRenderer } = require('electron');

/**
 * The entire surface the window is allowed to touch.
 *
 * Context isolation is on and Node is off in the renderer, so this file is the
 * only door between the UI and the machine. Keeping it this small is what
 * makes "the UI cannot do anything the protocol does not allow" a fact rather
 * than a hope — even a compromised page can only send protocol messages.
 */
contextBridge.exposeInMainWorld('easydeck', {
  /** Sends a protocol request and resolves with the protocol response. */
  request: (message) => ipcRenderer.invoke('easydeck:request', message),

  /** Current host status, without waiting for the next change. */
  getStatus: () => ipcRenderer.invoke('easydeck:status'),

  /** Subscribes to host status changes. Returns an unsubscribe function. */
  onStatus: (listener) => {
    const wrapped = (_event, status) => listener(status);
    ipcRenderer.on('easydeck:status', wrapped);
    return () => ipcRenderer.off('easydeck:status', wrapped);
  },

  /** Subscribes to protocol events. Returns an unsubscribe function. */
  onEvent: (listener) => {
    const wrapped = (_event, message) => listener(message);
    ipcRenderer.on('easydeck:event', wrapped);
    return () => ipcRenderer.off('easydeck:event', wrapped);
  },
});

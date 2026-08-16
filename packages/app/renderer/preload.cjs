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

  /**
   * Updating this installation.
   *
   * Its own section rather than protocol messages, because it is the one thing
   * here the browser on the second machine must not be able to ask for: that
   * page is a deck, not an operator of the computer this program runs on. A UI
   * served over the network finds this absent and leaves the section out.
   */
  updates: {
    /** Current update status, without waiting for the next change. */
    get: () => ipcRenderer.invoke('easydeck:update:status'),

    /** Looks for a new version now. Resolves with the status afterwards. */
    check: () => ipcRenderer.invoke('easydeck:update:check'),

    /** Releases the deck and restarts into the downloaded version. */
    install: () => ipcRenderer.invoke('easydeck:update:install'),

    /** Switches between 'stable' and 'prerelease', then checks. */
    setChannel: (channel) => ipcRenderer.invoke('easydeck:update:channel', channel),

    /** Opens the release page for the version being offered. */
    openRelease: () => ipcRenderer.invoke('easydeck:update:open'),

    /** Subscribes to status changes. Returns an unsubscribe function. */
    onChange: (listener) => {
      const wrapped = (_event, status) => listener(status);
      ipcRenderer.on('easydeck:update:changed', wrapped);
      return () => ipcRenderer.off('easydeck:update:changed', wrapped);
    },
  },
});

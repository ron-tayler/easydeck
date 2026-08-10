import { app, BrowserWindow } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { DeckHost } from './deck-host.js';
import { assetPath, createTray } from './tray.js';
import { registerIpc } from './ipc.js';
import { registerPowerHandlers } from './power.js';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Window lifecycle.
 *
 * Minimising behaves like any other window. Closing hides to the tray and
 * leaves the deck running — the deck is meant to work while its configurator
 * is out of the way, and reaching for the tray to shut it down is the
 * convention people already expect from this kind of app.
 *
 * Quitting therefore happens in exactly one place: the tray menu. `quitting`
 * is what tells the close handler to let the window actually go.
 */
let window: BrowserWindow | undefined;
let quitting = false;

const host = new DeckHost();

function createWindow(): BrowserWindow {
  const created = new BrowserWindow({
    // Wide enough for the deck grid, the editor's columns and the action
    // palette beside them, which is three squares across now.
    width: 1300,
    height: 720,
    minWidth: 800,
    minHeight: 560,
    show: false,
    backgroundColor: '#16181d',
    title: 'EasyDeck',
    // Same mark as the tray, at a size the taskbar and Alt-Tab can use.
    icon: assetPath('icon-256.png'),
    webPreferences: {
      preload: join(here, '..', 'renderer', 'preload.cjs'),
      // The renderer gets no Node access: it reaches the core only through the
      // narrow bridge in preload, which is the whole point of that file.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  created.once('ready-to-show', () => created.show());
  created.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    created.hide();
  });

  // A dev server URL wins when set, so the UI can be iterated on with hot
  // reload; otherwise the built configurator is loaded straight off disk.
  const devServer = process.env['EASYDECK_UI_URL'];
  if (devServer) void created.loadURL(devServer);
  else void created.loadFile(join(here, '..', '..', 'ui', 'dist', 'index.html'));

  return created;
}

export function showWindow(): void {
  if (!window || window.isDestroyed()) window = createWindow();
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

export function quitApp(): void {
  quitting = true;
  app.quit();
}

// A second launch should surface the running instance rather than fight it
// over the device — two processes holding the same deck is a mess the user
// cannot see or diagnose.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());

  app.whenReady().then(async () => {
    createTray({ onShow: showWindow, onQuit: quitApp, host });
    registerIpc(host);
    registerPowerHandlers(host);
    window = createWindow();

    // Starting the deck must not block the window: a missing or busy device is
    // a state to display, not a reason to fail to launch.
    void host.start();
  });

  // Deliberately does not quit: hiding the last window is how this app goes
  // to the tray, and the default behaviour would kill it right there.
  app.on('window-all-closed', () => {
    if (quitting) app.quit();
  });

  app.on('activate', () => showWindow());

  // The deck must be released before the process goes away, or the panel keeps
  // the last frame and the HID handle stays open until the OS cleans up.
  app.on('before-quit', async (event) => {
    quitting = true;
    if (!host.running) return;

    event.preventDefault();
    await host.stop();
    app.quit();
  });
}

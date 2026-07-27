import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Menu, Tray, nativeImage } from 'electron';
import type { NativeImage } from 'electron';

import type { DeckHost, HostStatus } from './deck-host.js';

/** Built by `pnpm icons`; see scripts/make-icons.mjs. */
export function assetPath(name: string): string {
  return fileURLToPath(new URL(`../assets/${name}`, import.meta.url));
}

export interface TrayOptions {
  readonly onShow: () => void;
  readonly onQuit: () => void;
  readonly host: DeckHost;
}

/**
 * The tray icon: the only proof the app is alive once the window is hidden.
 *
 * Its tooltip carries the deck status, so "is it running, and did it find my
 * device" is answerable without opening anything.
 */
export function createTray(options: TrayOptions): Tray {
  const tray = new Tray(trayIcon());
  tray.setToolTip('EasyDeck');

  const rebuildMenu = (status: HostStatus) => {
    const menu = Menu.buildFromTemplate([
      { label: describe(status), enabled: false },
      { type: 'separator' },
      { label: 'Open EasyDeck', click: options.onShow },
      { type: 'separator' },
      { label: 'Quit', click: options.onQuit },
    ]);
    tray.setContextMenu(menu);
    tray.setToolTip(`EasyDeck — ${describe(status)}`);
  };

  rebuildMenu(options.host.status);
  options.host.on('status', rebuildMenu);

  // Clicking the icon is the shortest path back to the window, and the one
  // people try first.
  tray.on('click', options.onShow);
  tray.on('double-click', options.onShow);

  return tray;
}

function describe(status: HostStatus): string {
  switch (status.state) {
    case 'starting':
      return 'Starting…';
    case 'running':
      return `Connected: ${status.device}`;
    case 'locked':
      return 'Released — screen locked';
    case 'error':
      return `Not running: ${status.message}`;
    case 'stopped':
      return 'Stopped';
  }
}

/**
 * The tray image, at both scale factors.
 *
 * PNG, not SVG: `nativeImage` decodes PNG and JPEG only, so the SVG data URL
 * this replaced produced a valid-looking but *empty* image — and an empty tray
 * icon is invisible rather than broken, which is why it survived so long.
 *
 * The 2x representation matters on any scaled display, which is most of them:
 * without it the system upscales the 16px art and the grid turns to mush.
 */
function trayIcon(): NativeImage {
  const icon = nativeImage.createFromPath(assetPath('icon-16.png'));

  if (icon.isEmpty()) {
    // Loudly, because the failure mode is silence: the app runs, the tray
    // works, and nothing shows up in it.
    console.error(`EasyDeck: tray icon missing at ${assetPath('icon-16.png')}; run "pnpm icons"`);
    return icon;
  }

  icon.addRepresentation({ scaleFactor: 2, buffer: readFileSync(assetPath('icon-32.png')) });
  return icon;
}

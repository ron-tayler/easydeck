import { Menu, Tray, nativeImage } from 'electron';

import type { DeckHost, HostStatus } from './deck-host.js';

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
 * A placeholder icon drawn as a data URL.
 *
 * Keeps the skeleton free of binary assets; a real icon set lands with
 * packaging, where each platform wants its own sizes and formats anyway.
 */
function trayIcon() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
    <rect width="32" height="32" rx="7" fill="#1668dc"/>
    <g fill="#ffffff">
      <rect x="7" y="8" width="5" height="5" rx="1.2"/>
      <rect x="13.5" y="8" width="5" height="5" rx="1.2"/>
      <rect x="20" y="8" width="5" height="5" rx="1.2"/>
      <rect x="7" y="14" width="5" height="5" rx="1.2"/>
      <rect x="13.5" y="14" width="5" height="5" rx="1.2"/>
      <rect x="20" y="14" width="5" height="5" rx="1.2"/>
      <rect x="7" y="20" width="5" height="5" rx="1.2"/>
      <rect x="13.5" y="20" width="5" height="5" rx="1.2"/>
      <rect x="20" y="20" width="5" height="5" rx="1.2"/>
    </g>
  </svg>`;

  return nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`,
  );
}

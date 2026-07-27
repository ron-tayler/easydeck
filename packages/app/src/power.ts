import { powerMonitor } from 'electron';

import type { DeckHost } from './deck-host.js';

/**
 * Suspends the deck while the machine is locked or asleep.
 *
 * A stream deck sits on the desk in reach of anyone who walks past, and its
 * buttons launch programs and press hotkeys. That is fine while the owner is
 * logged in and rather less fine when the screen is locked — so EasyDeck
 * follows the workstation: locked machine, dormant deck.
 *
 * `lock-screen` and `unlock-screen` only fire on Windows and macOS. Linux
 * gets the suspend/resume pair, which covers the laptop-lid case everywhere.
 */
export function registerPowerHandlers(host: DeckHost): void {
  powerMonitor.on('lock-screen', () => void host.suspend());
  powerMonitor.on('unlock-screen', () => void host.resume());

  powerMonitor.on('suspend', () => void host.suspend());
  powerMonitor.on('resume', () => void host.resume());
}

import { homedir } from 'node:os';
import { join } from 'node:path';

const APP_NAME = 'EasyDeck';

/**
 * Where EasyDeck keeps its configuration, following each platform's own
 * convention rather than inventing one.
 *
 * `EASYDECK_CONFIG_DIR` overrides it, which is what tests use and what lets
 * a user keep a profile set on a synced drive.
 */
export function configDir(): string {
  const override = process.env['EASYDECK_CONFIG_DIR'];
  if (override) return override;

  if (process.platform === 'win32') {
    const appData = process.env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming');
    return join(appData, APP_NAME);
  }

  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', APP_NAME);
  }

  const xdg = process.env['XDG_CONFIG_HOME'];
  return join(xdg && xdg.length > 0 ? xdg : join(homedir(), '.config'), 'easydeck');
}

export function profilesDir(): string {
  return join(configDir(), 'profiles');
}

export function pluginsDir(): string {
  return join(configDir(), 'plugins');
}

/**
 * Pictures the user has collected, to be offered alongside the built-in set.
 *
 * A folder rather than an import step: dropping files in is how people already
 * manage an icon collection, and it is what an icon pack will unpack into.
 * What ends up in a profile is still an embedded copy — this folder is where
 * you *choose* from, not where a button's picture lives.
 */
export function iconsDir(): string {
  return join(configDir(), 'icons');
}

export function settingsFile(): string {
  return join(configDir(), 'settings.json');
}

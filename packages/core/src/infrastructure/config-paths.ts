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
 * What each plugin has been configured with — a file per plugin.
 *
 * Beside the installed plugins rather than inside them: a plugin folder is
 * something the user drops in and may replace wholesale, and settings that
 * vanish when a plugin is updated would be a poor surprise. Beside the
 * profiles rather than inside them for a bigger reason — a profile is meant
 * to be copied to another machine and shared, while the port OBS listens on
 * belongs to this machine alone.
 */
export function pluginSettingsDir(): string {
  return join(configDir(), 'plugin-settings');
}

/**
 * Tokens, passwords and keys, kept apart from everything else.
 *
 * A separate folder so that "send me your settings" stays a safe thing to
 * ask. The contents are sealed where the platform offers a way to do it and
 * are readable otherwise, which is stated in the file itself rather than
 * being left for the user to discover.
 */
export function secretsDir(): string {
  return join(configDir(), 'secrets');
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

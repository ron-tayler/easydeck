/**
 * The daemon as a user would actually run it.
 *
 * Run with:  pnpm --filter @easydeck/daemon start
 *
 * Reads profiles and settings from the platform's configuration directory,
 * seeding a starter profile on first run, then serves the API a configurator
 * connects to. Editing a profile in a text editor reloads it live.
 */
import { startApiServer } from '../infrastructure/api/websocket-server.js';
import { configDir } from '../infrastructure/config-paths.js';
import { FileProfileRepository } from '../infrastructure/file-profile-repository.js';
import { FileSettingsRepository } from '../infrastructure/file-settings-repository.js';
import { startDeck } from '../start-deck.js';
import { createStarterProfile } from './starter-profile.js';

/**
 * Flattens an error and everything that caused it.
 *
 * Actions are wrapped by the engine, so the outer message only names the
 * action that failed — the reason is one or more `cause` links down. Printing
 * just the top of the chain turns a one-line fix into a guessing game.
 */
function describe(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;

  while (current instanceof Error && parts.length < 5) {
    parts.push(current.message);
    current = current.cause;
  }

  return parts.length > 0 ? parts.join('  <- ') : String(error);
}

async function main(): Promise<void> {
  const profiles = new FileProfileRepository();
  const settings = new FileSettingsRepository();

  if ((await profiles.list()).length === 0) {
    await profiles.save(createStarterProfile(configDir()));
    console.log(`No profiles found, wrote a starter one to ${profiles.path}`);
  }

  const deck = await startDeck({ profiles, settings });
  const state = await deck.state();

  const api = await startApiServer({ service: deck, configDirectory: configDir() });

  console.log(`Config:   ${configDir()}`);
  console.log(`Device:   ${state.device.model}`);
  console.log(`Profile:  ${state.activeProfileId}`);
  console.log(`API:      ${api.url}?token=${api.token}`);
  for (const warning of state.warnings) console.warn(`Warning:  ${warning}`);
  console.log('\nRunning. Edit a profile to reload it live. Ctrl+C to stop.\n');

  deck.on('actionError', (message) => console.error(`action: ${message}`));
  deck.on('pageChanged', (pageId) => console.log(`page -> ${pageId}`));
  deck.on('profilesChanged', () => console.log('profiles changed on disk'));

  const shutdown = () => {
    void Promise.resolve()
      .then(() => api.close())
      .then(() => deck.stop())
      .catch((error) => console.error(describe(error)))
      .finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error(describe(error));
  process.exitCode = 1;
});

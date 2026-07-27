/**
 * The daemon as a user would actually run it.
 *
 * Run with:  pnpm --filter @easydeck/daemon start
 *
 * Reads profiles and settings from the platform's configuration directory,
 * seeding a starter profile on first run so the deck does something useful
 * out of the box. Edit the JSON and restart to see changes; a live reload
 * arrives with the WebSocket API.
 */
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
  console.log(`Config:   ${configDir()}`);
  console.log(`Device:   ${deck.surface.info.modelName}`);
  console.log(`Profile:  ${deck.controller.profileId}`);
  if (deck.warning) console.warn(`Warning:  ${deck.warning}`);
  console.log('\nRunning. Ctrl+C to stop.\n');

  deck.controller.on('error', (error) => console.error(describe(error)));
  deck.controller.on('pageChanged', (pageId) => console.log(`page -> ${pageId}`));

  const shutdown = () => {
    void deck
      .stop()
      .catch((error) => console.error(error))
      .finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

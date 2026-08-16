/**
 * The daemon as a user would actually run it.
 *
 * Run with:  pnpm --filter @easydeck/core start
 *
 * Reads profiles and settings from the platform's configuration directory,
 * seeding a starter profile on first run, then serves the API a configurator
 * connects to. Editing a profile in a text editor reloads it live.
 */
import { DeviceDirectory } from '../application/device-directory.js';
import type { DeckService } from '../application/deck-service.js';
import { localAddresses } from '../infrastructure/api/network-addresses.js';
import { findUiDirectory } from '../infrastructure/api/ui-directory.js';
import { startApiServer } from '../infrastructure/api/websocket-server.js';
import type { RunningApiServer } from '../infrastructure/api/websocket-server.js';
import { configDir } from '../infrastructure/config-paths.js';
import { FileProfileRepository } from '../infrastructure/file-profile-repository.js';
import { FileSettingsRepository } from '../infrastructure/file-settings-repository.js';
import { startDeck } from '../start-deck.js';
import { LogFile } from '../infrastructure/log-file.js';
import { createStarterProfile } from '../starter-profile.js';

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

  const devices = new DeviceDirectory(configDir());
  const uiDirectory = findUiDirectory();

  /*
   * The server exists only while network access is on.
   *
   * Nothing local needs a port — the desktop window talks to the core
   * directly — so a socket that is open regardless would be listening on
   * someone's machine without their say-so. Switching the setting off takes
   * the socket away, rather than leaving it up until the next launch.
   */
  let api: RunningApiServer | undefined;
  let service: DeckService | undefined;

  const applyNetwork = async (): Promise<{ port: number; networkAccess: boolean } | undefined> => {
    const current = await settings.load();

    await api?.close().catch(() => undefined);
    api = undefined;

    if (!current.networkAccess || !service) return undefined;

    api = await startApiServer({
      service,
      configDirectory: configDir(),
      devices,
      host: '0.0.0.0',
      ...(current.port ? { port: current.port } : {}),
      ...(uiDirectory ? { uiDirectory } : {}),
      permissions: async () => {
        const now = await settings.load();
        return {
          networkDecks: now.networkDecks === true,
          extensionsApi: now.extensionsApi === true,
        };
      },
    });

    return { port: api.port, networkAccess: true };
  };

  /*
   * A log, echoed to the terminal that started this.
   *
   * The file is what the desktop app relies on, because it has no terminal;
   * here there is one and watching it is the point, so both.
   */
  const log = new LogFile({ echo: true });
  log.start(`EasyDeck headless — ${process.platform}, node ${process.versions.node}`);
  console.log(`Логи: ${log.path}`);

  const deck = await startDeck({ profiles, settings, devices, applyNetwork, log });
  service = deck;
  const state = await deck.state();

  // The configurator shows where the daemon can be reached, and it must show
  // the truth: the port asked for may have been taken.
  deck.setListening(await applyNetwork());

  console.log(`Config:   ${configDir()}`);
  for (const deck of state.decks) {
    console.log(`Deck:     ${deck.name} — ${deck.profileId ?? 'no profile'}`);
  }
  if (api) {
    // What a tablet is meant to open: every one of these serves the deck, and
    // only the deck.
    for (const entry of localAddresses()) {
      console.log(`Deck:     http://${entry.address}:${api.port}/`);
    }
  } else {
    console.log('Network:  off — switch it on in Settings → Network to use a tablet as a deck');
  }
  for (const warning of state.warnings) console.warn(`Warning:  ${warning}`);
  console.log('\nRunning. Edit a profile to reload it live. Ctrl+C to stop.\n');

  deck.on('actionError', (message) => console.error(`action: ${message}`));
  deck.on('locationChanged', ({ deckId, location }) =>
    console.log(`${deckId}: location -> ${location.folderId} / ${location.pageId}`),
  );
  deck.on('profilesChanged', () => console.log('profiles changed on disk'));

  const shutdown = () => {
    void Promise.resolve()
      .then(() => api?.close())
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

/**
 * Runs the demo profile on real hardware — the whole stack end to end.
 *
 * Run with:  pnpm --filter @easydeck/core demo
 */
import { startDeck } from '../start-deck.js';
import { DEMO_PROFILE } from './demo-profile.js';

async function main(): Promise<void> {
  const deck = await startDeck({ profile: DEMO_PROFILE, brightness: 60 });
  console.log(`Running '${DEMO_PROFILE.name}' on ${deck.surface.info.modelName}`);
  console.log('Key 1 toggles the mic, key 3 cycles scenes, key 5 counts (hold to reset),');
  console.log('bottom-right switches pages. Ctrl+C to exit.\n');

  deck.controller.on('error', (error) => console.error('engine:', error.message));
  deck.controller.on('pageChanged', (pageId) => console.log(`page -> ${pageId}`));
  deck.controller.on('painted', (keys) => console.log(`painted ${keys.join(', ')}`));

  process.on('SIGINT', () => {
    void deck
      .stop()
      .catch((error) => console.error(error))
      .finally(() => process.exit(0));
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

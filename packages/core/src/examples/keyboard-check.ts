/**
 * Verifies keyboard emulation without involving the deck at all.
 *
 * Run with:  pnpm --filter @easydeck/core keyboard-check
 *
 * Reports whether the optional native backend loaded and how a combination
 * resolves, then — after a countdown long enough to focus a text editor —
 * types a line and sends a real hotkey. If nothing appears, the problem is
 * the backend or the platform, not the deck, the profile or the engine.
 */
import { ActionRegistry } from '@easydeck/engine';
import type { ActionContext } from '@easydeck/engine';

import { registerKeyboardActions } from '../infrastructure/actions/keyboard-actions.js';

const COUNTDOWN_SECONDS = 6;
const TEST_LINE = 'EasyDeck keyboard works';

/** The controller normally supplies this; nothing here touches it. */
const context = {
  button: { id: 'keyboard-check', key: 0 },
  pageId: '',
  profileId: '',
} as unknown as ActionContext;

async function main(): Promise<void> {
  const registry = new ActionRegistry();
  const result = await registerKeyboardActions(registry);

  if (!result.available) {
    console.error(result.reason);
    console.error('\nInstall it with:  pnpm --filter @easydeck/core add @nut-tree-fork/nut-js');
    process.exitCode = 1;
    return;
  }

  console.log('Native backend: loaded');
  console.log(`Registered actions: ${registry.types().join(', ')}`);

  console.log(`\nFocus a text editor. Typing starts in ${COUNTDOWN_SECONDS} seconds.`);
  for (let left = COUNTDOWN_SECONDS; left > 0; left--) {
    process.stdout.write(`  ${left}... `);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  console.log('\n');

  await registry.run({ type: 'type-text', params: { text: TEST_LINE } }, context);
  console.log(`Sent text: "${TEST_LINE}"`);

  // Select what was just typed: visible proof that modifiers work too.
  await new Promise((resolve) => setTimeout(resolve, 300));
  await registry.run({ type: 'hotkey', params: { keys: 'shift+Home' } }, context);
  console.log('Sent hotkey: shift+Home (should select the line just typed)');

  console.log('\nIf both happened in your editor, keyboard actions are working.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

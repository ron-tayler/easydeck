import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Surface } from '@easydeck/device';
import { ActionRegistry, VariableStore } from '@easydeck/engine';
import type { ActionContext } from '@easydeck/engine';

import { registerDeviceActions } from './device-actions.js';
import type { BrightnessControl } from './device-actions.js';

const context: ActionContext = {
  variables: new VariableStore(),
  deckId: 'test',
  button: { id: 'b', key: 0 },
  location: { folderId: 'root', pageId: 'main' },
  profileId: 'p',
  openFolder() {},
  goToPage() {},
  goUp() {},
  goHome() {},
  goBack() {},
  setButtonState() {},
};

/** Clamps exactly as the service does, so the tests see real behaviour. */
function fakeBrightness(start: number): BrightnessControl & { value: number } {
  return {
    value: start,
    current() {
      return this.value;
    },
    async set(percent: number) {
      this.value = Math.min(100, Math.max(0, Math.round(percent)));
    },
  };
}

const surface = { sleep() {}, wake() {}, setBrightness() {} } as unknown as Surface;

async function run(
  brightness: BrightnessControl,
  params: Record<string, unknown>,
): Promise<void> {
  const registry = registerDeviceActions(new ActionRegistry(), () => surface, brightness);
  await registry.run({ type: 'deck.set-brightness', params }, context);
}

describe('brightness action', () => {
  it('sets an absolute value', async () => {
    const brightness = fakeBrightness(30);
    await run(brightness, { mode: 'set', percent: 80 });
    assert.equal(brightness.value, 80);
  });

  /** Profiles written before the mode parameter existed must keep working. */
  it('treats a missing mode as setting the value', async () => {
    const brightness = fakeBrightness(30);
    await run(brightness, { percent: 55 });
    assert.equal(brightness.value, 55);
  });

  it('adds to and subtracts from whatever the panel is on now', async () => {
    const up = fakeBrightness(40);
    await run(up, { mode: 'increase', percent: 15 });
    assert.equal(up.value, 55);

    const down = fakeBrightness(40);
    await run(down, { mode: 'decrease', percent: 15 });
    assert.equal(down.value, 25);
  });

  /**
   * A button held down should stop at the end of the range rather than build
   * up an invisible debt that the next press has to spend.
   */
  it('stops at the ends of the range', async () => {
    const high = fakeBrightness(95);
    await run(high, { mode: 'increase', percent: 20 });
    assert.equal(high.value, 100);

    const low = fakeBrightness(5);
    await run(low, { mode: 'decrease', percent: 20 });
    assert.equal(low.value, 0);
  });
});

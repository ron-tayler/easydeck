import { onUnmounted, ref, shallowRef } from 'vue';

import type { UpdateChannel, UpdateStatus } from '../api/updates.js';

/**
 * Whether this window can talk about updates at all.
 *
 * False in a browser, and false in a desktop build older than the bridge —
 * which is exactly the copy most in need of an update and least able to be
 * told so. Nothing to be done about that one from here; it is why the section
 * disappears rather than showing an error.
 */
export function updatesAvailable(): boolean {
  return typeof window !== 'undefined' && window.easydeck?.updates !== undefined;
}

/**
 * The update section's state.
 *
 * Everything of consequence happens in the main process; this only asks, shows
 * and relays the buttons. The status arrives both as an answer and as a stream
 * of changes, because a download that started on its own has no question to be
 * the answer to.
 */
export function useUpdates() {
  const status = shallowRef<UpdateStatus | undefined>();
  /** True while a button is waiting on the main process. */
  const busy = ref(false);

  const bridge = typeof window !== 'undefined' ? window.easydeck?.updates : undefined;

  if (bridge) {
    void bridge.get().then((first) => (status.value = first));
    onUnmounted(bridge.onChange((next) => (status.value = next)));
  }

  async function check(): Promise<void> {
    if (bridge) await run(() => bridge.check().then((next) => (status.value = next)));
  }

  async function setChannel(channel: UpdateChannel): Promise<void> {
    if (bridge) await run(() => bridge.setChannel(channel).then((next) => (status.value = next)));
  }

  async function install(): Promise<void> {
    if (!bridge) return;
    // No `busy` reset afterwards on purpose: if this works, the window is
    // going away, and a button that springs back to life first would invite a
    // second press into a program already on its way out.
    busy.value = true;
    await bridge.install();
  }

  async function openRelease(): Promise<void> {
    if (bridge) await bridge.openRelease();
  }

  async function run(action: () => Promise<unknown>): Promise<void> {
    busy.value = true;
    try {
      await action();
    } finally {
      busy.value = false;
    }
  }

  return { status, busy, check, install, setChannel, openRelease };
}

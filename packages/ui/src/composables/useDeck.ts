import { onScopeDispose, readonly, ref, shallowRef } from 'vue';
import type { DeckState, KeyView, ProfileSummary } from '@easydeck/core';

import { createClient } from '../api/client.js';
import type { DeckClient } from '../api/client.js';

/**
 * The deck, as reactive state.
 *
 * A single shared instance rather than a store library: the state is one
 * snapshot plus one list, and the events that change it are already a stream
 * from the core. Adding a store on top would be ceremony around a `ref`.
 */
const client: DeckClient = createClient();

const connected = ref(false);
const state = shallowRef<DeckState | undefined>();
const keys = shallowRef<readonly KeyView[]>([]);
const profiles = shallowRef<readonly ProfileSummary[]>([]);
const pressedKeys = ref<ReadonlySet<number>>(new Set());
const lastError = ref<string | undefined>();
const loading = ref(true);

let started = false;

async function refreshState(): Promise<void> {
  try {
    state.value = await client.call<DeckState>('getState');
    lastError.value = undefined;
  } catch (error) {
    // A deck that is absent or locked is a normal condition, not a crash: the
    // protocol answers with an error and the UI shows it.
    state.value = undefined;
    lastError.value = (error as Error).message;
  }
}

async function refreshView(): Promise<void> {
  try {
    const result = await client.call<{ keys: KeyView[] }>('getPageView');
    keys.value = result.keys;
  } catch {
    keys.value = [];
  }
}

async function refreshProfiles(): Promise<void> {
  try {
    const result = await client.call<{ profiles: ProfileSummary[] }>('listProfiles');
    profiles.value = result.profiles;
  } catch {
    profiles.value = [];
  }
}

const RETRY_DELAY_MS = 1200;
let retryTimer: ReturnType<typeof setTimeout> | undefined;

async function refreshAll(): Promise<void> {
  loading.value = true;
  await Promise.all([refreshState(), refreshView(), refreshProfiles()]);
  loading.value = false;

  // Opening the device takes a moment, and the window is usually ready first,
  // so the initial snapshot legitimately fails. Rather than leaving "no deck"
  // on screen until something else happens to arrive, keep asking until the
  // deck answers — the 'state' event does the same job, but neither can be
  // relied on to be the one that wins.
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = state.value ? undefined : setTimeout(() => void refreshAll(), RETRY_DELAY_MS);
}

function markPressed(key: number, pressed: boolean): void {
  const next = new Set(pressedKeys.value);
  if (pressed) next.add(key);
  else next.delete(key);
  pressedKeys.value = next;
}

function start(): void {
  if (started) return;
  started = true;

  client.onConnected((value) => {
    connected.value = value;
    if (value) void refreshAll();
  });

  // A repaint on the device and a repaint here are triggered by the same
  // events, so the window cannot drift from the panel.
  client.on('state', () => void refreshAll());
  client.on('pageChanged', () => void Promise.all([refreshState(), refreshView()]));
  client.on('variablesChanged', () => void Promise.all([refreshState(), refreshView()]));
  client.on('profilesChanged', () => void refreshProfiles());
  client.on('actionError', (payload) => {
    lastError.value = (payload as { message?: string })?.message;
  });

  client.on('keyDown', (payload) => markPressed((payload as { key: number }).key, true));
  client.on('keyUp', (payload) => markPressed((payload as { key: number }).key, false));
}

export function useDeck() {
  start();
  onScopeDispose(() => undefined);

  return {
    connected: readonly(connected),
    state,
    keys,
    profiles,
    pressedKeys: readonly(pressedKeys),
    lastError,
    loading: readonly(loading),

    transportKind: client.kind,
    refresh: refreshAll,
    pressKey: (key: number) => client.call('simulateKey', { key }),
    goToPage: (pageId: string) => client.call('goToPage', { pageId }),
    activateProfile: (id: string) => client.call('activateProfile', { id }),
    setBrightness: (percent: number) => client.call('setBrightness', { percent }),
  };
}

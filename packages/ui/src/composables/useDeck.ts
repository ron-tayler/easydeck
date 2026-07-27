import { onScopeDispose, readonly, ref, shallowRef } from 'vue';
import type {
  DeckState,
  KeyView,
  PluginManifest,
  ProfileDefinition,
  ProfileSummary,
} from '@easydeck/core';

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
/** The active profile in full — the left panel needs its whole folder tree. */
const profile = shallowRef<ProfileDefinition | undefined>();
const plugins = shallowRef<readonly PluginManifest[]>([]);
const pressedKeys = ref<ReadonlySet<number>>(new Set());

/**
 * Whatever went wrong last, shown in the banner.
 *
 * Exported so the app's error handler can write to it too: a component that
 * throws while rendering would otherwise fail invisibly, and "the dialog does
 * not open and nothing is said" is the worst kind of bug to chase.
 */
export const lastError = ref<string | undefined>();
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

async function refreshProfile(): Promise<void> {
  const id = state.value?.activeProfileId;
  if (!id) {
    profile.value = undefined;
    return;
  }

  try {
    const result = await client.call<{ profile: ProfileDefinition }>('getProfile', { id });
    profile.value = result.profile;
  } catch {
    profile.value = undefined;
  }
}

async function refreshPlugins(): Promise<void> {
  try {
    const result = await client.call<{ plugins: PluginManifest[] }>('getPlugins');
    plugins.value = result.plugins;
  } catch {
    plugins.value = [];
  }
}

const RETRY_DELAY_MS = 1200;
let retryTimer: ReturnType<typeof setTimeout> | undefined;

async function refreshAll(): Promise<void> {
  loading.value = true;
  await Promise.all([refreshState(), refreshView(), refreshProfiles(), refreshPlugins()]);
  // Needs the state first: which profile to fetch comes from it.
  await refreshProfile();
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
  client.on('locationChanged', () => void Promise.all([refreshState(), refreshView()]));
  // Follows the repaint itself rather than guessing from what might have
  // caused it: a button state can change with no variable involved at all.
  client.on('viewChanged', () => void refreshView());
  client.on('variablesChanged', () => void Promise.all([refreshState(), refreshView()]));
  client.on('profilesChanged', () => void Promise.all([refreshProfiles(), refreshProfile()]));
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
    profile,
    plugins,
    pressedKeys: readonly(pressedKeys),
    lastError,
    loading: readonly(loading),

    transportKind: client.kind,
    refresh: refreshAll,
    pressKey: (key: number) => client.call('simulateKey', { key }),
    holdKey: (key: number) => client.call('simulateLongPress', { key }),
    saveProfile: async (profile: ProfileDefinition) => {
      await client.call('saveProfile', { profile });
      // The save triggers a reload on the host, which announces new state;
      // refreshing here as well keeps the window responsive rather than
      // waiting a round trip for the event to come back.
      await refreshAll();
    },
    openFolder: (folderId: string) => client.call('openFolder', { folderId }),
    goToPage: (pageId: string) => client.call('goToPage', { pageId }),
    goUp: () => client.call('goUp'),
    activateProfile: (id: string) => client.call('activateProfile', { id }),
    setBrightness: (percent: number) => client.call('setBrightness', { percent }),
    setVariable: (name: string, value: string | number | boolean) =>
      client.call('setVariable', { name, value }),
    deleteVariable: (name: string) => client.call('deleteVariable', { name }),
  };
}

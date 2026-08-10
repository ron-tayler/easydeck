import { computed, onScopeDispose, readonly, ref, shallowRef } from 'vue';
import type {
  DeckState,
  InstalledPluginInfo,
  InstalledPluginSummary,
  KeyView,
  LibraryImage,
  PluginManifest,
  ProfileDefinition,
  ProfileSummary,
} from '@easydeck/core';

import { applyPluginMessages } from '../i18n/index.js';
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
/** What the plugins folder holds, which may be pictures and text and no actions. */
const installedPlugins = shallowRef<readonly InstalledPluginInfo[]>([]);
const brokenPlugins = shallowRef<readonly { id: string; problem: string }[]>([]);
const pressedKeys = ref<ReadonlySet<number>>(new Set());
/**
 * Which deck the window is showing.
 *
 * Undefined means "whichever the daemon calls active", which is what a fresh
 * window wants and what a machine with one deck always wants. Once the user
 * picks one, every request and every event is filtered through it.
 */
const selectedDeckId = ref<string | undefined>();
/** Devices already let in, and those knocking right now. */
const devices = shallowRef<
  readonly { id: string; name: string; approvedAt?: string; online?: boolean }[]
>([]);
const pendingDevices = shallowRef<
  readonly { id: string; name: string; code: string; address?: string }[]
>([]);

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
    const result = await client.call<{ keys: KeyView[] }>('getPageView', deckParam());
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
  const decks = state.value?.decks ?? [];
  const shown = selectedDeckId.value ?? state.value?.activeDeckId;
  const id = (decks.find((entry) => entry.id === shown) ?? decks[0])?.profileId;
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

  try {
    const installed = await client.call<InstalledPluginSummary>('getInstalledPlugins');
    installedPlugins.value = installed.plugins;
    brokenPlugins.value = installed.broken;
    // A plugin naming its own actions has to be able to name them before
    // anything draws them, which is why the text arrives with the list.
    applyPluginMessages(installed.messages);
  } catch {
    installedPlugins.value = [];
    brokenPlugins.value = [];
  }
}

const RETRY_DELAY_MS = 1200;
let retryTimer: ReturnType<typeof setTimeout> | undefined;

async function refreshAll(): Promise<void> {
  loading.value = true;
  await Promise.all([
    refreshState(),
    refreshView(),
    refreshProfiles(),
    refreshPlugins(),
    refreshDevices(),
  ]);
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

/** The deck a request is about, as request parameters. */
function deckParam(): Record<string, unknown> {
  return selectedDeckId.value ? { deckId: selectedDeckId.value } : {};
}

/** Whether an event about `deckId` concerns the deck being shown. */
function concernsShownDeck(payload: unknown): boolean {
  const deckId = (payload as { deckId?: string } | undefined)?.deckId;
  if (deckId === undefined) return true;

  const shown = selectedDeckId.value ?? state.value?.activeDeckId;
  return shown === undefined || shown === deckId;
}

function markPressed(key: number, pressed: boolean): void {
  const next = new Set(pressedKeys.value);
  if (pressed) next.add(key);
  else next.delete(key);
  pressedKeys.value = next;
}

async function refreshDevices(): Promise<void> {
  try {
    const result = await client.call<{
      devices: { id: string; name: string; approvedAt?: string; online?: boolean }[];
      pending: { id: string; name: string; code: string; address?: string }[];
    }>('listDevices');

    devices.value = result.devices;
    pendingDevices.value = result.pending;
  } catch {
    // A daemon that predates device approval simply has no such method.
    devices.value = [];
    pendingDevices.value = [];
  }
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
  client.on('locationChanged', (payload) => {
    // State always: the deck list shows where every deck is. The view only
    // when it is this deck's, or the window would repaint with another deck's
    // page.
    void refreshState();
    if (concernsShownDeck(payload)) void refreshView();
  });
  // Follows the repaint itself rather than guessing from what might have
  // caused it: a button state can change with no variable involved at all.
  client.on('viewChanged', (payload) => {
    if (concernsShownDeck(payload)) void refreshView();
  });
  client.on('variablesChanged', () => void Promise.all([refreshState(), refreshView()]));
  client.on('profilesChanged', () => void Promise.all([refreshProfiles(), refreshProfile()]));
  /*
   * A signal, not a payload. It used to carry the lists, and when it stopped
   * carrying them this handler kept reading from nothing — it threw, silently,
   * and the window never learnt that a device had been approved or refused.
   * Asking for the list is one round trip and cannot rot the same way.
   */
  client.on('devicesChanged', () => void refreshDevices());
  client.on('actionError', (payload) => {
    lastError.value = (payload as { message?: string })?.message;
  });

  /*
   * Filtered by deck: with two panels running, a press on the other one would
   * otherwise light up the same key in a window showing this one.
   */
  client.on('keyDown', (payload) => {
    if (concernsShownDeck(payload)) markPressed((payload as { key: number }).key, true);
  });
  client.on('keyUp', (payload) => {
    if (concernsShownDeck(payload)) markPressed((payload as { key: number }).key, false);
  });
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
    installedPlugins,
    brokenPlugins,
    pressedKeys: readonly(pressedKeys),
    selectedDeckId,
    /** The deck being shown, resolved against what the daemon reports. */
    deck: computed(() => {
      const decks = state.value?.decks ?? [];
      const wanted = selectedDeckId.value ?? state.value?.activeDeckId;
      return decks.find((entry) => entry.id === wanted) ?? decks[0];
    }),
    selectDeck: async (deckId: string | undefined) => {
      selectedDeckId.value = deckId;
      pressedKeys.value = new Set();
      await refreshView();
    },
    renameDeck: async (deckId: string, name: string) => {
      await client.call('renameDeck', { deckId, name });
    },

    devices,
    pendingDevices,
    refreshDevices,
    approveDevice: async (deviceId: string) => {
      await client.call('approveDevice', { deviceId });
    },
    revokeDevice: async (deviceId: string) => {
      await client.call('revokeDevice', { deviceId });
    },
    setNetworkSettings: async (patch: Record<string, unknown>) => {
      await client.call('setNetworkSettings', patch);
      await refreshState();
    },
    lastError,
    loading: readonly(loading),

    transportKind: client.kind,
    refresh: refreshAll,
    pressKey: (key: number) => client.call('simulateKey', { key, ...deckParam() }),
    holdKey: (key: number) => client.call('simulateLongPress', { key, ...deckParam() }),
    doubleKey: (key: number) => client.call('simulateDoublePress', { key, ...deckParam() }),
    saveProfile: async (profile: ProfileDefinition) => {
      await client.call('saveProfile', { profile });
      // The save triggers a reload on the host, which announces new state;
      // refreshing here as well keeps the window responsive rather than
      // waiting a round trip for the event to come back.
      await refreshAll();
    },
    openFolder: (folderId: string) => client.call('openFolder', { folderId, ...deckParam() }),
    /** Shows one of EasyDeck's own folders in the system file manager. */
    openAppFolder: (folder: 'config' | 'profiles' | 'plugins' | 'icons') =>
      client.call('openAppFolder', { folder }),
    goToPage: (pageId: string) => client.call('goToPage', { pageId, ...deckParam() }),
    goUp: () => client.call('goUp', deckParam()),
    activateProfile: (id: string) => client.call('activateProfile', { id, ...deckParam() }),
    /* Fetched on demand rather than kept in state: the folder is the user's,
       it changes behind our back, and it only matters while a picker is open. */
    listIcons: async (): Promise<{ images: readonly LibraryImage[]; omitted: number }> => {
      const result = await client.call<{ icons: LibraryImage[]; omitted?: number }>('listIcons');
      return { images: result.icons, omitted: result.omitted ?? 0 };
    },
    setBrightness: (percent: number) => client.call('setBrightness', { percent }),
    setVariable: (name: string, value: string | number | boolean) =>
      client.call('setVariable', { name, value }),
    deleteVariable: (name: string) => client.call('deleteVariable', { name }),
  };
}

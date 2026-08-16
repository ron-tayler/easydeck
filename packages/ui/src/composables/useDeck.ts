import { computed, onScopeDispose, readonly, ref, shallowRef } from 'vue';
import type {
  AppFolder,
  DeckState,
  InstalledPluginInfo,
  InstalledPluginSummary,
  StorePlugin,
  KeyView,
  LibraryImage,
  LocalizedText,
  ParamDefinition,
  PluginManifest,
  ProfileDefinition,
  ProfileSummary,
  VariableValue,
} from '@easydeck/protocol';

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
/**
 * What every variable holds, kept apart from the rest of the state.
 *
 * Because this is the one part of the snapshot that moves on its own: the
 * hardware plugin publishes the processor, the memory and every adapter's
 * traffic a couple of times a second whether or not anything is showing them.
 * While these lived inside the state object, each of those ticks replaced the
 * whole snapshot — and with it the deck, the folder path and the page list —
 * so the header, the tree and all fifteen keys re-rendered, every key
 * re-measuring its label against the window. That is a hundred milliseconds of
 * nothing, once a second, for as long as the window is open.
 *
 * Here they are their own value, and a tick redraws what actually reads them.
 */
const variables = shallowRef<Readonly<Record<string, string | number | boolean>>>({});
const keys = shallowRef<readonly KeyView[]>([]);
const profiles = shallowRef<readonly ProfileSummary[]>([]);
/** The active profile in full — the left panel needs its whole folder tree. */
const profile = shallowRef<ProfileDefinition | undefined>();
const plugins = shallowRef<readonly PluginManifest[]>([]);
/** What the plugins folder holds, which may be pictures and text and no actions. */
const installedPlugins = shallowRef<readonly InstalledPluginInfo[]>([]);
/**
 * Where each plugin that holds a connection has got to.
 *
 * Kept beside the manifests rather than inside them: a manifest is what a
 * plugin *is* and never changes, while this changes whenever OBS is started
 * or closed, and merging the two would mean redrawing the palette every time
 * a socket blinks.
 */
const pluginStatuses = shallowRef<Readonly<Record<string, { status: string; message?: LocalizedText }>>>({});
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
    variables.value = state.value.variables ?? {};
    lastError.value = undefined;

    // A deck that is no longer there stops being the one being shown: the
    // stand-in deck goes away the moment a panel is plugged in, and a window
    // still pointing at it would be filtering events for a deck nobody has.
    if (selectedDeckId.value && !state.value.decks.some((deck) => deck.id === selectedDeckId.value)) {
      selectedDeckId.value = undefined;
    }
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
    const result = await client.call<{
      plugins: PluginManifest[];
      statuses?: Record<string, { status: string; message?: LocalizedText }>;
    }>('getPlugins');
    plugins.value = result.plugins;
    pluginStatuses.value = result.statuses ?? {};
  } catch {
    plugins.value = [];
    pluginStatuses.value = {};
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

/**
 * How long to keep asking a daemon that has not answered yet.
 *
 * Long enough that a machine still opening its panels is covered, short enough
 * that it stops: a daemon which is up and says there is no deck has *answered*,
 * and asking it forever would be waiting for news that already arrived.
 */
const RETRY_DELAY_MS = 1200;
const RETRY_LIMIT = 10;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let retries = 0;

async function refreshAll(): Promise<void> {
  // Only the first pass says "connecting". A retry that flipped this back on
  // made the status line alternate between "connecting" and "no deck" once a
  // second, for as long as the program was left open — a flicker that read as
  // something going wrong when nothing was.
  const first = state.value === undefined && retries === 0;
  if (first) loading.value = true;

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

  // The window is usually ready before the daemon is, so the first snapshot
  // legitimately fails. Rather than leaving "no deck" on screen until
  // something else happens to arrive, keep asking for a while — the 'state'
  // event does the same job, but neither can be relied on to be the one that
  // wins.
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = undefined;

  if (state.value) {
    retries = 0;
    return;
  }

  if (retries >= RETRY_LIMIT) return;
  retries += 1;
  retryTimer = setTimeout(() => void refreshAll(), RETRY_DELAY_MS);
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
    // A fresh connection gets a fresh budget of retries: whatever made the
    // last one give up is not this one's history.
    if (value) {
      retries = 0;
      void refreshAll();
    }
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
  /*
   * Follows the repaint itself rather than guessing from what might have
   * caused it: a button state can change with no variable involved at all.
   *
   * And takes the keys from the event instead of asking for them. Asking cost
   * a round trip and a rebuild of the whole page for every variable that
   * moved, to be told that one label had gained a digit — while the daemon had
   * just built exactly this and thrown it away.
   */
  client.on('viewChanged', (payload) => {
    if (!concernsShownDeck(payload)) return;

    const views = (payload as { views?: KeyView[] }).views;
    if (views) keys.value = views;
    else void refreshView();
  });
  /*
   * The variables themselves, and nothing about the picture.
   *
   * A variable that changes something on screen makes the deck repaint, and
   * that arrives above with the keys in it. This one is for what reads the
   * values directly — the variables window, and the state banner.
   *
   * Taken from the event rather than fetched. The snapshot is already in it,
   * so asking cost a round trip to be told what had just been said — and the
   * answer replaced the entire state, which re-rendered the whole window a
   * couple of times a second because a processor gauge moved by one percent.
   */
  client.on('variablesChanged', (payload) => {
    const values = payload as Record<string, string | number | boolean>;
    if (!values || typeof values !== 'object') return;

    /*
     * A name nobody has seen before is worth one snapshot: its declaration —
     * what type it is, which plugin owns it — travels with the state and not
     * with the values, and a picker that does not know about it cannot offer
     * it. Names appear when a plugin starts or a profile is loaded, so this is
     * rare; the values themselves move constantly and cost nothing here.
     */
    const known = variables.value;
    const isNew = Object.keys(values).some((name) => !(name in known));

    variables.value = values;
    if (isNew) void refreshState();
  });
  client.on('profilesChanged', () => void Promise.all([refreshProfiles(), refreshProfile()]));
  /*
   * A signal, not a payload. It used to carry the lists, and when it stopped
   * carrying them this handler kept reading from nothing — it threw, silently,
   * and the window never learnt that a device had been approved or refused.
   * Asking for the list is one round trip and cannot rot the same way.
   */
  client.on('devicesChanged', () => void refreshDevices());
  client.on('pluginStatusChanged', (payload) => {
    const event = payload as { pluginId?: string; status?: string; message?: LocalizedText };
    if (!event.pluginId || !event.status) return;

    pluginStatuses.value = {
      ...pluginStatuses.value,
      [event.pluginId]: {
        status: event.status,
        ...(event.message ? { message: event.message } : {}),
      },
    };
  });
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
    /** Read this rather than `state.variables`; see the note where it is declared. */
    variables,
    keys,
    profiles,
    profile,
    plugins,
    installedPlugins,
    pluginStatuses,
    exportProfile: (profileId: string) =>
      client.call<{ name: string; base64: string }>('exportProfile', { profileId }),
    importProfile: (archive: string) => client.call<{ id: string }>('importProfile', { archive }),
    pluginSettings: (pluginId: string) =>
      client.call<{
        values: Record<string, VariableValue>;
        filledSecrets: string[];
        status: string;
        message?: LocalizedText;
      }>('getPluginSettings', { pluginId }),
    savePluginSettings: (pluginId: string, values: Record<string, VariableValue>) =>
      client.call('savePluginSettings', { pluginId, values }),
    runPluginCommand: (pluginId: string, command: string) =>
      client.call('runPluginCommand', { pluginId, command }),
    actionOptions: (
      pluginId: string,
      source: string,
      params: Readonly<Record<string, unknown>> = {},
    ) =>
      client.call<{ options: { value: string; label?: LocalizedText }[] }>('getActionOptions', {
        pluginId,
        source,
        params,
      }),
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
    /**
     * Stores a profile and answers with where it landed.
     *
     * Which may not be where it came from: a profile is filed under its name,
     * so renaming one moves its folder. Anything holding the id has to take
     * the answer rather than the id it sent.
     */
    saveProfile: async (profile: ProfileDefinition): Promise<string> => {
      const { saved } = await client.call<{ saved: string }>('saveProfile', { profile });
      // The save triggers a reload on the host, which announces new state;
      // refreshing here as well keeps the window responsive rather than
      // waiting a round trip for the event to come back.
      await refreshAll();
      return saved;
    },
    openFolder: (folderId: string) => client.call('openFolder', { folderId, ...deckParam() }),
    /** Shows one of EasyDeck's own folders in the system file manager. */
    openAppFolder: (folder: AppFolder) =>
      client.call('openAppFolder', { folder }),
    goToPage: (pageId: string) => client.call('goToPage', { pageId, ...deckParam() }),
    goUp: () => client.call('goUp', deckParam()),
    activateProfile: (id: string) => client.call('activateProfile', { id, ...deckParam() }),

    /*
     * Button passwords, which travel one way.
     *
     * There is no call that reads one back, deliberately: the window is told
     * which references have something behind them and nothing else. A window
     * that cannot receive a password cannot leak one.
     */
    buttonSecrets: async (): Promise<readonly string[]> => {
      const result = await client.call<{ secrets: string[] }>('listButtonSecrets');
      return result.secrets ?? [];
    },
    saveButtonSecret: async (value: string, reference?: string): Promise<string> => {
      const result = await client.call<{ reference: string }>('saveButtonSecret', {
        value,
        ...(reference ? { reference } : {}),
      });
      return result.reference;
    },
    clearButtonSecret: (reference: string) => client.call('clearButtonSecret', { reference }),

    /**
     * What shape a field should take, for a parameter declaring `shapeFrom`.
     *
     * Answered by the daemon rather than by a plugin: the only case so far is
     * "which setting of that key's widget", which is a question about the
     * profile and the loaded manifests together.
     */
    loadParamShape: async (source: string, params: Readonly<Record<string, unknown>>) => {
      const result = await client.call<{ shape?: ParamDefinition }>('paramShape', {
        source,
        params,
      });
      return result.shape;
    },
    /**
     * One frame of a widget, for the editor's preview.
     *
     * Only the daemon can produce it: the plugin runs there, and a picture
     * that is different every second cannot be chosen from a description.
     */
    drawSurface: async (type: string, params: Readonly<Record<string, unknown>>) => {
      const result = await client.call<{ frame?: { source: string } }>('drawSurface', {
        type,
        params,
      });
      return result.frame?.source;
    },
    /* Fetched on demand rather than kept in state: the folder is the user's,
       it changes behind our back, and it only matters while a picker is open. */
    listIcons: async (): Promise<{ images: readonly LibraryImage[]; omitted: number }> => {
      const result = await client.call<{ icons: LibraryImage[]; omitted?: number }>('listIcons');
      return { images: result.icons, omitted: result.omitted ?? 0 };
    },
    /*
     * The store, fetched when it is opened rather than kept in state.
     *
     * A shelf nobody is looking at is a list of downloads waiting to go
     * stale — and unlike the profile or the plugins, nothing else in the
     * window needs to know what is on it.
     */
    listStorePlugins: async (refresh = false): Promise<readonly StorePlugin[]> => {
      const result = await client.call<{ plugins: StorePlugin[] }>('getStorePlugins', { refresh });
      return result.plugins;
    },
    storePlugin: async (pluginId: string): Promise<PluginManifest | undefined> => {
      const result = await client.call<{ manifest?: PluginManifest }>('getStorePlugin', {
        pluginId,
      });
      return result.manifest;
    },
    storeImage: async (pluginId: string, reference: string): Promise<string | undefined> => {
      const result = await client.call<{ image?: string }>('getStoreImage', {
        pluginId,
        reference,
      });
      return result.image;
    },
    installPlugin: (pluginId: string, replace = false) =>
      client.call('installPlugin', { pluginId, replace }),
    installPluginArchive: async (base64: string, replace = false): Promise<string> => {
      const result = await client.call<{ pluginId: string }>('installPluginArchive', {
        base64,
        replace,
      });
      return result.pluginId;
    },
    removePlugin: (pluginId: string) => client.call('removePlugin', { pluginId }),
    setBrightness: (percent: number) => client.call('setBrightness', { percent }),
    setVariable: (name: string, value: string | number | boolean) =>
      client.call('setVariable', { name, value }),
    deleteVariable: (name: string) => client.call('deleteVariable', { name }),
  };
}

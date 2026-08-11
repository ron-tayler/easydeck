<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import { useI18n } from 'vue-i18n';
import type {
  ButtonDefinition,
  FolderDefinition,
  LibraryImage,
  LocalizedText,
  ProfileDefinition,
  VariableDeclaration,
  VariableValue,
} from '@easydeck/core';
/*
 * From the engine's own entry point, not from core.
 *
 * Core is a Node package: importing a *value* from it drags the filesystem,
 * child_process and the HID stack into a browser bundle. Types are free, values
 * are not — which is why this file imports types from core and constants from
 * a module with no I/O in it.
 */
import { MAX_PAGES_PER_FOLDER, PROFILE_FORMAT_VERSION } from '@easydeck/engine/profile';

import ContextMenu from './components/ContextMenu.vue';
import type { MenuItem } from './components/ContextMenu.vue';
import DeckGrid from './components/DeckGrid.vue';
import FolderTree from './components/FolderTree.vue';
import PluginList from './components/PluginList.vue';
import PluginSettings from './components/PluginSettings.vue';
import SettingsDialog from './components/SettingsDialog.vue';
import { useDeck } from './composables/useDeck.js';
import ButtonEditor from './components/ButtonEditor.vue';
import PromptDialog from './components/PromptDialog.vue';
import VariablesDialog from './components/VariablesDialog.vue';
import ConfirmDialog from './components/ConfirmDialog.vue';
import { confirmAction, pendingConfirm, settleConfirm } from './composables/useConfirm.js';
import {
  addActionToKey,
  addPresetToKey,
  addFolder,
  addPage,
  createEmptyButton,
  findFolder,
  replaceButton,
  fromClipboard,
  ownerOfPage,
  pasteButton,
  removeFolder,
  removeKey,
  removePage,
  removeProfileVariable,
  renameFolder,
  renamePage,
  setButtonSpan,
  setProfileVariable,
  swapKeys,
  toClipboard,
} from './composables/useProfileEditor.js';

/** The engine's own cap, not a copy of it: two numbers would drift. */
const MAX_PAGES = MAX_PAGES_PER_FOLDER;

const { t } = useI18n();
const deck = useDeck();
const settingsOpen = ref(false);
const variablesOpen = ref(false);
const selectedKey = ref<number | undefined>();
const menu = ref<{ key: number; x: number; y: number } | undefined>();
/**
 * Shallow on purpose: a deep `ref` wraps whatever it holds in a reactive
 * proxy, and a proxy cannot be structuredClone'd — which is exactly what the
 * editor does to work on a copy. The button is replaced wholesale anyway, so
 * there is nothing for deep reactivity to earn here.
 */
const editing = shallowRef<ButtonDefinition | undefined>();
const folderMenu = ref<{ folderId: string; x: number; y: number } | undefined>();
const pageMenu = ref<{ pageId: string; x: number; y: number } | undefined>();

/** One prompt serves every rename and every new name; the action is a callback. */
const prompt = ref<{ title: string; value?: string; apply: (name: string) => void } | undefined>();

function ask(title: string, value: string | undefined, apply: (name: string) => void): void {
  prompt.value = { title, value, apply };
}

function onPromptConfirm(name: string): void {
  const pending = prompt.value;
  prompt.value = undefined;
  pending?.apply(name);
}

/** Every deck the daemon reports, in the order it found them. */
const decks = computed(() => deck.state.value?.decks ?? []);

/*
 * One request at a time, oldest first.
 *
 * Several devices knocking — three browser tabs left open on the deck page,
 * say, all reconnecting the moment the daemon starts — used to stack three
 * identical bars across the top of the window, each labelled with the same
 * platform name and telling them apart only by a six-digit code. Answering one
 * brings up the next, and the count says how many are left.
 */
const nextRequest = computed(() => deck.pendingDevices.value[0]);
const alsoWaiting = computed(() => Math.max(0, deck.pendingDevices.value.length - 1));
const shownDeckId = computed(() => deck.deck.value?.id ?? '');

function onSelectDeck(event: Event): void {
  void deck.selectDeck((event.target as HTMLSelectElement).value || undefined);
}

function renameShownDeck(): void {
  const current = deck.deck.value;
  if (!current) return;

  ask(t('decks.rename'), current.name, (name) => {
    void deck.renameDeck(current.id, name);
  });
}

const folderPath = computed(() => deck.deck.value?.folderPath ?? []);
const pages = computed(() => deck.deck.value?.pages ?? []);
const currentFolderId = computed(() => deck.deck.value?.location?.folderId);
/** Ancestors of the current folder, so the whole branch reads as active. */
const openIds = computed(() => new Set(folderPath.value.map((folder) => folder.id)));
/** The tree is rendered from the root's children plus the root itself. */
const rootFolders = computed(() => (deck.profile.value ? [deck.profile.value.root] : []));

const currentPageId = computed(() => deck.deck.value?.location?.pageId);

async function edit(change: (profile: ProfileDefinition) => ProfileDefinition): Promise<void> {
  const profile = deck.profile.value;
  const pageId = currentPageId.value;
  if (!profile || !pageId) return;

  try {
    await deck.saveProfile(change(profile));
  } catch (error) {
    deck.lastError.value = (error as Error).message;
  }
}

/**
 * A click selects; a click on the already selected key runs it.
 *
 * Selecting first means the destructive things — paste, delete — always act
 * on something the user has just pointed at, and running needs no modifier or
 * double click to discover.
 */
function onSelect(key: number): void {
  if (selectedKey.value === key) void deck.pressKey(key);
  else selectedKey.value = key;
}

function onMenu(payload: { key: number; x: number; y: number }): void {
  selectedKey.value = payload.key;
  menu.value = payload;
}

const menuItems = computed<MenuItem[]>(() => {
  const key = menu.value?.key;

  /*
   * Whether this key has a button of its own — not whether something is drawn
   * on it. A picture stretched across a region shows on every key it covers,
   * but belongs to the button at the region's top-left corner; the keys
   * underneath are free to hold their own buttons, or none at all.
   *
   * Asking the wrong question here offered "settings" for a covered key and
   * then had nothing to open, so the menu closed and nothing happened.
   */
  const occupied = key !== undefined && findButton(key) !== undefined;

  return [
    occupied
      ? { id: 'settings', label: t('menu.settings') }
      : { id: 'create', label: t('menu.create') },
    { id: 'press', label: t('menu.press'), disabled: !occupied, separated: true },
    { id: 'longPress', label: t('menu.longPress'), disabled: !occupied },
    { id: 'doublePress', label: t('menu.doublePress'), disabled: !occupied },
    { id: 'copy', label: t('menu.copy'), disabled: !occupied, separated: true },
    { id: 'paste', label: t('menu.paste') },
    { id: 'delete', label: t('menu.delete'), disabled: !occupied, danger: true, separated: true },
  ];
});

async function onMenuChoose(id: string): Promise<void> {
  const key = menu.value?.key;
  menu.value = undefined;
  if (key === undefined) return;

  switch (id) {
    case 'create': {
      // Created and opened in one move: a blank button is only interesting
      // once you start filling it in.
      const profile = deck.profile.value;
      if (!profile) return;
      editing.value = createEmptyButton(profile, key);
      void refreshUserIcons();
      void refreshSecrets();
      return;
    }
    case 'settings':
      editing.value = findButton(key);
      void refreshUserIcons();
      void refreshSecrets();
      return;
    case 'press':
      await deck.pressKey(key);
      return;
    case 'longPress':
      await deck.holdKey(key);
      return;
    case 'doublePress':
      await deck.doubleKey(key);
      return;
    case 'copy':
      await copyKey(key);
      return;
    case 'paste':
      await pasteFromClipboard(key);
      return;
    case 'delete':
      await deleteKey(key);
      return;
    default:
      return;
  }
}

/**
 * Clipboard access from the menu, as opposed to a Ctrl+C the browser hands us.
 *
 * The permission model differs — reading the clipboard is guarded where
 * writing usually is not — so a failure here is reported rather than
 * swallowed, with the keyboard route as the way out.
 */
async function copyKey(key: number): Promise<void> {
  const button = findButton(key);
  if (!button) return;

  try {
    await navigator.clipboard.writeText(toClipboard(button));
  } catch {
    deck.lastError.value = t('menu.clipboardBlocked');
  }
}

async function pasteFromClipboard(key: number): Promise<void> {
  let text: string;
  try {
    text = await navigator.clipboard.readText();
  } catch {
    deck.lastError.value = t('menu.clipboardBlocked');
    return;
  }

  const button = fromClipboard(text);
  if (!button) {
    deck.lastError.value = t('menu.nothingToPaste');
    return;
  }

  await edit((profile) => pasteButton(profile, currentPageId.value!, key, button));
}

// --- button editor -------------------------------------------------------

/**
 * Every folder and page of the profile, flattened.
 *
 * Navigation actions can target anywhere, not just the current scene, so the
 * pickers in the editor have to offer the whole profile.
 */
const allFolders = computed(() => {
  const out: { id: string; name: string }[] = [];
  const walk = (folder: FolderDefinition, prefix: string): void => {
    const name = prefix ? `${prefix} › ${folder.name}` : folder.name;
    out.push({ id: folder.id, name });
    for (const child of folder.folders ?? []) walk(child, name);
  };
  if (deck.profile.value) walk(deck.profile.value.root, '');
  return out;
});

const allPages = computed(() => {
  const out: { id: string; name: string }[] = [];
  const walk = (folder: FolderDefinition): void => {
    folder.pages.forEach((page, index) => {
      out.push({ id: page.id, name: `${folder.name} · ${page.name ?? index + 1}` });
    });
    for (const child of folder.folders ?? []) walk(child);
  };
  if (deck.profile.value) walk(deck.profile.value.root);
  return out;
});

/**
 * Buttons of the page being edited.
 *
 * Only these: set-button-state resolves its target on the current page, so
 * offering anything else would be offering something that cannot work.
 */
const pageButtons = computed(() => {
  const pageId = currentPageId.value;
  const profile = deck.profile.value;
  if (!pageId || !profile) return [];

  const pending: FolderDefinition[] = [profile.root];
  while (pending.length > 0) {
    const folder = pending.pop()!;
    const page = folder.pages.find((candidate) => candidate.id === pageId);
    if (page) {
      return page.buttons.map((button) => ({
        id: button.id,
        name: `${button.key + 1} · ${button.states[0]?.visual.label?.text ?? button.id}`,
        states: button.states.map((state) => state.id),
      }));
    }
    pending.push(...(folder.folders ?? []));
  }

  return [];
});

/**
 * The user's icon folder, refreshed each time the editor opens.
 *
 * Not held in the deck's state: it is a folder people edit outside the app, so
 * the only reading worth trusting is one taken when the picker is about to be
 * shown.
 */
const userIcons = shallowRef<readonly LibraryImage[]>([]);
/** Pictures the folder holds but the library had no room for. */
const omittedIcons = ref(0);

async function refreshUserIcons(): Promise<void> {
  try {
    const library = await deck.listIcons();
    userIcons.value = library.images;
    omittedIcons.value = library.omitted;
  } catch {
    // An unreadable folder costs the user the built-in set and nothing else.
    userIcons.value = [];
    omittedIcons.value = 0;
  }
}

async function onEditorSave(button: ButtonDefinition): Promise<void> {
  editing.value = undefined;
  selectedKey.value = button.key;
  await edit((profile) => replaceButton(profile, currentPageId.value!, button));
}

/** What each key on this page already spans, so the grid can clamp a drag. */
const pageSpans = computed(() => {
  const pageId = currentPageId.value;
  const profile = deck.profile.value;
  if (!pageId || !profile) return [];

  const pending: FolderDefinition[] = [profile.root];
  while (pending.length > 0) {
    const folder = pending.pop()!;
    const page = folder.pages.find((candidate) => candidate.id === pageId);
    if (page) {
      return page.buttons.map((button) => ({
        key: button.key,
        colSpan: button.colSpan,
        rowSpan: button.rowSpan,
      }));
    }
    pending.push(...(folder.folders ?? []));
  }

  return [];
});

async function onResize(payload: { key: number; colSpan: number; rowSpan: number }): Promise<void> {
  await edit((profile) =>
    setButtonSpan(profile, currentPageId.value!, payload.key, payload.colSpan, payload.rowSpan),
  );
}

// --- profiles ------------------------------------------------------------

/**
 * Creates an empty profile and switches to it.
 *
 * Laid out for the device that is actually connected: a profile authored for a
 * different grid is refused by the engine, and silently producing one nobody
 * can load would be a strange way to start.
 *
 * Where it is filed is not decided here. The empty id means "not stored yet",
 * and the daemon derives the folder from the name — one place making that
 * choice rather than a window and a daemon making it separately.
 */
async function createProfile(name: string): Promise<void> {
  // Laid out for the deck being shown: with several running they may differ in
  // size, and a profile authored for the wrong grid is refused by the engine.
  const device = deck.deck.value;
  if (!device) return;

  const trimmed = name.trim() || t('profiles.newTitle');

  const id = await deck.saveProfile({
    formatVersion: PROFILE_FORMAT_VERSION,
    id: '',
    name: trimmed,
    layout: { rows: device.rows, cols: device.cols },
    root: { id: 'root', name: trimmed, pages: [{ id: 'main', buttons: [] }] },
  });
  await deck.activateProfile(id);
}

/**
 * Renames the profile that is showing.
 *
 * Which renames its folder too, when the new name is free — the daemon decides
 * that and says where the profile ended up. Nothing here has to follow it: the
 * deck announces its new state, and the selector is drawn from that.
 */
function renameProfile(): void {
  const current = deck.profile.value;
  if (!current) return;

  ask(t('profiles.rename'), current.name, (name) => {
    const trimmed = name.trim();
    if (trimmed === '' || trimmed === current.name) return;
    void editProfile((profile) => ({ ...profile, name: trimmed }));
  });
}

// --- variables -----------------------------------------------------------

/**
 * Sets a variable now and stores it as the profile's starting value.
 *
 * The distinction between "what it holds" and "what it starts as" is real but
 * belongs to the engine, not to someone configuring a deck. Writing both
 * keeps them from disagreeing, which is the only way the difference would
 * ever become visible.
 */
async function onSetVariable(payload: { name: string; value: VariableValue }): Promise<void> {
  await deck.setVariable(payload.name, payload.value);

  // Stored as the starting value only where the profile owns the declaration.
  // A plugin's variable has no place in the document: the plugin decides what
  // it holds, and freezing a snapshot of that would be misleading.
  await editProfile((profile) => {
    const declared = (profile.variables ?? []).find(
      (variable) => variable.name === payload.name,
    );
    return declared
      ? setProfileVariable(profile, { ...declared, initial: payload.value })
      : profile;
  });
}

/** Adds a variable to the profile, or edits the declaration already there. */
async function onDeclareVariable(declaration: VariableDeclaration): Promise<void> {
  await editProfile((profile) => setProfileVariable(profile, declaration));
  if (declaration.initial !== undefined) {
    await deck.setVariable(declaration.name, declaration.initial);
  }
}

async function onRemoveVariable(name: string): Promise<void> {
  // Removed from the profile *and* from the running deck: reloading a profile
  // preserves live values, so dropping only the declaration would let the
  // variable come straight back.
  await deck.deleteVariable(name);
  await editProfile((profile) => removeProfileVariable(profile, name));
}

// --- folders and pages ---------------------------------------------------

function onFolderMenu(payload: { folderId: string; x: number; y: number }): void {
  folderMenu.value = payload;
}

const folderMenuItems = computed<MenuItem[]>(() => {
  const id = folderMenu.value?.folderId;
  const profile = deck.profile.value;
  const folder = id && profile ? findFolder(profile.root, id) : undefined;
  const isRoot = id === profile?.root.id;
  const full = (folder?.pages.length ?? 0) >= MAX_PAGES;

  return [
    { id: 'open', label: t('folders.open') },
    { id: 'addFolder', label: t('folders.addChild'), separated: true },
    {
      id: 'addPage',
      label: t('folders.addPage'),
      disabled: full,
      note: full ? t('folders.pageLimit', { max: MAX_PAGES }) : undefined,
    },
    { id: 'rename', label: t('folders.rename'), separated: true },
    {
      id: 'delete',
      label: t('folders.delete'),
      // The root has nowhere to fall back to, so it simply cannot go.
      disabled: isRoot,
      note: isRoot ? t('folders.rootKept') : undefined,
      danger: true,
    },
  ];
});

function onFolderMenuChoose(action: string): void {
  const id = folderMenu.value?.folderId;
  folderMenu.value = undefined;

  const profile = deck.profile.value;
  if (!id || !profile) return;
  const folder = findFolder(profile.root, id);

  switch (action) {
    case 'open':
      void deck.openFolder(id);
      return;
    case 'addFolder':
      ask(t('folders.addChild'), t('folders.newName'), (name) =>
        void editProfile((current) => addFolder(current, id, name)),
      );
      return;
    case 'addPage':
      void editProfile((current) => addPage(current, id, MAX_PAGES));
      return;
    case 'rename':
      ask(t('folders.rename'), folder?.name, (name) =>
        void editProfile((current) => renameFolder(current, id, name)),
      );
      return;
    case 'delete':
      void (async () => {
        const name = folder?.name ?? '';
        if (!(await confirmAction('folder', t('confirm.folder.title', { name }), t('confirm.folder.message')))) {
          return;
        }
        await editProfile((current) => removeFolder(current, id));
      })();
      return;
    default:
      return;
  }
}

function onPageMenu(pageId: string, event: MouseEvent): void {
  pageMenu.value = { pageId, x: event.clientX, y: event.clientY };
}

const pageMenuItems = computed<MenuItem[]>(() => {
  const pageId = pageMenu.value?.pageId;
  const profile = deck.profile.value;
  const owner = pageId && profile ? ownerOfPage(profile.root, pageId) : undefined;
  const last = (owner?.pages.length ?? 0) <= 1;

  return [
    { id: 'open', label: t('pages.open') },
    { id: 'rename', label: t('pages.rename'), separated: true },
    {
      id: 'delete',
      label: t('pages.delete'),
      // A scene with no pages cannot be entered at all.
      disabled: last,
      note: last ? t('pages.lastKept') : undefined,
      danger: true,
    },
  ];
});

function onPageMenuChoose(action: string): void {
  const pageId = pageMenu.value?.pageId;
  pageMenu.value = undefined;
  if (!pageId) return;

  const page = pages.value.find((candidate) => candidate.id === pageId);

  switch (action) {
    case 'open':
      void deck.goToPage(pageId);
      return;
    case 'rename':
      ask(t('pages.rename'), page?.name, (name) =>
        void editProfile((current) => renamePage(current, pageId, name)),
      );
      return;
    case 'delete':
      void (async () => {
        if (!(await confirmAction('page', t('confirm.page.title'), t('confirm.page.message')))) return;
        await editProfile((current) => removePage(current, pageId));
      })();
      return;
    default:
      return;
  }
}

function addFolderAtCurrent(): void {
  const parentId = currentFolderId.value ?? deck.profile.value?.root.id;
  if (!parentId) return;

  ask(t('folders.addChild'), t('folders.newName'), (name) =>
    void editProfile((current) => addFolder(current, parentId, name)),
  );
}

/** Saves a changed profile. Unlike `edit`, needs no current page. */
async function editProfile(change: (profile: ProfileDefinition) => ProfileDefinition): Promise<void> {
  const profile = deck.profile.value;
  if (!profile) return;

  try {
    await deck.saveProfile(change(profile));
  } catch (error) {
    deck.lastError.value = (error as Error).message;
  }
}

function onDropAction(payload: { key: number; actionType: string; label: string }): void {
  selectedKey.value = payload.key;
  void edit((profile) =>
    addActionToKey(profile, currentPageId.value!, payload.key, payload.actionType, payload.label),
  );
}

/**
 * Drops a plugin's ready-made key onto the grid.
 *
 * A preset is a whole button, so an occupied key is replaced rather than
 * added to — which is worth asking about, since what it replaces may be an
 * evening's work.
 */
// --- profiles as files ----------------------------------------------------

/**
 * Saves a profile as one file, through the browser's own download.
 *
 * Rather than a native save dialog: the same code then works in the desktop
 * app and in a browser talking to the daemon over the network, and neither
 * needs a second, binary channel for the one button that uses it.
 */
function onExportProfile(profileId: string): void {
  void (async () => {
    try {
      const archive = await deck.exportProfile(profileId);
      const bytes = Uint8Array.from(atob(archive.base64), (character) => character.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));

      const link = document.createElement('a');
      link.href = url;
      link.download = archive.name;
      link.click();

      // Freed on the next turn: revoking it straight away can beat the click.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      deck.lastError.value = (error as Error).message;
    }
  })();
}

/** Reads one back. Never over an existing profile — the daemon finds a free id. */
function onImportProfile(): void {
  const picker = document.createElement('input');
  picker.type = 'file';
  picker.accept = '.easydeck,.zip';

  picker.addEventListener('change', () => {
    const file = picker.files?.[0];
    if (!file) return;

    void (async () => {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = '';
        for (const byte of bytes) binary += String.fromCharCode(byte);

        await deck.importProfile(btoa(binary));
      } catch (error) {
        deck.lastError.value = (error as Error).message;
      }
    })();
  });

  picker.click();
}

// --- plugin settings ------------------------------------------------------

/**
 * The plugin whose settings are open, with what the daemon last told us.
 *
 * Loaded on opening rather than kept in sync: a settings window is short-lived
 * and a form that reloads under the cursor is worse than one that is a second
 * out of date. The status line is the exception — it follows the live event,
 * because watching the light go green is how somebody knows the password they
 * just typed was right.
 */
const configuring = ref<{
  pluginId: string;
  values: Record<string, VariableValue>;
  filledSecrets: string[];
  status: string;
  message?: LocalizedText;
  note?: string;
  busy?: boolean;
} | undefined>();

const configuringPlugin = computed(() =>
  deck.plugins.value.find((plugin) => plugin.id === configuring.value?.pluginId),
);

/** The live status wins over the one loaded with the form. */
const configuringStatus = computed(() => {
  const pluginId = configuring.value?.pluginId;
  if (!pluginId) return { status: 'off' as string, message: undefined as LocalizedText | undefined };

  const live = deck.pluginStatuses.value[pluginId];
  return {
    status: live?.status ?? configuring.value?.status ?? 'off',
    message: live?.message ?? configuring.value?.message,
  };
});

/**
 * The choices behind a parameter a plugin declared with `optionsFrom`.
 *
 * Answers with nothing rather than throwing when the plugin cannot say —
 * which is what turns the field into a box the name can be typed into,
 * instead of a dead end.
 */
async function loadActionOptions(
  pluginId: string,
  source: string,
  params: Readonly<Record<string, unknown>>,
): Promise<readonly { value: string; label?: LocalizedText }[]> {
  try {
    const result = await deck.actionOptions(pluginId, source, params);
    return result.options ?? [];
  } catch {
    return [];
  }
}

/**
 * Which button passwords are set, and how to set one.
 *
 * The list is refreshed when the editor opens and after every change, because
 * it is the only thing the window is ever told about a password: the value
 * goes out and never comes back. See PasswordInput.
 */
const filledSecrets = ref<readonly string[]>([]);

async function refreshSecrets(): Promise<void> {
  try {
    filledSecrets.value = await deck.buttonSecrets();
  } catch {
    filledSecrets.value = [];
  }
}

async function saveButtonSecret(value: string, reference?: string): Promise<string> {
  try {
    const stored = await deck.saveButtonSecret(value, reference);
    await refreshSecrets();
    return stored;
  } catch (error) {
    deck.lastError.value = (error as Error).message;
    return reference ?? '';
  }
}

async function clearButtonSecret(reference: string): Promise<void> {
  try {
    await deck.clearButtonSecret(reference);
  } catch (error) {
    deck.lastError.value = (error as Error).message;
  }
  await refreshSecrets();
}

function onConfigurePlugin(pluginId: string): void {
  void (async () => {
    try {
      const loaded = await deck.pluginSettings(pluginId);
      configuring.value = { pluginId, ...loaded, filledSecrets: loaded.filledSecrets ?? [] };
    } catch (error) {
      deck.lastError.value = (error as Error).message;
    }
  })();
}

/**
 * Saves and stays.
 *
 * The window is where somebody watches the lamp turn green after typing a
 * password, and a plugin reconnects on save by itself — closing on Save meant
 * typing a password, losing the window, and having no idea whether it worked.
 * What is reloaded afterwards is which secrets are now stored, so the
 * password box stops offering to remember one it already has.
 */
function onSavePluginSettings(values: Record<string, VariableValue>): void {
  const open = configuring.value;
  if (!open) return;

  void (async () => {
    configuring.value = { ...open, busy: true, note: undefined };
    try {
      await deck.savePluginSettings(open.pluginId, values);
      const reloaded = await deck.pluginSettings(open.pluginId);
      configuring.value = {
        pluginId: open.pluginId,
        ...reloaded,
        filledSecrets: reloaded.filledSecrets ?? [],
        note: t('plugins.saved'),
      };
    } catch (error) {
      configuring.value = { ...open, busy: false, note: (error as Error).message };
    }
  })();
}

function onPluginCommand(command: string): void {
  const open = configuring.value;
  if (!open) return;

  void (async () => {
    configuring.value = { ...open, busy: true, note: undefined };
    try {
      await deck.runPluginCommand(open.pluginId, command);
      // Re-read rather than trust what was loaded: a command exists to change
      // something, and the status line is the first place anybody looks to
      // see whether it did.
      const reloaded = await deck.pluginSettings(open.pluginId);
      configuring.value = {
        pluginId: open.pluginId,
        ...reloaded,
        filledSecrets: reloaded.filledSecrets ?? [],
        note: t('plugins.commandDone'),
      };
    } catch (error) {
      configuring.value = { ...open, busy: false, note: (error as Error).message };
    }
  })();
}

function onDropPreset(payload: { key: number; pluginId: string; name: string }): void {
  const plugin = deck.plugins.value.find((each) => each.id === payload.pluginId);
  const preset = plugin?.presets?.find((each) => each.name === payload.name);
  if (!preset) return;

  void (async () => {
    const occupied = deck.keys.value.some((view) => view.key === payload.key);
    if (occupied) {
      const replaced = await confirmAction(
        'preset',
        t('confirm.preset.title'),
        t('confirm.preset.message'),
        t('confirm.preset.replace'),
      );
      if (!replaced) return;
    }

    selectedKey.value = payload.key;
    await edit((profile) => addPresetToKey(profile, currentPageId.value!, payload.key, preset.button));
  })();
}

function onDropKey(payload: { from: number; to: number }): void {
  selectedKey.value = payload.to;

  const shown = deck.deck.value;
  void edit((profile) =>
    swapKeys(
      profile,
      currentPageId.value!,
      payload.from,
      payload.to,
      // The grid's own shape, so a stretched button landing near an edge is
      // trimmed to what fits rather than hanging off it.
      shown ? { rows: shown.rows, cols: shown.cols } : undefined,
    ),
  );
}

/**
 * Copy and paste ride on the document's own clipboard events rather than a
 * global shortcut.
 *
 * That is what makes them safe without a single check for "is another window
 * focused": the browser only fires these when this document has focus, so a
 * stray Ctrl+V in another program cannot reach the deck. What is left to
 * guard is a key actually being selected, and the caret not sitting in a text
 * field, where copying text has to keep working.
 */
function editingText(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  const tag = element?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || element?.isContentEditable === true;
}

function onCopy(event: ClipboardEvent): void {
  if (settingsOpen.value || editingText(event.target) || selectedKey.value === undefined) return;

  const page = deck.profile.value?.root && currentPageId.value;
  if (!page) return;

  const button = findButton(selectedKey.value);
  if (!button) return;

  event.clipboardData?.setData('text/plain', toClipboard(button));
  event.preventDefault();
}

function onPaste(event: ClipboardEvent): void {
  if (settingsOpen.value || editingText(event.target) || selectedKey.value === undefined) return;

  const text = event.clipboardData?.getData('text/plain');
  if (!text) return;

  const button = fromClipboard(text);
  if (!button) return; // Not one of ours: leave the paste to whoever wants it.

  event.preventDefault();
  const key = selectedKey.value;
  void edit((profile) => pasteButton(profile, currentPageId.value!, key, button));
}

function onKeydown(event: KeyboardEvent): void {
  if (settingsOpen.value || editingText(event.target) || selectedKey.value === undefined) return;
  if (event.key !== 'Delete') return;

  const key = selectedKey.value;
  event.preventDefault();
  void deleteKey(key);
}

/** One path for both routes to it: the Delete key and the context menu. */
async function deleteKey(key: number): Promise<void> {
  if (!(await confirmAction('button', t('confirm.button.title'), t('confirm.button.message')))) {
    return;
  }
  await edit((profile) => removeKey(profile, currentPageId.value!, key));
}

/** Looks the button up in the profile, which is where its full definition is. */
function findButton(key: number): ButtonDefinition | undefined {
  const pageId = currentPageId.value;
  const profile = deck.profile.value;
  if (!pageId || !profile) return undefined;

  // Walked with an explicit stack rather than recursion: a folder tree is
  // small, and this keeps the return type obvious.
  const pending: FolderDefinition[] = [profile.root];
  while (pending.length > 0) {
    const folder = pending.pop()!;
    const page = folder.pages.find((candidate) => candidate.id === pageId);
    if (page) return page.buttons.find((button) => button.key === key);
    pending.push(...(folder.folders ?? []));
  }

  return undefined;
}

onMounted(() => {
  document.addEventListener('copy', onCopy);
  document.addEventListener('paste', onPaste);
  document.addEventListener('keydown', onKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener('copy', onCopy);
  document.removeEventListener('paste', onPaste);
  document.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <div class="app">
    <header>
      <span class="brand">{{ t('app.title') }}</span>

      <!--
        One deck and there is nothing to choose, so the picker only appears
        when it would earn its place. With several, choosing one is what makes
        every other control in the window unambiguous.
      -->
      <label v-if="decks.length > 1" class="decks">
        <span class="muted">{{ t('decks.label') }}</span>
        <select :value="shownDeckId" @change="onSelectDeck">
          <option v-for="entry in decks" :key="entry.id" :value="entry.id">
            {{ entry.name }}{{ entry.online ? '' : ` — ${t('decks.offline')}` }}
          </option>
        </select>
      </label>

      <div class="status">
        <template v-if="deck.deck.value">
          <span class="dot" :class="deck.deck.value.online ? 'ok' : 'bad'" />
          <span>{{ deck.deck.value.name }}</span>
          <button
            type="button"
            class="rename"
            :title="t('decks.rename')"
            @click="renameShownDeck"
          >
            ✎
          </button>
        </template>
        <template v-else-if="deck.loading.value">
          <span class="dot" />
          <span class="muted">{{ t('status.connecting') }}</span>
        </template>
        <template v-else>
          <span class="dot bad" />
          <span class="muted">{{ t('status.noDeck') }}</span>
        </template>
      </div>
    </header>

    <!--
      Requests to join sit above everything, and deliberately: a device is
      waiting on someone to look, and a panel buried in settings would leave it
      waiting until the request expired.
    -->
    <div v-if="nextRequest" class="pending">
      <span>
        <strong>{{ nextRequest.name }}</strong>
        <span v-if="nextRequest.address" class="muted"> · {{ nextRequest.address }}</span>
      </span>
      <code class="code">{{ nextRequest.code }}</code>
      <span class="muted">{{ t('devices.match') }}</span>
      <span v-if="alsoWaiting > 0" class="muted">
        {{ t('devices.alsoWaiting', { count: alsoWaiting }) }}
      </span>
      <button type="button" @click="void deck.approveDevice(nextRequest.id)">
        {{ t('devices.approve') }}
      </button>
      <button type="button" class="ghost" @click="void deck.revokeDevice(nextRequest.id)">
        {{ t('devices.reject') }}
      </button>
    </div>

    <p v-if="deck.lastError.value" class="error">
      {{ deck.lastError.value }}
      <button type="button" @click="deck.lastError.value = undefined">
        {{ t('errors.dismiss') }}
      </button>
    </p>

    <div class="panes">
      <aside class="left">
        <div class="toolbar">
          <button
            type="button"
            class="icon"
            :title="t('settings.open')"
            :aria-label="t('settings.open')"
            @click="settingsOpen = true"
          >
            ⚙
          </button>

          <button
            type="button"
            class="icon"
            :title="t('folders.addChild')"
            :aria-label="t('folders.addChild')"
            :disabled="!deck.profile.value"
            @click="addFolderAtCurrent"
          >
            ＋
          </button>

          <button
            type="button"
            class="icon wide"
            :title="t('variables.title')"
            :aria-label="t('variables.title')"
            :disabled="!deck.profile.value"
            @click="variablesOpen = true"
          >
            {var}
          </button>
        </div>

        <div class="scroll">
          <h2>{{ t('folders.title') }}</h2>
          <FolderTree
            :folders="rootFolders"
            :current-folder-id="currentFolderId"
            :open-ids="openIds"
            @open="deck.openFolder"
            @menu="onFolderMenu"
          />
          <p v-if="rootFolders.length === 0" class="muted empty">{{ t('folders.none') }}</p>
        </div>
      </aside>

      <main>
        <!--
          No delete button here, deliberately. A profile holds every folder,
          page and button someone has built; removing one is not an edit but a
          loss, and it does not belong one slip away from the selector used to
          switch between them.
        -->
        <div class="profiles">
          <label class="sr-only" for="profile-select">{{ t('profiles.label') }}</label>
          <select
            id="profile-select"
            :value="deck.deck.value?.profileId ?? ''"
            :disabled="deck.profiles.value.length === 0"
            @change="deck.activateProfile(($event.target as HTMLSelectElement).value)"
          >
            <option v-for="item in deck.profiles.value" :key="item.id" :value="item.id">
              {{ item.name }}
            </option>
          </select>

          <button
            type="button"
            class="icon rename"
            :title="t('profiles.rename')"
            :aria-label="t('profiles.rename')"
            :disabled="!deck.profile.value"
            @click="renameProfile"
          >
            ✎
          </button>

          <button
            type="button"
            class="icon"
            :title="t('profiles.add')"
            :aria-label="t('profiles.add')"
            :disabled="!deck.state.value"
            @click="ask(t('profiles.newTitle'), '', createProfile)"
          >
            ＋
          </button>
        </div>

        <DeckGrid
          :deck="deck.deck.value"
          :keys="deck.keys.value"
          :pressed-keys="deck.pressedKeys.value"
          :selected-key="selectedKey"
          :spans="pageSpans"
          @resize="onResize"
          @select="onSelect"
          @menu="onMenu"
          @drop-action="onDropAction"
          @drop-preset="onDropPreset"
          @drop-key="onDropKey"
        />

        <!-- Numbers only, no arrows: a scene has at most sixteen pages, so
             they all fit and paging through them would be pointless. -->
        <div v-if="deck.deck.value" class="pages">
          <button
            v-for="(page, index) in pages"
            :key="page.id"
            type="button"
            class="page"
            :class="{ current: page.id === deck.deck.value?.location?.pageId }"
            :title="page.name"
            @click="deck.goToPage(page.id)"
            @contextmenu.prevent="onPageMenu(page.id, $event)"
          >
            {{ index + 1 }}
          </button>

          <button
            type="button"
            class="page add"
            :title="t('folders.addPage')"
            :disabled="pages.length >= MAX_PAGES"
            @click="currentFolderId && editProfile((p) => addPage(p, currentFolderId!, MAX_PAGES))"
          >
            ＋
          </button>
        </div>
      </main>

      <aside class="right">
        <h2>{{ t('plugins.title') }}</h2>
        <PluginList
          :plugins="deck.plugins.value"
          presets
          :variables="deck.state.value?.variables ?? {}"
          :statuses="deck.pluginStatuses.value"
        />
      </aside>
    </div>

    <ContextMenu
      v-if="menu"
      :x="menu.x"
      :y="menu.y"
      :items="menuItems"
      @choose="onMenuChoose"
      @close="menu = undefined"
    />

    <ContextMenu
      v-if="folderMenu"
      :x="folderMenu.x"
      :y="folderMenu.y"
      :items="folderMenuItems"
      @choose="onFolderMenuChoose"
      @close="folderMenu = undefined"
    />

    <ContextMenu
      v-if="pageMenu"
      :x="pageMenu.x"
      :y="pageMenu.y"
      :items="pageMenuItems"
      @choose="onPageMenuChoose"
      @close="pageMenu = undefined"
    />

    <ButtonEditor
      v-if="editing"
      :button="editing"
      :plugins="deck.plugins.value"
      :variables="deck.state.value?.variables ?? {}"
      :folders="allFolders"
      :pages="allPages"
      :buttons="pageButtons"
      :declarations="deck.state.value?.variableDeclarations ?? []"
      :user-icons="userIcons"
      :omitted-icons="omittedIcons"
      :plugin-statuses="deck.pluginStatuses.value"
      :load-options="loadActionOptions"
      :filled-secrets="filledSecrets"
      :save-secret="saveButtonSecret"
      :clear-secret="clearButtonSecret"
      @save="onEditorSave"
      @cancel="editing = undefined"
      @configure-plugin="onConfigurePlugin"
    />

    <VariablesDialog
      v-if="variablesOpen"
      :variables="deck.state.value?.variables ?? {}"
      :declarations="deck.state.value?.variableDeclarations ?? []"
      @declare="onDeclareVariable"
      @set="onSetVariable"
      @remove="onRemoveVariable"
      @close="variablesOpen = false"
    />

    <PluginSettings
      v-if="configuring && configuringPlugin"
      :plugin="configuringPlugin"
      :values="configuring.values"
      :filled-secrets="configuring.filledSecrets"
      :status="configuringStatus.status"
      :message="configuringStatus.message"
      :note="configuring.note"
      :busy="configuring.busy"
      @save="onSavePluginSettings"
      @command="onPluginCommand"
      @close="configuring = undefined"
    />

    <ConfirmDialog
      v-if="pendingConfirm"
      :title="pendingConfirm.title"
      :message="pendingConfirm.message"
      :confirm-label="pendingConfirm.confirmLabel"
      @confirm="settleConfirm(true, $event)"
      @cancel="settleConfirm(false)"
    />

    <PromptDialog
      v-if="prompt"
      :title="prompt.title"
      :value="prompt.value"
      @confirm="onPromptConfirm"
      @cancel="prompt = undefined"
    />

    <SettingsDialog
      v-if="settingsOpen"
      :state="deck.state.value"
      :plugins="deck.plugins.value"
      :transport-kind="deck.transportKind"
      :devices="deck.devices.value"
      :pending-devices="deck.pendingDevices.value"
      :installed-plugins="deck.installedPlugins.value"
      :broken-plugins="deck.brokenPlugins.value"
      :plugin-statuses="deck.pluginStatuses.value"
      :profiles="deck.profiles.value"
      :active-profile-id="deck.deck.value?.profileId"
      :user-icons="userIcons"
      :omitted-icons="omittedIcons"
      @configure-plugin="onConfigurePlugin"
      @export-profile="onExportProfile"
      @import-profile="onImportProfile"
      @close="settingsOpen = false"
      @network="void deck.setNetworkSettings($event)"
      @approve-device="void deck.approveDevice($event)"
      @revoke-device="void deck.revokeDevice($event)"
      @open-folder="void deck.openAppFolder($event)"
    />
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.pending {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 8px 16px 0;
  padding: 10px 14px;
  border: 1px solid var(--accent);
  border-radius: 10px;
  background: var(--accent-soft);
}

.pending .code {
  font-size: 20px;
  letter-spacing: 0.12em;
  font-variant-numeric: tabular-nums;
}

.decks {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  font-size: 13px;
}

.decks select {
  max-width: 200px;
}

/* Quiet until hovered: renaming a deck is rare, and the name is the point. */
.rename {
  border: none;
  background: none;
  color: var(--muted);
  cursor: pointer;
  padding: 0 4px;
}

.rename:hover {
  color: var(--text);
}

header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 9px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--surface-1);
  flex: none;
}

.brand {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.status {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-muted);
  flex: none;
}

.dot.ok { background: var(--ok); }
.dot.bad { background: var(--danger); }

.panes {
  flex: 1;
  min-height: 0;
  display: grid;
  /* The palette holds three 60px tiles across; anything wider would be spent
     on the squares rather than on the deck, which is what people look at. */
  /* Fixed, so the column never shifts as the palette's contents change;
     the tiles take their size from what is left after padding. */
  grid-template-columns: 220px minmax(0, 1fr) 320px;
}

.left,
.right {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--surface-1);
}

.left { border-right: 1px solid var(--border); }
.right { border-left: 1px solid var(--border); }

.toolbar {
  display: flex;
  gap: 6px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
}

.icon {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  padding: 0;
  font-size: 15px;
  line-height: 1;
}

/* Wide enough for a word rather than a glyph, and monospaced so the braces
   read as syntax — which is exactly what they are in a key's label. */
.icon.wide {
  width: auto;
  padding: 0 9px;
  font-family: ui-monospace, monospace;
  font-size: 12px;
}

.left .scroll {
  overflow-y: auto;
  padding: 12px;
}

h2 {
  margin: 0 0 8px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
}

.right h2 { padding: 12px 12px 8px; margin: 0; }

main {
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 24px;
}

/* As wide as the keypad, so the selector reads as belonging to it rather
   than floating above the column. */
.profiles {
  display: flex;
  gap: 8px;
  width: 100%;
  max-width: 640px;
}

.profiles select { flex: 1; min-width: 0; }
.profiles .icon { flex: none; width: 30px; padding: 4px 0; }

.pages {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: center;
  font-size: 12px;
}

.page { min-width: 28px; padding: 3px 8px; }
.page.current { border-color: var(--accent); color: var(--accent); }
.page.add { color: var(--text-muted); }

.empty { font-size: 12px; margin: 6px 0 0; }

.error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 0;
  padding: 8px 16px;
  background: color-mix(in srgb, var(--danger) 14%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--danger) 35%, transparent);
  font-size: 13px;
  flex: none;
}
</style>

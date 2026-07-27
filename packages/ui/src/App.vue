<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ButtonDefinition, FolderDefinition, ProfileDefinition } from '@easydeck/core';

import ContextMenu from './components/ContextMenu.vue';
import type { MenuItem } from './components/ContextMenu.vue';
import DeckGrid from './components/DeckGrid.vue';
import FolderTree from './components/FolderTree.vue';
import PluginList from './components/PluginList.vue';
import SettingsDialog from './components/SettingsDialog.vue';
import { useDeck } from './composables/useDeck.js';
import PromptDialog from './components/PromptDialog.vue';
import VariablesDialog from './components/VariablesDialog.vue';
import {
  addActionToKey,
  addFolder,
  addPage,
  findFolder,
  fromClipboard,
  ownerOfPage,
  pasteButton,
  removeFolder,
  removeKey,
  removePage,
  removeProfileVariable,
  renameFolder,
  renamePage,
  setProfileVariable,
  swapKeys,
  toClipboard,
} from './composables/useProfileEditor.js';

/** Mirrors the engine's cap; a scene with more pages stops being navigable. */
const MAX_PAGES = 16;

const { t } = useI18n();
const deck = useDeck();
const settingsOpen = ref(false);
const variablesOpen = ref(false);
const selectedKey = ref<number | undefined>();
const menu = ref<{ key: number; x: number; y: number } | undefined>();
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

const folderPath = computed(() => deck.state.value?.folderPath ?? []);
const pages = computed(() => deck.state.value?.pages ?? []);
const currentFolderId = computed(() => deck.state.value?.location?.folderId);
/** Ancestors of the current folder, so the whole branch reads as active. */
const openIds = computed(() => new Set(folderPath.value.map((folder) => folder.id)));
/** The tree is rendered from the root's children plus the root itself. */
const rootFolders = computed(() => (deck.profile.value ? [deck.profile.value.root] : []));

const currentPageId = computed(() => deck.state.value?.location?.pageId);

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
  const occupied = key !== undefined && deck.keys.value.some((view) => view.key === key);

  return [
    { id: 'settings', label: t('menu.settings'), disabled: true, note: t('settings.soon') },
    { id: 'press', label: t('menu.press'), disabled: !occupied, separated: true },
    { id: 'longPress', label: t('menu.longPress'), disabled: !occupied },
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
    case 'press':
      await deck.pressKey(key);
      return;
    case 'longPress':
      await deck.holdKey(key);
      return;
    case 'copy':
      await copyKey(key);
      return;
    case 'paste':
      await pasteFromClipboard(key);
      return;
    case 'delete':
      await edit((profile) => removeKey(profile, currentPageId.value!, key));
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

// --- variables -----------------------------------------------------------

/**
 * Sets a variable now and stores it as the profile's starting value.
 *
 * The distinction between "what it holds" and "what it starts as" is real but
 * belongs to the engine, not to someone configuring a deck. Writing both
 * keeps them from disagreeing, which is the only way the difference would
 * ever become visible.
 */
async function onSetVariable(payload: { name: string; value: string }): Promise<void> {
  const numeric = Number(payload.value);
  const value: string | number | boolean =
    payload.value.trim() !== '' && Number.isFinite(numeric) ? numeric : payload.value;

  await deck.setVariable(payload.name, value);
  await editProfile((profile) => setProfileVariable(profile, payload.name, value));
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
      void editProfile((current) => removeFolder(current, id));
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
      void editProfile((current) => removePage(current, pageId));
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

function onDropKey(payload: { from: number; to: number }): void {
  selectedKey.value = payload.to;
  void edit((profile) => swapKeys(profile, currentPageId.value!, payload.from, payload.to));
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
  void edit((profile) => removeKey(profile, currentPageId.value!, key));
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

      <div class="status">
        <template v-if="deck.state.value">
          <span class="dot ok" />
          <span>{{ deck.state.value.device.model }}</span>
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
        <DeckGrid
          :state="deck.state.value"
          :keys="deck.keys.value"
          :pressed-keys="deck.pressedKeys.value"
          :selected-key="selectedKey"
          @select="onSelect"
          @menu="onMenu"
          @drop-action="onDropAction"
          @drop-key="onDropKey"
        />

        <p class="hint">{{ t('deck.editHint') }}</p>

        <!-- Numbers only, no arrows: a scene has at most sixteen pages, so
             they all fit and paging through them would be pointless. -->
        <div v-if="deck.state.value" class="pages">
          <button
            v-for="(page, index) in pages"
            :key="page.id"
            type="button"
            class="page"
            :class="{ current: page.id === deck.state.value?.location?.pageId }"
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
        <PluginList :plugins="deck.plugins.value" />
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

    <VariablesDialog
      v-if="variablesOpen"
      :variables="deck.state.value?.variables ?? {}"
      @set="onSetVariable"
      @remove="onRemoveVariable"
      @close="variablesOpen = false"
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
      @close="settingsOpen = false"
    />
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
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
  grid-template-columns: 220px minmax(0, 1fr) 260px;
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

.hint { color: var(--text-muted); font-size: 12px; margin: 0; text-align: center; max-width: 640px; }

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

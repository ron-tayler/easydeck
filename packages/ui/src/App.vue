<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import DeckGrid from './components/DeckGrid.vue';
import FolderTree from './components/FolderTree.vue';
import PluginList from './components/PluginList.vue';
import SettingsDialog from './components/SettingsDialog.vue';
import { useDeck } from './composables/useDeck.js';

const { t } = useI18n();
const deck = useDeck();
const settingsOpen = ref(false);

const folderPath = computed(() => deck.state.value?.folderPath ?? []);
const pages = computed(() => deck.state.value?.pages ?? []);
const currentFolderId = computed(() => deck.state.value?.location?.folderId);
/** Ancestors of the current folder, so the whole branch reads as active. */
const openIds = computed(() => new Set(folderPath.value.map((folder) => folder.id)));
/** The tree is rendered from the root's children plus the root itself. */
const rootFolders = computed(() => (deck.profile.value ? [deck.profile.value.root] : []));
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
        </div>

        <div class="scroll">
          <h2>{{ t('folders.title') }}</h2>
          <FolderTree
            :folders="rootFolders"
            :current-folder-id="currentFolderId"
            :open-ids="openIds"
            @open="deck.openFolder"
          />
          <p v-if="rootFolders.length === 0" class="muted empty">{{ t('folders.none') }}</p>
        </div>
      </aside>

      <main>
        <DeckGrid
          :state="deck.state.value"
          :keys="deck.keys.value"
          :pressed-keys="deck.pressedKeys.value"
          @press="deck.pressKey"
        />

        <!-- Numbers only, no arrows: a scene has at most sixteen pages, so
             they all fit and paging through them would be pointless. -->
        <div v-if="pages.length > 1" class="pages">
          <button
            v-for="(page, index) in pages"
            :key="page.id"
            type="button"
            class="page"
            :class="{ current: page.id === deck.state.value?.location?.pageId }"
            :title="page.name"
            @click="deck.goToPage(page.id)"
          >
            {{ index + 1 }}
          </button>
        </div>
      </main>

      <aside class="right">
        <h2>{{ t('plugins.title') }}</h2>
        <PluginList :plugins="deck.plugins.value" />
      </aside>
    </div>

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

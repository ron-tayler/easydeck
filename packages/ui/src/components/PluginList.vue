<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ActionDefinition, LocalizedText, PluginManifest } from '@easydeck/core';

const props = defineProps<{ plugins: readonly PluginManifest[] }>();

const { t, locale } = useI18n();
const search = ref('');

const STORAGE_KEY = 'easydeck.collapsedPlugins';
/** Collapsed rather than expanded ids, so a new plugin shows up open. */
const collapsed = ref<Set<string>>(new Set(readCollapsed()));

function readCollapsed(): string[] {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(stored) ? stored.map(String) : [];
  } catch {
    return [];
  }
}

function toggle(pluginId: string): void {
  const next = new Set(collapsed.value);
  if (!next.delete(pluginId)) next.add(pluginId);

  collapsed.value = next;
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
}

const searching = computed(() => search.value.trim().length > 0);

/** Searching overrides the accordion: a hidden match is a match nobody finds. */
const isOpen = (pluginId: string): boolean => searching.value || !collapsed.value.has(pluginId);

/**
 * Plugins supply their own translations, so the host never has to know what
 * an action does — it just picks the best string it was given.
 */
const say = (text: LocalizedText | undefined): string =>
  text === undefined ? '' : (text[locale.value] ?? text.en);

interface Group {
  readonly plugin: PluginManifest;
  readonly actions: readonly ActionDefinition[];
}

const groups = computed<Group[]>(() => {
  const query = search.value.trim().toLowerCase();

  return props.plugins
    .map((plugin) => ({
      plugin,
      actions: plugin.actions.filter((action) => {
        if (query.length === 0) return true;
        return (
          say(action.label).toLowerCase().includes(query) ||
          say(plugin.name).toLowerCase().includes(query) ||
          action.type.includes(query)
        );
      }),
    }))
    .filter((group) => group.actions.length > 0);
});
</script>

<template>
  <div class="plugins">
    <input
      v-model="search"
      type="text"
      class="search"
      :placeholder="t('plugins.search')"
      :aria-label="t('plugins.search')"
    />

    <div class="scroll">
      <section v-for="group in groups" :key="group.plugin.id" class="group">
        <button
          type="button"
          class="head"
          :aria-expanded="isOpen(group.plugin.id)"
          @click="toggle(group.plugin.id)"
        >
          <span class="chevron" :class="{ open: isOpen(group.plugin.id) }">›</span>
          <span class="name">{{ say(group.plugin.name) }}</span>
          <span class="count">{{ group.actions.length }}</span>
        </button>

        <ul v-show="isOpen(group.plugin.id)">
          <li v-for="action in group.actions" :key="action.type">
            <!-- Draggable onto a key in the next step; the title already
                 carries the full type so a profile author can find it. -->
            <div class="action" :title="action.type">
              <span class="label">{{ say(action.label) }}</span>
              <span v-if="action.description" class="desc">{{ say(action.description) }}</span>
            </div>
          </li>
        </ul>
      </section>

      <p v-if="groups.length === 0" class="muted empty">{{ t('plugins.nothing') }}</p>
    </div>
  </div>
</template>

<style scoped>
.plugins {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.search {
  margin: 0 12px 10px;
}

.scroll {
  overflow-y: auto;
  padding: 0 12px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.head {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 7px;
  background: none;
  border: none;
  border-radius: 7px;
  padding: 6px 6px;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
}

.head:hover {
  background: var(--surface-2);
}

.chevron {
  display: inline-block;
  transition: transform 120ms ease;
  font-size: 13px;
  line-height: 1;
}

.chevron.open {
  transform: rotate(90deg);
}

.name {
  flex: 1;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.count {
  font-size: 10px;
  letter-spacing: 0;
  background: var(--surface-2);
  border-radius: 999px;
  padding: 1px 6px;
}

ul {
  list-style: none;
  margin: 2px 0 6px;
  padding: 0 0 0 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.action {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 7px 9px;
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: grab;
}

.action:hover {
  border-color: var(--accent);
}

.label {
  font-size: 13px;
}

.desc {
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.3;
}

.empty {
  font-size: 13px;
  margin: 8px 0 0;
}
</style>

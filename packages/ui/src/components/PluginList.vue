<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type {
  ActionDefinition,
  ButtonPreset,
  LocalizedText,
  PluginManifest,
  VariableValue,
} from '@easydeck/core';
import { renderTemplate } from '@easydeck/engine/template';

import { actionIconPath, isDrawnIcon } from '../icons/action-icons.js';

const props = defineProps<{
  plugins: readonly PluginManifest[];
  /**
   * Whether whole keys are on offer as well as single actions.
   *
   * True beside the deck grid, where a drop makes a key; false inside the key
   * editor, where a drop adds a step to a macro and a finished key would mean
   * nothing. The same palette, read as "here are some keys" in one place and
   * "here are some steps" in the other.
   */
  presets?: boolean;
  /** Current values, so a preset's tile shows real figures rather than `{{…}}`. */
  variables?: Readonly<Record<string, VariableValue>>;
}>();

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

function onDragStart(event: DragEvent, action: ActionDefinition): void {
  event.dataTransfer?.setData(
    'application/x-easydeck-action',
    JSON.stringify({ type: action.type, label: say(action.label) }),
  );
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
}

function onPresetDragStart(event: DragEvent, plugin: PluginManifest, preset: ButtonPreset): void {
  event.dataTransfer?.setData(
    PRESET_MIME,
    JSON.stringify({ pluginId: plugin.id, name: preset.name }),
  );
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
}

const PRESET_MIME = 'application/x-easydeck-preset';

/**
 * What a preset's first state looks like, with variables filled in.
 *
 * A sketch rather than the real key component: that one belongs to the grid,
 * where it also handles dropping, resizing and its share of a stretched
 * picture. Here all that is wanted is the colour, the picture and the words —
 * enough that a preset is recognisable as the key it will become.
 */
function preview(preset: ButtonPreset): {
  background: string;
  text: string;
  icon: string | undefined;
} {
  const state = preset.button.states[0];
  const values = props.variables ?? {};

  return {
    background: state?.visual.background ?? '#111318',
    text: renderTemplate(state?.visual.label?.text ?? '', values),
    icon: state?.visual.icon?.source,
  };
}

interface Group {
  readonly plugin: PluginManifest;
  readonly actions: readonly ActionDefinition[];
  readonly presets: readonly ButtonPreset[];
}

const groups = computed<Group[]>(() => {
  const query = search.value.trim().toLowerCase();
  const matches = (plugin: PluginManifest, label: LocalizedText, id: string): boolean => {
    if (query.length === 0) return true;
    return (
      say(label).toLowerCase().includes(query) ||
      say(plugin.name).toLowerCase().includes(query) ||
      id.includes(query)
    );
  };

  return props.plugins
    .map((plugin) => ({
      plugin,
      actions: plugin.actions.filter((action) => matches(plugin, action.label, action.type)),
      presets: props.presets
        ? (plugin.presets ?? []).filter((preset) => matches(plugin, preset.label, preset.name))
        : [],
    }))
    .filter((group) => group.actions.length + group.presets.length > 0);
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
          <span class="count">{{ group.actions.length + group.presets.length }}</span>
        </button>

        <ul v-show="isOpen(group.plugin.id)">
          <!-- Presets first: they are whole keys, and a palette beside the
               grid is a shelf of keys before it is a list of steps. -->
          <li v-for="preset in group.presets" :key="`preset:${preset.name}`">
            <div
              class="action preset"
              draggable="true"
              @dragstart="onPresetDragStart($event, group.plugin, preset)"
            >
              <span v-if="say(preset.description)" class="why" :title="say(preset.description)">?</span>

              <!-- The key as it will arrive, in miniature. Nothing explains
                   the difference between a preset and an action as quickly as
                   one of them looking like a key. -->
              <span class="face" :style="{ background: preview(preset).background }">
                <img v-if="preview(preset).icon" class="face-icon" :src="preview(preset).icon" alt="" />
                <span class="face-text">{{ preview(preset).text }}</span>
              </span>
              <span class="label">{{ say(preset.label) }}</span>
            </div>
          </li>

          <li v-for="action in group.actions" :key="action.type">
            <!-- The label travels with the type so a freshly created button
                 says what it does without the drop handler knowing any
                 particular action.

                 A mark above a word rather than a paragraph beside it: at this
                 size the description was two lines of small text nobody read
                 while looking for something, and it cost the row the width
                 that now holds three actions. It still lives in the manifest,
                 for wherever there is room to say more. -->
            <!-- No hover text of its own: the name is written under the mark,
                 and the action's type — `easydeck.go-home` — reads as an
                 untranslated string to anyone who is not writing plugins. -->
            <div
              class="action"
              draggable="true"
              @dragstart="onDragStart($event, action)"
            >
              <!-- Only where there is something to tell: a question mark on
                   every tile would be a row of marks that mostly say nothing,
                   and the ones worth hovering would stop standing out. -->
              <span v-if="say(action.description)" class="why" :title="say(action.description)">?</span>

              <img v-if="isDrawnIcon(action.icon)" class="mark" :src="action.icon" alt="" />
              <svg v-else class="mark" viewBox="0 0 24 24" aria-hidden="true">
                <path :d="actionIconPath(action.icon)" fill="currentColor" />
              </svg>
              <span class="label">{{ say(action.label) }}</span>
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
  /* The grid decides how wide this is; nothing here may stretch it further. */
  min-width: 0;
}

.search {
  margin: 0 12px 10px;
  min-width: 0;
}

.scroll {
  /* The full height of the panel, whatever is in it.
     Sized by its contents, the scrolling area shrank as groups were collapsed
     and the bar came and went with it — the height has to belong to the panel,
     not to how much happens to be showing. */
  flex: 1;
  min-height: 0;
  /* Always shown, and always taking its space: a bar that appears when a
     group is opened shifts every tile a few pixels sideways, which reads as
     the palette twitching. */
  overflow-y: scroll;
  scrollbar-gutter: stable;
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
  /* Flush with the group's heading: an indent here only made the tiles look
     misaligned against everything else in the column. */
  padding: 0;
  display: grid;
  /*
   * Three across, whatever the panel's width makes of them.
   *
   * About ninety pixels at the width the palette is given, and a few either
   * way is no matter — what counts is that the row always holds three, so the
   * grid never reflows into a different shape as groups open and close.
   */
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 5px;
}

.action {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  aspect-ratio: 1;
  padding: 8px 5px;
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: grab;
  text-align: center;
}

.action:hover {
  border-color: var(--accent);
}

.why {
  position: absolute;
  top: 3px;
  right: 4px;
  width: 13px;
  height: 13px;
  display: grid;
  place-items: center;
  border-radius: 999px;
  font-size: 9px;
  line-height: 1;
  color: var(--text-muted);
  background: var(--surface-2);
  cursor: help;
}

.why:hover {
  color: var(--text);
  background: var(--accent-soft);
}

/* The miniature key. Square, like the thing it stands for. */
.face {
  position: relative;
  width: 34px;
  height: 34px;
  flex: none;
  border-radius: 5px;
  overflow: hidden;
  display: grid;
  place-items: center;
  /* The panel's own key edge, so the tile reads as a key rather than a swatch. */
  box-shadow: inset 0 0 0 1px rgb(255 255 255 / 12%);
}

.face-icon {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.face-text {
  position: relative;
  font-size: 9px;
  line-height: 1.1;
  color: #fff;
  text-align: center;
  padding: 0 2px;
  /* Two lines of a two-line label; a third would not be legible at this size. */
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  white-space: pre-line;
}

.mark {
  width: 26px;
  height: 26px;
  flex: none;
  color: var(--text-muted);
}

.action:hover .mark {
  color: var(--accent);
}

.label {
  font-size: 11px;
  line-height: 1.2;
  /* Two lines at most: a third would push the mark out of the square. */
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.empty {
  font-size: 13px;
  margin: 8px 0 0;
}
</style>

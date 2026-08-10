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
  /** Where each plugin that holds a connection has got to. */
  statuses?: Readonly<Record<string, { status: string; message?: LocalizedText }>>;
}>();

const { t, locale } = useI18n();

/** A plugin worth opening a window for: one with settings or commands. */
const configurable = (plugin: PluginManifest): boolean =>
  (plugin.settings?.length ?? 0) > 0 || (plugin.commands?.length ?? 0) > 0;

const statusOf = (pluginId: string): string => props.statuses?.[pluginId]?.status ?? 'off';

/**
 * Why the lamp is the colour it is, in the plugin's own words.
 *
 * "Nothing is listening on 127.0.0.1:4455" is worth reading; a red dot on its
 * own only says that something is wrong.
 */
function statusHint(pluginId: string): string {
  const state = props.statuses?.[pluginId];
  const message = say(state?.message);
  const name = t(`plugins.status.${state?.status ?? 'off'}`);
  return message ? `${name}
${message}` : name;
}
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

/**
 * The name, and the description under it where there is one.
 *
 * Both in the one tooltip rather than a name here and a question mark badge
 * there. Two reasons it applies to actions as well as presets: a tile is
 * ninety pixels wide, so a name longer than two short words is cut off and
 * the whole of it has to be readable somewhere; and a badge floating over a
 * tile was the only thing on a shelf of keys that was not part of one.
 */
function hint(item: { label: LocalizedText; description?: LocalizedText }): string {
  const description = say(item.description);
  return description ? `${say(item.label)}
${description}` : say(item.label);
}

/**
 * Actions a preset of the same plugin makes redundant beside the grid.
 *
 * "Start / stop recording" and the Record preset are the same key — one
 * plain, one dressed — and offering both makes the palette longer while
 * making the choice harder. The plain one steps aside, and keeps its place in
 * the key editor, where a preset means nothing and a step is what is wanted.
 *
 * Read out of the presets rather than declared on the action. A flag would be
 * a second place to keep one truth, and the day somebody deletes a preset and
 * forgets the flag, an action vanishes from the palette with nothing to
 * explain why.
 *
 * A preset only stands in for an action when it *is* that action wearing a
 * coat: one action type across all its states and gestures, with nothing
 * filled in. Two conditions, and each earns its place:
 *
 * - **One type.** A preset that starts the stream *and* switches scene is a
 *   sequence, not a dressed-up command; hiding both of its ingredients would
 *   leave somebody unable to build anything else out of them.
 * - **No parameters.** A preset that switches to "Intro" has already answered
 *   the question the general action asks, so it cannot replace it — the
 *   action is how you get a key for any other scene.
 */
function actionsCoveredByPresets(plugin: PluginManifest): Set<string> {
  const covered = new Set<string>();

  for (const preset of plugin.presets ?? []) {
    const used = new Set<string>();
    let configured = false;

    for (const state of preset.button.states) {
      for (const sequence of Object.values(state.actions ?? {})) {
        for (const action of sequence ?? []) {
          used.add(action.type);
          if (Object.keys(action.params ?? {}).length > 0) configured = true;
        }
      }
    }

    if (used.size === 1 && !configured) covered.add([...used][0]!);
  }

  return covered;
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
    .map((plugin) => {
      const covered = props.presets ? actionsCoveredByPresets(plugin) : new Set<string>();

      return {
        plugin,
        actions: plugin.actions.filter(
          (action) => !covered.has(action.type) && matches(plugin, action.label, action.type),
        ),
        presets: props.presets
          ? (plugin.presets ?? []).filter((preset) => matches(plugin, preset.label, preset.name))
          : [],
      };
    })
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

          <!-- Only where the plugin holds something of its own: a connection,
               an account. A lamp beside navigation would be a light that can
               only ever be one colour.

               It reports and does nothing, which is why it stays here while
               the gear went to the settings window: somebody in the palette
               is looking for something to put on a key, and wants to know
               that OBS is unreachable — not to be invited to fix it now. -->
          <span
            v-if="configurable(group.plugin)"
            class="lamp"
            :class="statusOf(group.plugin.id)"
            :title="statusHint(group.plugin.id)"
          />
          <span class="count">{{ group.actions.length + group.presets.length }}</span>
        </button>



        <ul v-show="isOpen(group.plugin.id)">
          <!-- Presets first: they are whole keys, and a palette beside the
               grid is a shelf of keys before it is a list of steps. -->
          <li v-for="preset in group.presets" :key="`preset:${preset.name}`">
            <!-- The tile *is* the key it will become: same square, same
                 colour, same words. A caption underneath would have said in
                 text what the picture already says, at the cost of shrinking
                 the picture to a third of the tile. The name is on hover,
                 where it is wanted only when the key alone is not enough. -->
            <div
              class="preset"
              draggable="true"
              :style="{ background: preview(preset).background }"
              :title="hint(preset)"
              @dragstart="onPresetDragStart($event, group.plugin, preset)"
            >
              <img v-if="preview(preset).icon" class="preset-icon" :src="preview(preset).icon" alt="" />
              <span class="preset-text">{{ preview(preset).text }}</span>
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
            <div
              class="action"
              draggable="true"
              :title="hint(action)"
              @dragstart="onDragStart($event, action)"
            >
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

/* Four states, four colours, and one of them is deliberately dull. */
.lamp {
  width: 7px;
  height: 7px;
  flex: none;
  border-radius: 999px;
  background: var(--text-muted);
  cursor: help;
}

.lamp.ready {
  background: #3fae63;
}

.lamp.connecting {
  background: #d3a038;
}

.lamp.error {
  background: #d4544a;
}

/* A key, at the size the palette gives it. */
.preset {
  position: relative;
  aspect-ratio: 1;
  display: grid;
  place-items: center;
  overflow: hidden;
  /* The grid's own corner, so a shelf of presets lines up with the tiles of
     actions beside them rather than looking like a different kind of thing. */
  border-radius: 8px;
  cursor: grab;
  /* Its own edge, drawn inside: a border would eat a pixel of the picture and
     leave the colour looking inset rather than filling the key. */
  box-shadow: inset 0 0 0 1px rgb(255 255 255 / 14%);
}

.preset:hover {
  box-shadow: inset 0 0 0 1px var(--accent);
}

.preset-icon {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.preset-text {
  position: relative;
  font-size: 12px;
  line-height: 1.15;
  /* The panel draws labels white unless told otherwise, and so does this. */
  color: #fff;
  text-align: center;
  padding: 0 4px;
  /* Three lines here, where the key has room for them. */
  display: -webkit-box;
  -webkit-line-clamp: 3;
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

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type {
  ActionDescriptor,
  ButtonStateDefinition,
  LocalizedText,
  ParamDefinition,
  PluginManifest,
  VariableDeclaration,
  VariableValue,
} from '@easydeck/core';

import ActionParams from './ActionParams.vue';

type Trigger = 'press' | 'longPress' | 'doublePress';
type ActionMap = NonNullable<ButtonStateDefinition['actions']>;

const TRIGGERS: readonly Trigger[] = ['press', 'longPress', 'doublePress'];

/** Ours alone, so a key being dragged in the grid can never land in a macro. */
const STEP_MIME = 'application/x-easydeck-step';
/** What the palette puts on the clipboard, same as the grid already accepts. */
const ACTION_MIME = 'application/x-easydeck-action';

const props = defineProps<{
  /** Which gesture is open; owned above so a state tab can add to it. */
  trigger?: 'press' | 'longPress' | 'doublePress';
  actions: ActionMap;
  plugins: readonly PluginManifest[];
  /** Live values and their declarations, for the variable picker. */
  values: Readonly<Record<string, VariableValue>>;
  declarations: readonly VariableDeclaration[];
  folders: readonly { id: string; name: string }[];
  pages: readonly { id: string; name: string }[];
  buttons: readonly { id: string; name: string; states: readonly string[] }[];
  ownStates: readonly string[];
  /** Where each plugin that holds a connection has got to. */
  pluginStatuses?: Readonly<Record<string, { status: string; message?: LocalizedText }>>;
}>();

const emit = defineEmits<{
 update: [actions: ActionMap]
  /** The gesture tab the user switched to. */
  trigger: [which: Trigger];
  /** Open the settings of the plugin this step belongs to. */
  configurePlugin: [pluginId: string];
}>();

const { t, locale } = useI18n();

const say = (text: LocalizedText | undefined): string =>
  text === undefined ? '' : (text[locale.value] ?? text.en);

/**
 * The plugin a step belongs to, which is the prefix of its type.
 *
 * Shown on the step itself because that is where the trouble is noticed: a
 * key that does nothing is looked at in the editor, and "OBS is not
 * connected" belongs next to the step that needs OBS, not in a window two
 * clicks away.
 */
const pluginOf = (type: string): PluginManifest | undefined =>
  props.plugins.find((plugin) => type.startsWith(`${plugin.id}.`));

/** Only a plugin with something to hold has a status worth a lamp. */
const watchable = (type: string): PluginManifest | undefined => {
  const plugin = pluginOf(type);
  if (!plugin) return undefined;
  const configurable =
    (plugin.settings?.length ?? 0) > 0 || (plugin.commands?.length ?? 0) > 0;
  return configurable ? plugin : undefined;
};

const statusOf = (type: string): string =>
  props.pluginStatuses?.[watchable(type)?.id ?? '']?.status ?? 'off';

function statusHint(type: string): string {
  const plugin = watchable(type);
  const state = plugin ? props.pluginStatuses?.[plugin.id] : undefined;
  const name = t(`plugins.status.${state?.status ?? 'off'}`);
  const message = say(state?.message);
  return message ? `${say(plugin?.name)}: ${name}
${message}` : `${say(plugin?.name)}: ${name}`;
}

/**
 * One trigger at a time.
 *
 * All three used to be stacked, which meant scrolling past sequences you were
 * not editing to reach the one you were. A macro is read as an ordered list,
 * so the list is what gets the room.
 */
/**
 * Which gesture is being edited.
 *
 * Held by the editor above rather than here, because dropping an action onto
 * another *state's* tab has to know it — the answer to "where does this land"
 * is the gesture currently open, whichever state it goes to.
 */
const trigger = computed<Trigger>({
  get: () => props.trigger ?? 'press',
  set: (value) => emit('trigger', value),
});
const list = computed<readonly ActionDescriptor[]>(() => props.actions[trigger.value] ?? []);
const countOf = (which: Trigger): number => (props.actions[which] ?? []).length;

/**
 * Only one step shows its fields.
 *
 * Every step being expanded made the order — the thing that actually matters
 * in a macro — impossible to see. Collapsed steps carry a summary instead, so
 * the sequence reads at a glance and the fields are one click away.
 */
const open = ref<number | null>(null);
watch(trigger, () => {
  open.value = null;
});

const definitions = computed(() => {
  const map = new Map<string, PluginManifest['actions'][number]>();
  for (const plugin of props.plugins) {
    for (const action of plugin.actions) map.set(action.type, action);
  }
  return map;
});

const nameOf = (descriptor: ActionDescriptor): string =>
  say(definitions.value.get(descriptor.type)?.label) || descriptor.type;

// --- summaries ------------------------------------------------------------

/**
 * What a collapsed step says about itself.
 *
 * Ids are resolved to names and options to their labels: a step reading
 * "Volume · +10" is worth collapsing, one reading "f3a91c · 10" is not.
 */
function describe(param: ParamDefinition, raw: unknown): string {
  const value = raw === undefined ? param.default : raw;

  if (value === undefined || value === '') {
    // Empty is an answer here, not a blank: it means the button doing the work.
    return param.type === 'profile-button' ? t('editor.thisButton') : '';
  }

  if (param.type === 'boolean') return value ? say(param.label) : '';

  if (param.type === 'select') {
    const option = (param.options ?? []).find((item) => item.value === value);
    return option ? say(option.label) : String(value);
  }

  if (param.type === 'profile-folder') {
    return props.folders.find((folder) => folder.id === value)?.name ?? String(value);
  }
  if (param.type === 'profile-page') {
    return props.pages.find((page) => page.id === value)?.name ?? String(value);
  }
  if (param.type === 'profile-button') {
    return props.buttons.find((button) => button.id === value)?.name ?? String(value);
  }

  const text = String(value).replace(/\s+/g, ' ').trim();
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
}

function summarise(descriptor: ActionDescriptor): string {
  const definition = definitions.value.get(descriptor.type);
  if (!definition) return '';

  const parts: string[] = [];
  for (const param of definition.params ?? []) {
    const text = describe(param, descriptor.params?.[param.name]);
    if (text) parts.push(text);
  }
  return parts.join(' · ');
}

// --- editing --------------------------------------------------------------

function setList(which: Trigger, next: ActionDescriptor[]): void {
  emit('update', { ...props.actions, [which]: next });
}

/**
 * Adds a step at a given place in the sequence.
 *
 * There used to be a dropdown for this, which asked people to find an action
 * by name in a list of every action installed, then read where it landed. The
 * palette beside the editor shows what each one does and drops it exactly
 * where it is wanted, so the dropdown had nothing left to offer.
 */
function insert(type: string, at: number): void {
  const next = [...list.value];
  const position = Math.max(0, Math.min(at, next.length));

  next.splice(position, 0, { type });
  setList(trigger.value, next);
  open.value = position;
}

function duplicate(index: number): void {
  const next = [...list.value];
  next.splice(index + 1, 0, JSON.parse(JSON.stringify(next[index])) as ActionDescriptor);
  setList(trigger.value, next);
  open.value = index + 1;
}

function remove(index: number): void {
  setList(
    trigger.value,
    list.value.filter((_, position) => position !== index),
  );

  if (open.value === index) open.value = null;
  else if (open.value !== null && open.value > index) open.value -= 1;
}

function updateParams(index: number, params: Record<string, unknown>): void {
  setList(
    trigger.value,
    list.value.map((action, position) => (position === index ? { ...action, params } : action)),
  );
}

// --- drag and drop --------------------------------------------------------

const dragIndex = ref<number | null>(null);
/** A row is only draggable once the handle is held, so fields stay selectable. */
const armed = ref<number | null>(null);
/** Where the step would land: an insertion point, not a row. */
const dropIndex = ref<number | null>(null);
const tabOver = ref<Trigger | null>(null);

function reset(): void {
  tailOver.value = false;
  dragIndex.value = null;
  armed.value = null;
  dropIndex.value = null;
  tabOver.value = null;
}

function onDragStart(index: number, event: DragEvent): void {
  dragIndex.value = index;
  open.value = null;
  event.dataTransfer?.setData(STEP_MIME, String(index));
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
}

function onDragOver(index: number, event: DragEvent): void {
  const types = event.dataTransfer?.types ?? [];
  if (!types.includes(STEP_MIME) && !types.includes(ACTION_MIME)) return;
  event.preventDefault();

  const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
  dropIndex.value = event.clientY < box.top + box.height / 2 ? index : index + 1;
}

function onDrop(event: DragEvent): void {
  const from = dragIndex.value;
  const to = dropIndex.value;
  const dropped = event.dataTransfer?.getData(ACTION_MIME);
  reset();

  // From the palette: a new step, at the point the line was showing.
  if (dropped) {
    try {
      const { type } = JSON.parse(dropped) as { type: string };
      if (type) insert(type, to ?? list.value.length);
    } catch {
      // Something else's drag data wearing our type; nothing to add.
    }
    return;
  }

  if (from === null || to === null) return;

  const next = [...list.value];
  const [moved] = next.splice(from, 1);
  next.splice(to > from ? to - 1 : to, 0, moved!);
  setList(trigger.value, next);
}

const tailOver = ref(false);

function onTailDragOver(event: DragEvent): void {
  const types = event.dataTransfer?.types ?? [];
  if (!types.includes(ACTION_MIME) && !types.includes(STEP_MIME)) return;

  event.preventDefault();
  tailOver.value = true;
  dropIndex.value = list.value.length;
}

function onTailDrop(event: DragEvent): void {
  tailOver.value = false;
  onDrop(event);
}

/** The empty list is a target too, or a first step could never be dropped. */
function onEmptyDragOver(event: DragEvent): void {
  if (!event.dataTransfer?.types.includes(ACTION_MIME)) return;
  event.preventDefault();
  dropIndex.value = 0;
}

/** Dropping on another trigger's tab moves the step there — the usual fix
    for having built a sequence under the wrong one. */
function onTabDragOver(which: Trigger, event: DragEvent): void {
  if (dragIndex.value === null || which === trigger.value) return;
  event.preventDefault();
  tabOver.value = which;
}

function onTabDrop(which: Trigger): void {
  const from = dragIndex.value;
  const source = trigger.value;
  reset();
  if (from === null || which === source) return;

  const rest = [...list.value];
  const [moved] = rest.splice(from, 1);
  emit('update', {
    ...props.actions,
    [source]: rest,
    [which]: [...(props.actions[which] ?? []), moved!],
  });
  trigger.value = which;
}
</script>

<template>
  <section class="macro">
    <div class="tabs">
      <button
        v-for="item in TRIGGERS"
        :key="item"
        type="button"
        class="tab"
        :class="{ current: item === trigger, over: tabOver === item }"
        @click="trigger = item"
        @dragover="onTabDragOver(item, $event)"
        @dragleave="tabOver = null"
        @drop.prevent="onTabDrop(item)"
      >
        {{ t(`editor.triggers.${item}`) }}
        <span v-if="countOf(item) > 0" class="count">{{ countOf(item) }}</span>
      </button>
    </div>

    <p
      v-if="list.length === 0"
      class="muted empty"
      :class="{ over: dropIndex === 0 }"
      @dragover="onEmptyDragOver"
      @dragleave="dropIndex = null"
      @drop.prevent="onDrop"
    >
      {{ t('editor.noActions') }}
    </p>

    <ol v-else @dragend="reset">
      <li
        v-for="(action, index) in list"
        :key="index"
        :draggable="armed === index"
        :class="{
          dragging: dragIndex === index,
          'drop-before': dropIndex === index,
          'drop-after': dropIndex === index + 1 && index === list.length - 1,
        }"
        @dragstart="onDragStart(index, $event)"
        @dragover="onDragOver(index, $event)"
        @drop.prevent="onDrop($event)"
      >
        <div class="head">
          <span
            class="handle"
            :title="t('editor.reorder')"
            @mousedown="armed = index"
            @mouseup="armed = null"
            >⠿</span
          >
          <span class="step">{{ index + 1 }}</span>

          <button type="button" class="title" @click="open = open === index ? null : index">
            <span class="name">{{ nameOf(action) }}</span>
            <span v-if="open !== index && summarise(action)" class="summary">
              {{ summarise(action) }}
            </span>
          </button>

          <span class="controls">
            <!-- A lamp and a way to act on it, on the steps that depend on
                 something outside this machine. -->
            <template v-if="watchable(action.type)">
              <span class="lamp" :class="statusOf(action.type)" :title="statusHint(action.type)" />
              <button
                type="button"
                :title="t('plugins.configure')"
                @click="emit('configurePlugin', watchable(action.type)!.id)"
              >
                ⚙
              </button>
            </template>

            <button type="button" :title="t('editor.duplicate')" @click="duplicate(index)">⧉</button>
            <button
              type="button"
              class="remove"
              :title="t('editor.removeAction')"
              @click="remove(index)"
            >
              ✕
            </button>
            <button
              type="button"
              class="chevron"
              :class="{ open: open === index }"
              :aria-expanded="open === index"
              @click="open = open === index ? null : index"
            >
              ⌄
            </button>
          </span>
        </div>

        <ActionParams
          v-if="open === index"
          :definition="definitions.get(action.type)"
          :params="action.params ?? {}"
          :values="values"
          :declarations="declarations"
          :folders="folders"
          :pages="pages"
          :buttons="buttons"
          :own-states="ownStates"
          @update="updateParams(index, $event)"
        />
      </li>
    </ol>


    <p v-if="list.length > 1" class="muted hint">{{ t('editor.orderHint') }}</p>

    <!-- The room below the last step: dropping there means "at the end",
         which is what aiming at empty space under a list is asking for. -->
    <div class="tail" :class="{ over: tailOver }" @dragover="onTailDragOver" @dragleave="tailOver = false" @drop.prevent="onTailDrop" />
  </section>
</template>

<style scoped>
.lamp {
  width: 7px;
  height: 7px;
  flex: none;
  align-self: center;
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

.macro {
  display: flex;
  flex-direction: column;
  gap: 10px;
  /* Full height, so the area below the last step is real estate a drop can
     land on rather than nothing at all. */
  flex: 1;
  min-height: 0;
}

.tabs {
  display: flex;
  gap: 4px;
}

.tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  font-size: 12px;
  padding: 5px 6px;
  background: none;
}

.tab.current {
  border-color: var(--accent);
  color: var(--accent);
}

.tab.over {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.count {
  font-size: 10px;
  min-width: 15px;
  padding: 0 4px;
  border-radius: 7px;
  background: var(--surface-2);
  color: var(--text-muted);
}

.tab.current .count {
  background: var(--accent-soft);
  color: var(--accent);
}

ol {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

li {
  position: relative;
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 6px 8px;
}

li.dragging {
  opacity: 0.4;
}

/* Where the step will land, drawn as an insertion line rather than a
   highlighted row: a macro is reordered between steps, not onto one. */
.drop-before::before,
.drop-after::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--accent);
  border-radius: 2px;
}

.drop-before::before { top: -4px; }
.drop-after::after { bottom: -4px; }

.head {
  display: flex;
  align-items: center;
  gap: 7px;
}

.handle {
  cursor: grab;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1;
  user-select: none;
}

.handle:active { cursor: grabbing; }

.step {
  font-size: 11px;
  color: var(--text-muted);
  min-width: 12px;
  text-align: right;
}

/* The row itself opens the step: a 4px chevron is a poor target when the
   whole line is available. */
.title {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  background: none;
  border: none;
  padding: 2px 0;
  text-align: left;
}

.name {
  font-size: 13px;
}

.summary {
  font-size: 11px;
  color: var(--text-muted);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.controls {
  display: flex;
  gap: 2px;
}

.controls button {
  padding: 1px 6px;
  font-size: 11px;
  background: none;
  border-color: transparent;
  color: var(--text-muted);
}

.controls button:hover:not(:disabled) {
  border-color: var(--border-strong);
  color: var(--text);
}

.controls .remove:hover { color: var(--danger); }

.chevron {
  transition: transform 120ms ease;
}

.chevron.open {
  transform: rotate(180deg);
}

.add {
  width: 100%;
}

.empty,
.hint {
  font-size: 11px;
  margin: 0;
}
.empty.over {
  border-color: var(--accent);
  color: var(--accent);
}
.tail {
  flex: 1;
  min-height: 40px;
  border: 1px dashed transparent;
  border-radius: 8px;
  margin-top: 6px;
}

.tail.over {
  border-color: var(--accent);
  background: var(--accent-soft);
}
</style>

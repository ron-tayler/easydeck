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
} from '@easydeck/protocol';

import { insertStep, moveStep, removeStep, stepAt, updateStep } from '@easydeck/engine/script';
import { CORE_ON } from '@easydeck/engine/actions';
import type { StepPath } from '@easydeck/protocol';

import ScriptSteps from './ScriptSteps.vue';

type Trigger = 'press' | 'longPress' | 'doublePress' | 'event';
type ActionMap = NonNullable<ButtonStateDefinition['actions']>;

/**
 * The gestures, and then the watchers.
 *
 * `event` is last because it is not one: the other three are things a finger
 * does, and this is a list of handlers that act on their own. It reads as a
 * sequence like the others and is not one — none of its handlers waits for the
 * one above.
 */
const TRIGGERS: readonly Trigger[] = ['press', 'longPress', 'doublePress', 'event'];

/** Ours alone, so a key being dragged in the grid can never land in a macro. */
const STEP_MIME = 'application/x-easydeck-step';
/** What the palette puts on the clipboard, same as the grid already accepts. */
const ACTION_MIME = 'application/x-easydeck-action';
/** A step being carried out of this list, with enough of it to rebuild. */
const STEP_PAYLOAD_MIME = 'application/x-easydeck-step-payload';

const props = defineProps<{
  /** Which tab is open; owned above so a state tab can add to it. */
  trigger?: Trigger;
  actions: ActionMap;
  plugins: readonly PluginManifest[];
  /** Live values and their declarations, for the variable picker. */
  values: Readonly<Record<string, VariableValue>>;
  declarations: readonly VariableDeclaration[];
  folders: readonly { id: string; name: string }[];
  pages: readonly { id: string; name: string }[];
  buttons: readonly { id: string; name: string; states: readonly string[] }[];
  ownStates: readonly string[];
  /** The button being edited; see ActionParams for why a form needs it. */
  ownButtonId?: string;
  /** The settings a key's widget declares; see ConditionInput. */
  loadWidgetParams?: (
    buttonId: string,
  ) => Promise<readonly { value: string; label?: LocalizedText }[]>;
  /** Asks what shape a field should take; see ActionParams. */
  loadShape?: (
    source: string,
    params: Readonly<Record<string, unknown>>,
  ) => Promise<ParamDefinition | undefined>;
  /** Where each plugin that holds a connection has got to. */
  pluginStatuses?: Readonly<Record<string, { status: string; message?: LocalizedText }>>;
  /** Asks a plugin for the choices behind one of its `optionsFrom` parameters. */
  loadOptions?: (
    pluginId: string,
    source: string,
    params: Readonly<Record<string, unknown>>,
  ) => Promise<readonly { value: string; label?: LocalizedText }[]>;
  /** Passed straight through to a password field; see ActionParams. */
  filledSecrets?: readonly string[];
  saveSecret?: (value: string, reference?: string) => Promise<string>;
  clearSecret?: (reference: string) => Promise<void>;
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
 * One empty object, shared by every action that has no parameters.
 *
 * `?? {}` in the template builds a new one on every render, and a fresh
 * reference reads as a change to whatever is watching it downstream — which
 * is how a gauge ticking over in another corner of the window ended up
 * re-fetching the scene list.
 */
const NO_PARAMS: Readonly<Record<string, unknown>> = Object.freeze({});

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
const openPath = ref<StepPath | undefined>();
watch(trigger, () => {
  openPath.value = undefined;
});

/** The top of the script, named so the template does not build one per render. */
const TOP: StepPath = Object.freeze([]) as StepPath;

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

/**
 * Every edit is a path into the tree, applied by the engine's own functions.
 *
 * The editor holds no copy of the script: it is handed one, it hands back the
 * next one, and the profile is the only place it lives. That is what keeps a
 * block's branches from drifting out of step with the list they are drawn in.
 */
function setList(which: Trigger, next: ActionDescriptor[]): void {
  emit('update', { ...props.actions, [which]: next });
}

function apply(next: ActionDescriptor[]): void {
  setList(trigger.value, next);
}

/**
 * Adds a step at a given place in the sequence.
 *
 * There used to be a dropdown for this, which asked people to find an action
 * by name in a list of every action installed, then read where it landed. The
 * palette beside the editor shows what each one does and drops it exactly
 * where it is wanted, so the dropdown had nothing left to offer.
 */
/** Adds a watcher at the end of the list, which is where a new one belongs. */
function addHandler(): void {
  const at = list.value.length;
  apply(insertStep(list.value, TOP, at, { type: CORE_ON }));
  openPath.value = [at];
}

function onInsert(where: StepPath, at: number, type: string): void {
  apply(insertStep(list.value, where, at, { type }));
  // Opened where it landed: a step just dropped is one about to be filled in.
  openPath.value = [...where, at];
}

function onDuplicate(path: StepPath): void {
  const step = stepAt(list.value, path);
  if (!step) return;

  const at = path[path.length - 1];
  if (typeof at !== 'number') return;

  // Deep-copied, branches included: a duplicated block that shared its
  // children with the original would be two names for one thing.
  const copy = JSON.parse(JSON.stringify(step)) as ActionDescriptor;
  apply(insertStep(list.value, path.slice(0, -1), at + 1, copy));
}

function onRemove(path: StepPath): void {
  apply(removeStep(list.value, path));
  openPath.value = undefined;
}

function onUpdate(path: StepPath, step: ActionDescriptor): void {
  apply(updateStep(list.value, path, () => step));
}

function onMove(from: StepPath, where: StepPath, at: number): void {
  apply(moveStep(list.value, from, where, at));
  reset();
}

// --- drag and drop --------------------------------------------------------

/** Which step is being carried, as a path into the tree. */
const dragPath = ref<StepPath | undefined>();
/** Where the line shows: which list, and the index within it. */
const dropList = ref<StepPath | undefined>();
const dropIndex = ref<number | undefined>();
const tabOver = ref<Trigger | null>(null);

function reset(): void {
  tailOver.value = false;
  dragPath.value = undefined;
  dropList.value = undefined;
  dropIndex.value = undefined;
  tabOver.value = null;
}

function onOver(where: StepPath | undefined, at: number | undefined): void {
  dropList.value = where;
  dropIndex.value = at;
}

/**
 * A drop that landed on the room around the list rather than on a step.
 *
 * Aiming below the last step means "at the end", and aiming at an empty list
 * means "the first one" — the alternative is a list nothing can ever be put
 * into, since there is no row to aim at.
 */
function onOuterDrop(event: DragEvent): void {
  const dropped = event.dataTransfer?.getData(ACTION_MIME);
  const carried = event.dataTransfer?.getData(STEP_MIME);
  const where = dropList.value ?? [];
  const at = dropIndex.value ?? list.value.length;

  reset();

  if (dropped) {
    try {
      const { type } = JSON.parse(dropped) as { type: string };
      if (type) onInsert(where, at, type);
    } catch {
      // Something else's drag data wearing our type; nothing to add.
    }
    return;
  }

  if (carried) {
    try {
      onMove(JSON.parse(carried) as StepPath, where, at);
    } catch {
      // As above.
    }
  }
}

const tailOver = ref(false);

function onTailDragOver(event: DragEvent): void {
  const types = event.dataTransfer?.types ?? [];
  if (!types.includes(ACTION_MIME) && !types.includes(STEP_MIME)) return;

  event.preventDefault();
  tailOver.value = true;
  // The end of the top-level list, whatever a nested one was showing.
  dropList.value = [];
  dropIndex.value = list.value.length;
}

function onTailDrop(event: DragEvent): void {
  tailOver.value = false;
  onOuterDrop(event);
}

/** The empty list is a target too, or a first step could never be dropped. */
function onEmptyDragOver(event: DragEvent): void {
  const types = event.dataTransfer?.types ?? [];
  if (!types.includes(ACTION_MIME) && !types.includes(STEP_MIME)) return;

  event.preventDefault();
  dropList.value = [];
  dropIndex.value = 0;
}

/** Dropping on another trigger's tab moves the step there — the usual fix
    for having built a sequence under the wrong one. */
/**
 * Whether a step may live under a given trigger.
 *
 * A handler only means anything in the event list, and everything else is dead
 * weight there — it would sit in the tab looking like part of the script and
 * never run. Refusing the drag is kinder than accepting it and doing nothing.
 */
function belongsUnder(step: ActionDescriptor | undefined, which: Trigger): boolean {
  if (!step) return false;
  return which === 'event' ? step.type === CORE_ON : step.type !== CORE_ON;
}

function onTabDragOver(which: Trigger, event: DragEvent): void {
  if (dragPath.value === undefined || which === trigger.value) return;
  if (!belongsUnder(stepAt(list.value, dragPath.value), which)) return;

  event.preventDefault();
  tabOver.value = which;
}

function onTabDrop(which: Trigger): void {
  const from = dragPath.value;
  const source = trigger.value;
  reset();
  if (from === undefined || which === source) return;

  // Whatever was picked up, branches and all, moved to the end of the other
  // gesture's script.
  const moved = stepAt(list.value, from);
  if (!belongsUnder(moved, which)) return;

  emit('update', {
    ...props.actions,
    [source]: removeStep(list.value, from),
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

    <!-- Said once, at the top, because a list of handlers looks exactly like a
         sequence and is not one. -->
    <p v-if="trigger === 'event'" class="muted hint">{{ t('editor.eventHint') }}</p>

    <!-- A button rather than something to drag from the palette: a handler
         only means anything here, and offering it beside the blocks let one be
         dropped into a press, where it looked like it did something. -->
    <button v-if="trigger === 'event'" type="button" class="add-handler" @click="addHandler">
      ＋ {{ t('editor.addHandler') }}
    </button>

    <p
      v-if="list.length === 0"
      class="muted empty"
      :class="{ over: dropIndex === 0 }"
      @dragover="onEmptyDragOver"
      @dragleave="dropIndex = undefined"
      @drop.prevent="onOuterDrop"
    >
      {{ t('editor.noActions') }}
    </p>

    <div v-else class="script" @dragend="reset">
      <ScriptSteps
        :steps="list"
        :path="TOP"
        :open-path="openPath"
        :drag-path="dragPath"
        :drop-list="dropList"
        :drop-index="dropIndex"
        :plugins="plugins"
        :values="values"
        :declarations="declarations"
        :folders="folders"
        :pages="pages"
        :buttons="buttons"
        :own-states="ownStates"
        :own-button-id="ownButtonId"
        :plugin-statuses="pluginStatuses"
        :load-options="loadOptions"
        :load-shape="loadShape"
        :load-widget-params="loadWidgetParams"
        :filled-secrets="filledSecrets"
        :save-secret="saveSecret"
        :clear-secret="clearSecret"
        @open="openPath = $event"
        @update="onUpdate"
        @remove="onRemove"
        @duplicate="onDuplicate"
        @insert="onInsert"
        @move="onMove"
        @dragging="dragPath = $event"
        @over="onOver"
        @configure-plugin="emit('configurePlugin', $event)"
      />
    </div>


    <!-- The room below the last step: dropping anywhere in it means "at the
         end", which is what aiming at empty space under a list is asking for.

         The whole of it takes the drop; only a band at the top shows it.
         Lighting up the entire remaining height made a gap of two hundred
         pixels flash, which reads as the panel rather than the list gaining
         a step. -->
    <div
      class="tail"
      @dragover="onTailDragOver"
      @dragleave="tailOver = false"
      @drop.prevent="onTailDrop"
    >
      <div class="tail-mark" :class="{ over: tailOver }" />
    </div>

    <!-- Under the drop zone rather than above it: between the list and the
         zone it read as a gap, and the space below the last step is what
         somebody aims at when they mean "add another". -->
    <p v-if="list.length > 1" class="muted hint">{{ t('editor.orderHint') }}</p>
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

/* Full width and dashed, so it reads as "there is room for another" rather
   than as a control that does something to what is already there. */
.add-handler {
  align-self: stretch;
  padding: 6px;
  border-style: dashed;
  background: none;
  color: var(--text-muted);
}

.add-handler:hover {
  border-color: var(--accent);
  color: var(--text);
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
  /* Flush with the last step. The section spaces its children apart, which is
     right between a list and a heading and wrong here: a gap read as the end
     of the list, with the space below belonging to something else. */
  margin-top: -10px;
}

.tail-mark {
  height: 40px;
  border: 1px dashed transparent;
  border-radius: 8px;
}

.tail-mark.over {
  border-color: var(--accent);
  background: var(--accent-soft);
}
</style>

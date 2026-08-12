<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type {
  ActionDescriptor,
  Condition,
  LocalizedText,
  ParamDefinition,
  PluginManifest,
  StepPath,
  VariableDeclaration,
  VariableValue,
} from '@easydeck/core';
// Through the sub-path, not the package index: the index pulls in the deck
// controller and its Node imports, which a browser cannot load.
import { CORE_DELAY, CORE_FOR, CORE_IF, CORE_ON } from '@easydeck/engine/actions';

import ActionParams from './ActionParams.vue';
import ConditionInput from './ConditionInput.vue';

/**
 * One list of steps, and every list inside it.
 *
 * The component calls itself for a block's branches, which is what gives the
 * editor its shape: a fork holds two lists, a loop holds one, and each of them
 * is the same thing again. Nesting is drawn as indentation with the branch
 * named at its head, the way a block-based editor does it — you can see what
 * belongs to what without reading a single line of text.
 *
 * It owns no data. Every edit is a path handed upwards, because the script
 * lives in the profile and there is exactly one copy of it: an editor holding
 * its own would have to be kept in step with the one being saved.
 */

/** Ours alone, so a key being dragged in the grid can never land in a script. */
const STEP_MIME = 'application/x-easydeck-step';
/** What the palette puts on the clipboard, same as the grid already accepts. */
const ACTION_MIME = 'application/x-easydeck-action';

const props = defineProps<{
  steps: readonly ActionDescriptor[];
  /** Where this list sits in the whole script; `[]` at the top. */
  path: StepPath;
  /** Which step is expanded, as a path — one at a time, across the whole tree. */
  openPath?: StepPath;
  /** The step being dragged, so a block can refuse to swallow itself. */
  dragPath?: StepPath;
  /** Where the line shows: this list, and the index within it. */
  dropList?: StepPath;
  dropIndex?: number;

  plugins: readonly PluginManifest[];
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
  pluginStatuses?: Readonly<Record<string, { status: string; message?: LocalizedText }>>;
  loadOptions?: (
    pluginId: string,
    source: string,
    params: Readonly<Record<string, unknown>>,
  ) => Promise<readonly { value: string; label?: LocalizedText }[]>;
  filledSecrets?: readonly string[];
  saveSecret?: (value: string, reference?: string) => Promise<string>;
  clearSecret?: (reference: string) => Promise<void>;
}>();

const emit = defineEmits<{
  open: [path: StepPath | undefined];
  update: [path: StepPath, step: ActionDescriptor];
  remove: [path: StepPath];
  duplicate: [path: StepPath];
  /** A new step from the palette: which list, where in it, what type. */
  insert: [list: StepPath, at: number, type: string];
  move: [from: StepPath, list: StepPath, at: number];
  dragging: [path: StepPath | undefined];
  over: [list: StepPath | undefined, at: number | undefined];
  configurePlugin: [pluginId: string];
}>();

const { t, locale } = useI18n();

const say = (text: LocalizedText | undefined): string =>
  text === undefined ? '' : (text[locale.value] ?? text.en);

/**
 * Built here rather than in the template, and passed as values rather than
 * written into the message.
 *
 * The names it shows are real `{{…}}` placeholders, and both the template
 * compiler and the translation library would try to substitute them: the first
 * because a mustache in a template is an expression, the second because `{{ }}`
 * is its own placeholder syntax and it refuses to nest one. A value handed in
 * is re-read by neither.
 */
const loopHint = computed(() =>
  t('editor.blocks.loopHint', { a: '{{loop}}', b: '{{loop.left}}', c: '{{loop.total}}' }),
);

const NO_PARAMS: Readonly<Record<string, unknown>> = Object.freeze({});

/** The branches each block draws, in the order they read. */
const BRANCHES: Readonly<Record<string, readonly string[]>> = {
  [CORE_IF]: ['then', 'else'],
  [CORE_FOR]: ['do'],
  // A handler reads as a fork with one arm, which is what it is to look at.
  [CORE_ON]: ['do'],
};

const isBlock = (type: string): boolean => type in BRANCHES;

const definitions = computed(() => {
  const map = new Map<string, PluginManifest['actions'][number]>();
  for (const plugin of props.plugins) {
    for (const action of plugin.actions) map.set(action.type, action);
  }
  return map;
});

function nameOf(step: ActionDescriptor): string {
  if (isBlock(step.type) || step.type === CORE_DELAY) return t(`editor.blocks.${step.type}`);
  return say(definitions.value.get(step.type)?.label) || step.type;
}

/** A handler's branch is not "then": it fires, so what is under it is what it does. */
const branchLabel = (type: string, branch: string): string =>
  type === CORE_ON && branch === 'do' ? t('editor.blocks.onDo') : t(`editor.blocks.${branch}`);

/** What a collapsed block says about itself, so a closed one still reads. */
function summarise(step: ActionDescriptor): string {
  if (step.type === CORE_DELAY) {
    const ms = Number(step.params?.['ms'] ?? 0);
    return ms > 0 ? `${ms} ms` : '';
  }

  if (step.type === CORE_FOR) {
    const variable = step.params?.['variable'];
    if (typeof variable === 'string' && variable !== '') return `{{${variable}}}`;
    const times = Number(step.params?.['times'] ?? 0);
    return times > 0 ? `× ${times}` : '';
  }

  if (step.type === CORE_IF || step.type === CORE_ON) {
    const when = step.params?.['when'] as Condition | undefined;
    if (!when) return '';
    const left = when.source === 'template' ? (when.text ?? '') : (when.name ?? t('editor.thisButton'));
    const right = when.value === undefined ? '' : ` ${String(when.value)}`;
    return `${left} ${t(`editor.condition.operator.${when.operator}`)}${right}`.trim();
  }

  return '';
}

const pathOf = (index: number): StepPath => [...props.path, index];
const branchPath = (index: number, branch: string): StepPath => [...props.path, index, branch];

const isOpen = (index: number): boolean => samePath(props.openPath, pathOf(index));

function samePath(a: StepPath | undefined, b: StepPath | undefined): boolean {
  if (!a || !b || a.length !== b.length) return false;
  return a.every((part, index) => b[index] === part);
}

const showsLineAt = (index: number): boolean =>
  samePath(props.dropList, props.path) && props.dropIndex === index;

// --- plugin lamps ---------------------------------------------------------

const pluginOf = (type: string): PluginManifest | undefined =>
  props.plugins.find((plugin) => type.startsWith(`${plugin.id}.`));

const watchable = (type: string): PluginManifest | undefined => {
  const plugin = pluginOf(type);
  if (!plugin) return undefined;
  const configurable = (plugin.settings?.length ?? 0) > 0 || (plugin.commands?.length ?? 0) > 0;
  return configurable ? plugin : undefined;
};

const statusOf = (type: string): string =>
  props.pluginStatuses?.[watchable(type)?.id ?? '']?.status ?? 'off';

// --- editing --------------------------------------------------------------

function setParams(index: number, params: Record<string, unknown>): void {
  const step = props.steps[index];
  if (step) emit('update', pathOf(index), { ...step, params });
}

function setCondition(index: number, when: Condition): void {
  const step = props.steps[index];
  if (step) emit('update', pathOf(index), { ...step, params: { ...(step.params ?? {}), when } });
}

/** The loop's count: a fixed number, or the name of a variable to read once. */
function setLoop(index: number, change: Record<string, unknown>): void {
  const step = props.steps[index];
  if (!step) return;

  const params = { ...(step.params ?? {}), ...change };
  emit('update', pathOf(index), { ...step, params });
}

// --- drag and drop --------------------------------------------------------

/** A row is only draggable once its handle is held, so fields stay selectable. */
const armed = computed(() => props.dragPath);

function onDragStart(index: number, event: DragEvent): void {
  emit('dragging', pathOf(index));
  emit('open', undefined);
  event.dataTransfer?.setData(STEP_MIME, JSON.stringify(pathOf(index)));
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
}

function onDragOver(index: number, event: DragEvent): void {
  const types = event.dataTransfer?.types ?? [];
  if (!types.includes(STEP_MIME) && !types.includes(ACTION_MIME)) return;

  event.preventDefault();
  event.stopPropagation();

  const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
  emit('over', props.path, event.clientY < box.top + box.height / 2 ? index : index + 1);
}

/** An empty branch is a target too, or nothing could ever be put in one. */
function onBranchDragOver(index: number, branch: string, event: DragEvent): void {
  const types = event.dataTransfer?.types ?? [];
  if (!types.includes(STEP_MIME) && !types.includes(ACTION_MIME)) return;

  event.preventDefault();
  event.stopPropagation();
  emit('over', branchPath(index, branch), 0);
}

function onDrop(event: DragEvent): void {
  event.stopPropagation();

  const dropped = event.dataTransfer?.getData(ACTION_MIME);
  const carried = event.dataTransfer?.getData(STEP_MIME);
  const list = props.dropList ?? props.path;
  const at = props.dropIndex ?? props.steps.length;

  if (dropped) {
    try {
      const { type } = JSON.parse(dropped) as { type: string };
      if (type) emit('insert', list, at, type);
    } catch {
      // Something else's drag data wearing our type; nothing to add.
    }
    return;
  }

  if (carried) {
    try {
      emit('move', JSON.parse(carried) as StepPath, list, at);
    } catch {
      // As above.
    }
  }
}
</script>

<template>
  <ol class="steps" :class="{ nested: path.length > 0 }">
    <li
      v-for="(step, index) in steps"
      :key="index"
      :draggable="samePath(armed, pathOf(index))"
      :class="{
        dragging: samePath(dragPath, pathOf(index)),
        'drop-before': showsLineAt(index),
        'drop-after': showsLineAt(index + 1) && index === steps.length - 1,
        block: isBlock(step.type),
      }"
      @dragstart="onDragStart(index, $event)"
      @dragover="onDragOver(index, $event)"
      @drop.prevent="onDrop($event)"
    >
      <div class="head">
        <span
          class="handle"
          :title="t('editor.reorder')"
          @mousedown="emit('dragging', pathOf(index))"
          @mouseup="emit('dragging', undefined)"
          >⠿</span
        >

        <button type="button" class="title" @click="emit('open', isOpen(index) ? undefined : pathOf(index))">
          <span class="name">{{ nameOf(step) }}</span>
          <span v-if="!isOpen(index) && summarise(step)" class="summary">{{ summarise(step) }}</span>
        </button>

        <span class="controls">
          <template v-if="watchable(step.type)">
            <span class="lamp" :class="statusOf(step.type)" />
            <button
              type="button"
              :title="t('plugins.configure')"
              @click="emit('configurePlugin', watchable(step.type)!.id)"
            >
              ⚙
            </button>
          </template>

          <button type="button" :title="t('editor.duplicate')" @click="emit('duplicate', pathOf(index))">
            ⧉
          </button>
          <button
            type="button"
            class="remove"
            :title="t('editor.removeAction')"
            @click="emit('remove', pathOf(index))"
          >
            ✕
          </button>
          <button
            type="button"
            class="chevron"
            :class="{ open: isOpen(index) }"
            @click="emit('open', isOpen(index) ? undefined : pathOf(index))"
          >
            ⌄
          </button>
        </span>
      </div>

      <!-- A block's own fields: a condition for the fork, a count for the
           loop, a number of milliseconds for the wait. -->
      <div v-if="isOpen(index) && (step.type === CORE_IF || step.type === CORE_ON)" class="fields">
        <ConditionInput
          :model-value="(step.params?.['when'] as Condition | undefined)"
          :declarations="declarations"
          :values="values"
          :buttons="buttons"
          :own-states="ownStates"
          :own-button-id="ownButtonId"
          :load-widget-params="loadWidgetParams"
          :load-shape="loadShape"
          @update:model-value="setCondition(index, $event)"
        />
      </div>

      <div v-else-if="isOpen(index) && step.type === CORE_FOR" class="fields row">
        <label>
          <span>{{ t('editor.blocks.times') }}</span>
          <input
            type="number"
            min="0"
            :value="String(step.params?.['times'] ?? '')"
            :disabled="Boolean(step.params?.['variable'])"
            @input="setLoop(index, { times: Number(($event.target as HTMLInputElement).value) })"
          />
        </label>
        <label>
          <span>{{ t('editor.blocks.fromVariable') }}</span>
          <input
            type="text"
            list="easydeck-variables"
            :value="String(step.params?.['variable'] ?? '')"
            :placeholder="t('editor.blocks.noVariable')"
            @input="setLoop(index, { variable: ($event.target as HTMLInputElement).value })"
          />
        </label>
        <p class="muted small">{{ loopHint }}</p>
      </div>

      <div v-else-if="isOpen(index) && step.type === CORE_DELAY" class="fields row">
        <label>
          <span>{{ t('editor.blocks.ms') }}</span>
          <input
            type="number"
            min="0"
            :value="String(step.params?.['ms'] ?? '')"
            @input="setParams(index, { ms: Number(($event.target as HTMLInputElement).value) })"
          />
        </label>
      </div>

      <ActionParams
        v-else-if="isOpen(index)"
        :definition="definitions.get(step.type)"
        :params="step.params ?? NO_PARAMS"
        :values="values"
        :declarations="declarations"
        :folders="folders"
        :pages="pages"
        :buttons="buttons"
        :own-states="ownStates"
        :own-button-id="ownButtonId"
        :load-options="loadOptions"
        :load-shape="loadShape"
        :load-widget-params="loadWidgetParams"
        :filled-secrets="filledSecrets"
        :save-secret="saveSecret"
        :clear-secret="clearSecret"
        @update="setParams(index, $event)"
      />

      <!-- The branches, each drawn by this same component. An empty one still
           shows its head, because that head is where a first step is aimed. -->
      <template v-if="isBlock(step.type)">
        <div v-for="branch in BRANCHES[step.type]" :key="branch" class="branch">
          <span class="branch-name">{{ branchLabel(step.type, branch) }}</span>

          <ScriptSteps
            v-if="(step.branches?.[branch]?.length ?? 0) > 0"
            :steps="step.branches![branch]!"
            :path="branchPath(index, branch)"
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
            @open="emit('open', $event)"
            @update="(path, next) => emit('update', path, next)"
            @remove="emit('remove', $event)"
            @duplicate="emit('duplicate', $event)"
            @insert="(list, at, type) => emit('insert', list, at, type)"
            @move="(from, list, at) => emit('move', from, list, at)"
            @dragging="emit('dragging', $event)"
            @over="(list, at) => emit('over', list, at)"
            @configure-plugin="emit('configurePlugin', $event)"
          />

          <p
            v-else
            class="muted empty-branch"
            :class="{ over: samePath(dropList, branchPath(index, branch)) }"
            @dragover="onBranchDragOver(index, branch, $event)"
            @drop.prevent="onDrop($event)"
          >
            {{ t('editor.blocks.dropHere') }}
          </p>
        </div>
      </template>
    </li>
  </ol>
</template>

<style scoped>
.steps {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 4px;
}

/* Indented and ruled, so what belongs to a block is visible without reading
   it — the one thing a nested editor has to get right. */
.steps.nested {
  margin: 2px 0 2px 10px;
  padding-left: 8px;
  border-left: 2px solid var(--border-strong);
}

li {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-1);
}

li.block {
  background: var(--surface-2);
}

li.dragging {
  opacity: 0.4;
}

li.drop-before {
  box-shadow: inset 0 2px 0 var(--accent);
}

li.drop-after {
  box-shadow: inset 0 -2px 0 var(--accent);
}

.head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
}

.handle {
  cursor: grab;
  color: var(--text-muted);
  user-select: none;
}

.title {
  flex: 1;
  display: flex;
  gap: 8px;
  align-items: baseline;
  background: none;
  border: none;
  text-align: left;
  color: inherit;
  cursor: pointer;
  min-width: 0;
}

.summary {
  color: var(--text-muted);
  font-size: 0.85em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.controls {
  display: flex;
  align-items: center;
  gap: 2px;
}

.controls button {
  padding: 2px 6px;
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
}

.controls .remove:hover {
  color: var(--danger);
}

.chevron {
  transition: transform 0.12s;
}

.chevron.open {
  transform: rotate(180deg);
}

.lamp {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-muted);
}

.lamp.ready {
  background: var(--ok);
}

.lamp.error {
  background: var(--danger);
}

.fields {
  padding: 0 8px 8px;
}

/*
 * The room around an expanded step's fields.
 *
 * The row itself has no padding — the head sets its own, so that a nested list
 * can sit flush against the left edge — which left ActionParams drawing its
 * fields hard against the border. It belongs to another component, hence the
 * reach through: the space around it is this list's to give, not that
 * component's to assume.
 */
:deep(.params) {
  padding: 0 8px 8px;
}

.fields.row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: flex-end;
}

.fields label {
  display: grid;
  gap: 2px;
  font-size: 0.85em;
}

.branch {
  padding: 0 6px 6px;
}

.branch-name {
  font-size: 0.8em;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.empty-branch {
  margin: 2px 0 2px 10px;
  padding: 6px 8px;
  border: 1px dashed var(--border-strong);
  border-radius: 8px;
  font-size: 0.85em;
}

.empty-branch.over {
  border-color: var(--accent);
  color: var(--text);
}
</style>

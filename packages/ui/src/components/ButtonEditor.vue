<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type {
  ButtonDefinition,
  ButtonStateDefinition,
  IconSpec,
  LibraryImage,
  LocalizedText,
  PluginManifest,
  StateRange,
  VariableDeclaration,
  VariableType,
} from '@easydeck/core';

import { isStateRange } from '@easydeck/engine/profile';
import { renderTemplate } from '@easydeck/engine/template';

import IconPicker from './IconPicker.vue';
import { TEXT_POSITIONS, textPositionIcon } from '../icons/text-position.js';
import KeyLabel from './KeyLabel.vue';
import MacroEditor from './MacroEditor.vue';
import PluginList from './PluginList.vue';
import VariablePicker from './VariablePicker.vue';

const props = defineProps<{
  button: ButtonDefinition;
  plugins: readonly PluginManifest[];
  /** Live values, so the preview can show what a label will actually say. */
  variables: Readonly<Record<string, string | number | boolean>>;
  folders: readonly { id: string; name: string }[];
  pages: readonly { id: string; name: string }[];
  /** Buttons of the current page — what set-button-state can target. */
  buttons: readonly { id: string; name: string; states: readonly string[] }[];
  /** Declared variables, which is what a state can be bound to. */
  declarations: readonly VariableDeclaration[];
  /** The user's icon folder, already read by the host. */
  userIcons: readonly LibraryImage[];
  /** Pictures the folder holds but the library had no room for. */
  omittedIcons?: number;
  /** Where each plugin that holds a connection has got to. */
  pluginStatuses?: Readonly<Record<string, { status: string; message?: LocalizedText }>>;
}>();

const emit = defineEmits<{
  save: [button: ButtonDefinition];
  cancel: [];
  /** Passed up from a macro step to whoever can open a plugin's settings. */
  configurePlugin: [pluginId: string];
}>();

const { t } = useI18n();

/**
 * Edited on a copy, so Cancel really cancels.
 *
 * Copied through JSON rather than structuredClone: a button *is* JSON — that
 * is how profiles are stored — and structuredClone throws outright on a Vue
 * reactive proxy, which is easy to hand it by accident.
 */
const draft = ref<ButtonDefinition>(JSON.parse(JSON.stringify(props.button)) as ButtonDefinition);
const stateIndex = ref(0);
const dragState = ref<number | undefined>();
const dropState = ref<number | undefined>();

const state = computed<ButtonStateDefinition>(() => draft.value.states[stateIndex.value]!);

function patchState(change: Partial<ButtonStateDefinition>): void {
  const states = [...draft.value.states];
  states[stateIndex.value] = { ...state.value, ...change };
  draft.value = { ...draft.value, states };
}

function patchVisual(change: Record<string, unknown>): void {
  patchState({ visual: { ...state.value.visual, ...change } });
}

function patchLabel(change: Record<string, unknown>): void {
  const label = { text: '', ...state.value.visual.label, ...change };
  patchVisual({ label: label.text === '' && !change['text'] ? undefined : label });
}

// --- states ---------------------------------------------------------------

function addState(): void {
  const taken = new Set(draft.value.states.map((item) => item.id));
  let id = 'state';
  for (let index = 2; taken.has(id); index++) id = `state-${index}`;

  draft.value = {
    ...draft.value,
    states: [...draft.value.states, { id, visual: { ...state.value.visual } }],
  };
  stateIndex.value = draft.value.states.length - 1;
}

function removeState(): void {
  if (draft.value.states.length <= 1) return;
  const states = draft.value.states.filter((_, index) => index !== stateIndex.value);
  draft.value = { ...draft.value, states };
  stateIndex.value = Math.min(stateIndex.value, states.length - 1);
}

function renameState(id: string): void {
  const trimmed = id.trim();
  if (trimmed.length === 0) return;
  patchState({ id: trimmed });
}

/**
 * Order is not decoration once a number drives the button: the value indexes
 * the states and wraps round, so moving a state changes what a counter shows.
 */
function moveState(from: number, to: number): void {
  if (to < 0 || to >= draft.value.states.length || from === to) return;

  const states = [...draft.value.states];
  const [moved] = states.splice(from, 1);
  states.splice(to, 0, moved!);

  draft.value = { ...draft.value, states };
  stateIndex.value = to;
}

const merged = computed(() => (draft.value.colSpan ?? 1) > 1 || (draft.value.rowSpan ?? 1) > 1);

/**
 * Which gesture the sequence editor is showing.
 *
 * Kept here because dropping an action onto another state's tab has to add it
 * to the same gesture: the question a drop answers is "which state", and the
 * gesture is whatever is already open.
 */
const trigger = ref<'press' | 'longPress' | 'doublePress'>('press');

const ACTION_MIME = 'application/x-easydeck-action';

/**
 * A state tab accepts two things: another tab, and an action.
 *
 * The tab used to light up for an action and then drop it on the floor —
 * it only ever looked at what it was told about reordering.
 */
function onStateDragOver(index: number, event: DragEvent): void {
  const types = event.dataTransfer?.types ?? [];
  if (dragState.value === undefined && !types.includes(ACTION_MIME)) return;

  event.preventDefault();
  dropState.value = index;
}

/**
 * Dropping an action on a state appends it to that state's open gesture.
 *
 * At the end, always: a tab is a place, not a position, and the sequence it
 * belongs to already has an order the user arranged.
 */
function onStateDrop(index: number, event: DragEvent): void {
  const dropped = event.dataTransfer?.getData(ACTION_MIME);
  const from = dragState.value;

  dragState.value = undefined;
  dropState.value = undefined;

  if (!dropped) {
    if (from !== undefined) moveState(from, index);
    return;
  }

  let type: string;
  try {
    ({ type } = JSON.parse(dropped) as { type: string });
  } catch {
    return;
  }
  if (!type) return;

  const states = draft.value.states.map((item, position) => {
    if (position !== index) return item;

    const actions = item.actions ?? {};
    return {
      ...item,
      actions: { ...actions, [trigger.value]: [...(actions[trigger.value] ?? []), { type }] },
    };
  });

  draft.value = { ...draft.value, states };
  // Shown straight away: a step added to a state you cannot see is a step
  // nobody believes happened.
  stateIndex.value = index;
}

/** Which state's name is being typed, if any. */
const renaming = ref<number | undefined>();

/** Escape leaves the editor, unless it is busy dismissing something smaller. */
function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
  if (renaming.value !== undefined) {
    renaming.value = undefined;
    return;
  }

  emit('cancel');
}

onMounted(() => window.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));
const renameField = ref<HTMLInputElement[] | HTMLInputElement>();

async function startRename(index: number): Promise<void> {
  renaming.value = index;
  await nextTick();

  // `v-for` gives an array of refs even when only one is rendered.
  const field = Array.isArray(renameField.value) ? renameField.value[0] : renameField.value;
  field?.select();
}

/**
 * Sets or clears the picture, and drops the background colour with it.
 *
 * A picture fills the key edge to edge, so a colour underneath is invisible —
 * keeping it would leave a value nobody set on purpose waiting to reappear
 * when the picture came off.
 */
function setPicture(icon: IconSpec | undefined): void {
  patchVisual(icon ? { icon, background: undefined } : { icon: undefined });
}

// --- binding --------------------------------------------------------------

const binding = computed<VariableDeclaration | undefined>(() =>
  props.declarations.find((variable) => variable.name === draft.value.stateFrom),
);

/** Untyped variables still bind — by state name, as they always did. */
const boundType = computed<VariableType | undefined>(() =>
  draft.value.stateFrom ? (binding.value?.type ?? 'string') : undefined,
);

/**
 * Which of the three answers a number-bound state is giving.
 *
 * Derived from what is stored rather than kept beside it: a mode held in its
 * own ref would drift the moment a state is switched or a profile reloaded.
 */
type WhenMode = 'auto' | 'value' | 'range';

const whenMode = computed<WhenMode>(() => {
  const when = state.value.when;
  if (when === undefined) return 'auto';
  return isStateRange(when) ? 'range' : 'value';
});

const range = computed<StateRange>(() =>
  isStateRange(state.value.when) ? state.value.when : {},
);

function setWhenMode(mode: WhenMode): void {
  if (mode === 'auto') patchState({ when: undefined });
  // An empty band rather than a guess at one: it matches everything until an
  // end is typed, which is visible in the preview straight away.
  else if (mode === 'range') patchState({ when: {} });
  else patchState({ when: 0 });
}

/**
 * What is typed in the condition boxes, held here rather than read back out
 * of the draft.
 *
 * The editor repaints while it is open — the preview follows live variables,
 * so a processor gauge redraws it every couple of seconds — and a box whose
 * value is bound straight to the draft gets that value written back over
 * whatever is half-typed. It looked like the field clearing itself as you
 * worked, and it was: the repaint, not the field.
 *
 * Everything else in the panel commits on each keystroke, so a repaint writes
 * back what is already there and nothing is lost. These three cannot, because
 * an empty box mid-edit does not mean "no condition" — so they keep what was
 * typed and hand the draft only what parses.
 */
const whenValue = ref('');
const whenMin = ref('');
const whenMax = ref('');

/** Refilled when the *source* changes, never merely because the draft did. */
watch(
  [stateIndex, whenMode, () => props.button],
  () => {
    const when = state.value.when;

    if (isStateRange(when)) {
      whenMin.value = when.min === undefined ? '' : String(when.min);
      whenMax.value = when.max === undefined ? '' : String(when.max);
      whenValue.value = '';
      return;
    }

    whenValue.value = when === undefined ? '' : String(when);
    whenMin.value = '';
    whenMax.value = '';
  },
  { immediate: true },
);

/**
 * A single value, from a box that may be empty part-way through typing.
 *
 * Empty is stored as zero rather than as "no condition": clearing the box to
 * type a new number would otherwise switch the mode back to automatic and
 * take the box away mid-keystroke.
 */
function setWhenValue(raw: string): void {
  whenValue.value = raw;

  if (boundType.value === 'number') patchState({ when: raw === '' ? 0 : Number(raw) });
  else patchState({ when: raw === '' ? undefined : raw });
}

/** One end of a band; empty means unbounded on that side. */
function setRange(end: 'min' | 'max', raw: string): void {
  if (end === 'min') whenMin.value = raw;
  else whenMax.value = raw;

  const next: { min?: number; max?: number } = { ...range.value };

  if (raw === '') delete next[end];
  else next[end] = Number(raw);

  patchState({ when: next });
}

/**
 * The value written into `when`, kept in the shape the type expects: a boolean
 * variable compared against the string "true" would never match anything.
 */
function setWhen(raw: string): void {
  if (raw === '') {
    patchState({ when: undefined });
    return;
  }

  if (boundType.value === 'boolean') patchState({ when: raw === 'true' });
  else if (boundType.value === 'number') patchState({ when: Number(raw) });
  else patchState({ when: raw });
}

/**
 * Emitted as plain data: `draft` is a reactive proxy, and a proxy that
 * reaches the profile cannot be sent to the deck at all.
 */
function save(): void {
  emit('save', JSON.parse(JSON.stringify(draft.value)) as ButtonDefinition);
}

/** Inserts a placeholder into the label where the caret is. */
const labelField = ref<HTMLTextAreaElement>();

function insertVariable(name: string): void {
  const token = `{{${name}}}`;
  const element = labelField.value;
  const text = state.value.visual.label?.text ?? '';

  if (!element) {
    patchLabel({ text: `${text}${token}` });
    return;
  }

  const start = element.selectionStart ?? text.length;
  const end = element.selectionEnd ?? start;
  patchLabel({ text: `${text.slice(0, start)}${token}${text.slice(end)}` });

  void nextTick(() => {
    element.focus();
    element.selectionStart = start + token.length;
    element.selectionEnd = start + token.length;
  });
}

// --- preview --------------------------------------------------------------

/**
 * Taken from the draft, not from the saved button: renaming a state should
 * offer the new name straight away.
 */
const ownStates = computed(() => draft.value.states.map((item) => item.id));

/**
 * Substituted with the engine's own templating, not a copy of it.
 *
 * The field above stays the template — that is what is being edited — while
 * the preview shows what the key will actually read, which is the only thing
 * anyone can judge a label by.
 */
const preview = computed(() => {
  const label = state.value.visual.label;

  return {
    background: state.value.visual.background ?? '#111318',
    label: label ? { ...label, text: renderTemplate(label.text, props.variables) } : undefined,
  };
});
</script>

<template>
  <!-- Full screen, so there is no "outside" left to click: Escape is the way
       out, and it is bound to the window rather than to the dialog because a
       full-screen dialog is never itself the focused element. -->
  <div class="backdrop">
    <div class="dialog" role="dialog" aria-modal="true">
      <header>
        <h2>{{ t('editor.title') }}</h2>
        <button type="button" class="close" :aria-label="t('settings.close')" @click="emit('cancel')">
          ✕
        </button>
      </header>

      <div class="states">
        <span
          v-for="(item, index) in draft.states"
          :key="index"
          class="state"
          :class="{ current: index === stateIndex, over: dropState === index }"
          draggable="true"
          @dragstart="dragState = index"
          @dragover="onStateDragOver(index, $event)"
          @dragleave="dropState = undefined"
          @dragend="dragState = undefined; dropState = undefined"
          @drop.prevent="onStateDrop(index, $event)"
        >
          <!-- The name is edited where the state lives, rather than in a field
               further down the form: it names this tab, and a tab is the one
               place you already look for it. -->
          <input
            v-if="renaming === index"
            ref="renameField"
            type="text"
            class="rename"
            :value="item.id"
            @keydown.enter="($event.target as HTMLInputElement).blur()"
            @keydown.esc="renaming = undefined"
            @blur="renameState(($event.target as HTMLInputElement).value); renaming = undefined"
          />
          <template v-else>
            <button type="button" class="name" :title="t('editor.reorderStates')" @click="stateIndex = index">
              {{ item.id }}
            </button>
            <button
              v-if="index === stateIndex"
              type="button"
              class="pencil"
              :title="t('editor.stateId')"
              @click="startRename(index)"
            >
              ✎
            </button>
          </template>
        </span>
        <button type="button" class="state add" :title="t('editor.addState')" @click="addState">
          ＋
        </button>
      </div>

      <div class="body">
        <section class="look">
          <h3>{{ t('editor.appearance') }}</h3>

          <div
            class="preview"
            :style="{ background: preview.background }"
          >
            <img
              v-if="state.visual.icon"
              class="preview-icon"
              :src="state.visual.icon.source"
              alt=""
            />
            <!-- The same component the grid uses, so the preview cannot
                 drift from what the key will actually look like. -->
            <KeyLabel
              v-if="preview.label"
              :label="preview.label"
              :has-picture="Boolean(state.visual.icon)"
            />
          </div>

          <label class="field">
            <span>{{ t('editor.text') }}</span>
            <!-- Colour, text and the variable list share one row, so the list
                 opens across all three rather than under the field alone. -->
            <VariablePicker
              :values="variables"
              :declarations="declarations"
              @pick="insertVariable($event)"
            >
              <input
                type="color"
                class="swatch"
                :title="t('editor.textColor')"
                :value="state.visual.label?.color ?? '#ffffff'"
                @input="patchLabel({ color: ($event.target as HTMLInputElement).value })"
              />
              <!-- A textarea, because a key's label is not one line.
                   Where the text breaks is part of how a key looks — "Сцена"
                   over "Ожидание" reads at a glance where one wrapped line
                   does not — and the engine has always honoured a newline;
                   there was simply no way to type one. Two rows by default,
                   draggable taller, and Enter breaks the line rather than
                   doing anything clever. -->
              <textarea
                ref="labelField"
                class="grow label-text"
                rows="2"
                :value="state.visual.label?.text ?? ''"
                @input="patchLabel({ text: ($event.target as HTMLTextAreaElement).value })"
              ></textarea>
            </VariablePicker>
          </label>

          <!-- Size and position, unlabelled: both are plainly about the text
               above them, and a picture of a key with a bar in it says where
               the text goes faster than the words would. -->
          <div class="row">
            <input
              type="number"
              class="size"
              min="6"
              max="60"
              :title="t('editor.fontSize')"
              :value="state.visual.label?.fontSize ?? 22"
              @input="patchLabel({ fontSize: Number(($event.target as HTMLInputElement).value) })"
            />

            <span class="positions">
              <button
                v-for="place in TEXT_POSITIONS"
                :key="place"
                type="button"
                class="position"
                :class="{ current: (state.visual.label?.position ?? 'center') === place }"
                :title="t(`editor.positions.${place}`)"
                :aria-label="t(`editor.positions.${place}`)"
                @click="patchLabel({ position: place })"
                v-html="textPositionIcon(place)"
              />
            </span>
          </div>

          <label class="field">
            <span>{{ t('editor.background') }}</span>
            <span class="row">
              <!-- A picture covers the key edge to edge, so a colour behind it
                   is a setting with nothing to show for it. -->
              <input
                v-if="!state.visual.icon"
                type="color"
                class="swatch"
                :title="t('editor.background')"
                :value="state.visual.background ?? '#111318'"
                @input="patchVisual({ background: ($event.target as HTMLInputElement).value })"
              />

              <IconPicker
                :icon="state.visual.icon"
                :color="state.visual.label?.color ?? '#ffffff'"
                :user-icons="userIcons"
                :omitted-icons="omittedIcons"
                @update="setPicture($event)"
              />
            </span>
          </label>

          <p v-if="merged" class="muted desc">{{ t('editor.spanHint') }}</p>

          <label class="field">
            <span>{{ t('editor.stateFrom') }}</span>
            <select
              :value="draft.stateFrom ?? ''"
              @change="
                draft = {
                  ...draft,
                  stateFrom: ($event.target as HTMLSelectElement).value || undefined,
                }
              "
            >
              <option value="">{{ t('editor.stateFromHint') }}</option>
              <option v-for="variable in declarations" :key="variable.name" :value="variable.name">
                {{ variable.name }} — {{ t(`variables.types.${variable.type}`) }}
              </option>
            </select>
          </label>

          <!--
            What this particular state answers to. Shown only when bound,
            because on an unbound button it would be a field with no meaning,
            and the control follows the variable's type so the value written is
            one the engine can actually match.
          -->
          <label v-if="boundType" class="field">
            <span>{{ t('editor.showWhen') }}</span>

            <select
              v-if="boundType === 'boolean'"
              :value="state.when === undefined ? '' : String(state.when)"
              @change="setWhen(($event.target as HTMLSelectElement).value)"
            >
              <option value="">{{ t('editor.whenAuto') }}</option>
              <option value="false">{{ t('editor.whenFalse') }}</option>
              <option value="true">{{ t('editor.whenTrue') }}</option>
            </select>

            <select
              v-else-if="boundType === 'enum'"
              :value="state.when === undefined ? '' : String(state.when)"
              @change="setWhen(($event.target as HTMLSelectElement).value)"
            >
              <option value="">{{ t('editor.whenAuto') }}</option>
              <option
                v-for="option in binding?.options ?? []"
                :key="option.value"
                :value="option.value"
              >
                {{ option.value }}
              </option>
            </select>

            <!-- A number answers to either one value or a band of them, and
                 the difference is worth a control rather than a convention: a
                 counter wants "exactly 3", a gauge wants "85 and above", and
                 neither is guessable from a single box. -->
            <div v-else-if="boundType === 'number'" class="when">
              <select
                :value="whenMode"
                @change="setWhenMode(($event.target as HTMLSelectElement).value as WhenMode)"
              >
                <option value="auto">{{ t('editor.whenAuto') }}</option>
                <option value="value">{{ t('editor.whenExact') }}</option>
                <option value="range">{{ t('editor.whenRange') }}</option>
              </select>

              <input
                v-if="whenMode === 'value'"
                type="number"
                :value="whenValue"
                @input="setWhenValue(($event.target as HTMLInputElement).value)"
              />

              <template v-else-if="whenMode === 'range'">
                <!-- Either end may be left empty, which is what "90 and above"
                     is: a band open at the top. Both empty matches every
                     number, which is a usable "everything else" when the state
                     is written last. -->
                <input
                  type="number"
                  :placeholder="t('editor.whenFrom')"
                  :value="whenMin"
                  @input="setRange('min', ($event.target as HTMLInputElement).value)"
                />
                <input
                  type="number"
                  :placeholder="t('editor.whenTo')"
                  :value="whenMax"
                  @input="setRange('max', ($event.target as HTMLInputElement).value)"
                />
              </template>
            </div>

            <input
              v-else
              type="text"
              :value="whenValue"
              :placeholder="t('editor.whenAuto')"
              @input="setWhenValue(($event.target as HTMLInputElement).value)"
            />

            <span class="desc">{{ t(`editor.bindingRule.${boundType}`) }}</span>
          </label>

          <button
            v-if="draft.states.length > 1"
            type="button"
            class="danger"
            @click="removeState"
          >
            {{ t('editor.removeState') }}
          </button>
        </section>

        <section class="behaviour">
          <h3>{{ t('editor.behaviour') }}</h3>

          <MacroEditor
            :actions="state.actions ?? {}"
            :trigger="trigger"
            :plugins="plugins"
            :values="variables"
            :declarations="declarations"
            :folders="folders"
            :pages="pages"
            :buttons="buttons"
            :own-states="ownStates"
            :plugin-statuses="pluginStatuses"
            @update="patchState({ actions: $event })"
            @trigger="trigger = $event"
            @configure-plugin="emit('configurePlugin', $event)"
          />
        </section>

        <!-- The same palette the grid has, for the same reason: an action is
             easier to recognise by what it says it does than to find by name
             in a list of everything installed. Dragging one into the sequence
             puts it exactly where it is dropped. -->
        <aside class="palette">
          <h3>{{ t('plugins.title') }}</h3>
          <PluginList :plugins="plugins" />
        </aside>
      </div>

      <footer>
        <button type="button" @click="emit('cancel')">{{ t('prompt.cancel') }}</button>
        <button type="button" class="primary" @click="save">
          {{ t('editor.save') }}
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  background: rgb(0 0 0 / 45%);
  display: grid;
  place-items: center;
  z-index: 25;
}

/*
 * The whole window, not a panel floating in it.
 *
 * Editing a button is the one thing this program is for, and it is about to
 * grow a macro editor — a list of steps, their parameters, the run order —
 * which a 860×660 box cannot hold without everything inside it scrolling
 * separately. Taking the window is also honest about the mode: nothing else
 * can be touched while a button is open anyway.
 */
.dialog {
  display: flex;
  flex-direction: column;
  width: 100vw;
  height: 100vh;
  background: var(--surface-0);
  border: none;
  border-radius: 0;
  overflow: hidden;
}

header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px 10px;
}

h2 { margin: 0; font-size: 15px; }
h3 {
  margin: 0 0 10px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
}

.close { background: none; border: none; color: var(--text-muted); padding: 4px 6px; }

.states {
  display: flex;
  gap: 4px;
  padding: 0 18px 10px;
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
}

.state {
  display: inline-flex;
  align-items: center;
  font-size: 12px;
  background: none;
  border: 1px solid transparent;
  border-radius: 7px;
}

.state .name {
  font: inherit;
  color: inherit;
  background: none;
  border: none;
  padding: 4px 4px 4px 10px;
  cursor: pointer;
}

.state:not(.current) .name {
  padding-right: 10px;
}

/* Only on the open state: renaming one you are not looking at would rename
   something out of sight. */
.state .pencil {
  border: none;
  background: none;
  color: var(--text-muted);
  font-size: 11px;
  padding: 4px 8px 4px 2px;
  cursor: pointer;
}

.state .pencil:hover {
  color: var(--text);
}

.state .rename {
  font: inherit;
  width: 9ch;
  margin: 2px 4px;
  padding: 2px 6px;
}

.state.current { border-color: var(--accent); color: var(--accent); }
.state.add { color: var(--text-muted); }
.state.over { background: var(--accent-soft); border-color: var(--accent); }

.desc {
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.3;
}

.body {
  flex: 1;
  min-height: 0;
  display: grid;
  /* Appearance, the sequence, and the actions to build it from — the middle
     column takes whatever a full-screen window has left over. */
  grid-template-columns: 300px minmax(0, 1fr) 320px;
}

.palette {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-left: 1px solid var(--border);
  padding: 14px 0 0;
}

.palette h3 {
  margin: 0 12px 10px;
}

.look {
  padding: 14px 18px;
  border-right: 1px solid var(--border);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.preview {
  container-type: inline-size;
  width: 112px;
  height: 112px;
  /* Flex items shrink along the main axis by default, so a column that runs
     out of room squashes the preview into a rectangle — and a key preview
     that is not square is worse than no preview at all. */
  flex: none;
  aspect-ratio: 1;
  align-self: center;
  border: 1px solid var(--border);
  border-radius: 12px;
  display: flex;
  overflow: hidden;
  margin-bottom: 4px;
}

.preview { position: relative; }

.preview-icon {
  position: absolute;
  inset: 0;
  /* Both dimensions, or `object-fit` has nothing to fit against. */
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.preview span {
  position: relative;
  flex: 1;
  display: flex;
  justify-content: center;
  padding: 10cqw 5cqw;
  text-align: center;
  line-height: 1.15;
  word-break: break-word;
  font-family: 'EasyDeck Sans', system-ui, sans-serif;
  font-weight: 400;
}

.behaviour { padding: 14px 18px; overflow-y: auto; }

.when {
  display: flex;
  align-items: center;
  gap: 5px;
}

/* The mode picker keeps its own width; the numbers share what is left. */
.when > select {
  flex: none;
}

.when > input {
  flex: 1;
  min-width: 0;
}

.label-text {
  /* Vertical only: the row's other two controls fix the width, and a textarea
     dragged sideways would push them out of the panel. */
  resize: vertical;
  min-height: 2.4em;
  font: inherit;
  line-height: 1.3;
}

.field { display: flex; flex-direction: column; gap: 3px; font-size: 12px; }
.field span { color: var(--text-muted); }
.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; }

/* A label's own controls sit beside it rather than under their own captions:
   what a colour swatch or a position button does is plain from looking. */
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

/*
 * Growing is asked for, not assumed.
 *
 * "Whatever comes first fills the row" caught the number box in the size row
 * and stretched it across half the form; only the text field and the picture
 * button have any use for the space.
 */
.row > :deep(.wrap),
.row > :deep(.picture) {
  flex: 1;
  min-width: 0;
}

/*
 * Written to outweigh the `input[type='color']` rule below.
 *
 * An attribute selector beats a bare class, so `width: 100%` from there won
 * and the swatch stretched across the row, covering the field beside it.
 */
input[type='color'].swatch {
  flex: none;
  width: 30px;
  height: 30px;
  padding: 2px;
  cursor: pointer;
}

.size {
  flex: none;
  width: 5.5em;
}

.positions {
  display: flex;
  gap: 4px;
}

.position {
  width: 30px;
  height: 30px;
  padding: 5px;
  display: grid;
  place-items: center;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface-1);
  /* The icons are drawn in `currentColor`, so the theme's text colour is what
     makes them black on light and white on dark. */
  color: var(--text-muted);
  cursor: pointer;
}

.position:hover {
  color: var(--text);
}

.position.current {
  color: var(--text);
  border-color: var(--accent);
  background: var(--accent-soft);
}

.position :deep(svg) {
  width: 100%;
  height: 100%;
}

input[type='color'] {
  width: 100%;
  flex: none;
  height: 28px;
  padding: 2px;
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: 7px;
}

footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 18px;
  border-top: 1px solid var(--border);
}

.primary { border-color: var(--accent); color: var(--accent); }
.danger { color: var(--danger); align-self: flex-start; font-size: 12px; }
</style>

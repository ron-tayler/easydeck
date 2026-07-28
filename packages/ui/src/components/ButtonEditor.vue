<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type {
  ButtonDefinition,
  ButtonStateDefinition,
  LibraryImage,
  PluginManifest,
  VariableDeclaration,
  VariableType,
} from '@easydeck/core';

import { renderTemplate } from '@easydeck/engine/template';

import IconPicker from './IconPicker.vue';
import MacroEditor from './MacroEditor.vue';
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
}>();

const emit = defineEmits<{ save: [button: ButtonDefinition]; cancel: [] }>();

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

/** Stored only when it is a merge: a span of one is the absence of one. */
function setSpan(field: 'colSpan' | 'rowSpan', raw: string): void {
  const value = Math.max(1, Math.min(8, Math.round(Number(raw) || 1)));
  draft.value = { ...draft.value, [field]: value > 1 ? value : undefined };
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
const labelField = ref<HTMLInputElement>();

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
  <div class="backdrop" @click.self="emit('cancel')">
    <div class="dialog" role="dialog" aria-modal="true">
      <header>
        <h2>{{ t('editor.title') }}</h2>
        <button type="button" class="close" :aria-label="t('settings.close')" @click="emit('cancel')">
          ✕
        </button>
      </header>

      <div class="states">
        <button
          v-for="(item, index) in draft.states"
          :key="index"
          type="button"
          class="state"
          :class="{ current: index === stateIndex, over: dropState === index }"
          draggable="true"
          :title="t('editor.reorderStates')"
          @click="stateIndex = index"
          @dragstart="dragState = index"
          @dragover.prevent="dropState = index"
          @dragleave="dropState = undefined"
          @dragend="dragState = undefined; dropState = undefined"
          @drop.prevent="
            dragState !== undefined && moveState(dragState, index);
            dragState = undefined;
            dropState = undefined;
          "
        >
          {{ item.id }}
        </button>
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
              :style="{
                objectFit: state.visual.icon.fit ?? 'contain',
                height: `${(state.visual.icon.size ?? 1) * 100}%`,
              }"
              alt=""
            />
            <span
              v-if="preview.label"
              :style="{
                color: preview.label.color ?? '#ffffff',
                fontSize: `calc(${preview.label.fontSize ?? 22} * 1cqw * var(--key-label-scale))`,
                alignItems:
                  preview.label.position === 'top'
                    ? 'flex-start'
                    : preview.label.position === 'bottom'
                      ? 'flex-end'
                      : 'center',
              }"
            >
              {{ preview.label.text }}
            </span>
          </div>

          <label class="field">
            <span>{{ t('editor.stateId') }}</span>
            <input type="text" :value="state.id" @change="renameState(($event.target as HTMLInputElement).value)" />
          </label>

          <label class="field">
            <span>{{ t('editor.text') }}</span>
            <VariablePicker
              :values="variables"
              :declarations="declarations"
              @pick="insertVariable($event)"
            >
              <input
                ref="labelField"
                type="text"
                :value="state.visual.label?.text ?? ''"
                @input="patchLabel({ text: ($event.target as HTMLInputElement).value })"
              />
            </VariablePicker>
          </label>

          <div class="pair">
            <label class="field">
              <span>{{ t('editor.background') }}</span>
              <input
                type="color"
                :value="state.visual.background ?? '#111318'"
                @input="patchVisual({ background: ($event.target as HTMLInputElement).value })"
              />
            </label>

            <label class="field">
              <span>{{ t('editor.textColor') }}</span>
              <input
                type="color"
                :value="state.visual.label?.color ?? '#ffffff'"
                @input="patchLabel({ color: ($event.target as HTMLInputElement).value })"
              />
            </label>
          </div>

          <!--
            Merging, as in a spreadsheet: only the picture spreads. The keys
            underneath keep their own buttons, so this sits with the appearance
            settings rather than with behaviour.
          -->
          <div class="pair">
            <label class="field">
              <span>{{ t('editor.colSpan') }}</span>
              <input
                type="number"
                min="1"
                max="8"
                :value="draft.colSpan ?? 1"
                @input="setSpan('colSpan', ($event.target as HTMLInputElement).value)"
              />
            </label>

            <label class="field">
              <span>{{ t('editor.rowSpan') }}</span>
              <input
                type="number"
                min="1"
                max="8"
                :value="draft.rowSpan ?? 1"
                @input="setSpan('rowSpan', ($event.target as HTMLInputElement).value)"
              />
            </label>
          </div>

          <p v-if="merged" class="muted desc">{{ t('editor.spanHint') }}</p>

          <IconPicker
            :icon="state.visual.icon"
            :color="state.visual.label?.color ?? '#ffffff'"
            :user-icons="userIcons"
            @update="patchVisual({ icon: $event })"
          />

          <div class="pair">
            <label class="field">
              <span>{{ t('editor.fontSize') }}</span>
              <input
                type="number"
                min="6"
                max="60"
                :value="state.visual.label?.fontSize ?? 22"
                @input="patchLabel({ fontSize: Number(($event.target as HTMLInputElement).value) })"
              />
            </label>

            <label class="field">
              <span>{{ t('editor.position') }}</span>
              <select
                :value="state.visual.label?.position ?? 'center'"
                @change="patchLabel({ position: ($event.target as HTMLSelectElement).value })"
              >
                <option value="top">{{ t('editor.positions.top') }}</option>
                <option value="center">{{ t('editor.positions.center') }}</option>
                <option value="bottom">{{ t('editor.positions.bottom') }}</option>
              </select>
            </label>
          </div>

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

            <input
              v-else
              :type="boundType === 'number' ? 'number' : 'text'"
              :value="state.when === undefined ? '' : String(state.when)"
              :placeholder="t('editor.whenAuto')"
              @change="setWhen(($event.target as HTMLInputElement).value)"
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
            :plugins="plugins"
            :values="variables"
            :declarations="declarations"
            :folders="folders"
            :pages="pages"
            :buttons="buttons"
            :own-states="ownStates"
            @update="patchState({ actions: $event })"
          />
        </section>
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

.dialog {
  display: flex;
  flex-direction: column;
  width: min(860px, 94vw);
  height: min(660px, 92vh);
  background: var(--surface-0);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 18px 48px var(--shadow);
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
  font-size: 12px;
  padding: 4px 10px;
  background: none;
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
  grid-template-columns: 260px minmax(0, 1fr);
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
  width: 100%;
  margin: auto;
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

.field { display: flex; flex-direction: column; gap: 3px; font-size: 12px; }
.field span { color: var(--text-muted); }
.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; }

input[type='color'] {
  width: 100%;
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

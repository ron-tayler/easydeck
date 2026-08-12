<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type {
  ButtonDefinition,
  ButtonStateDefinition,
  IconBinding,
  IconSpec,
  LibraryImage,
  LocalizedText,
  PluginManifest,
  StateRange,
  VariableArgument,
  VariableDeclaration,
  VariableType,
} from '@easydeck/core';

import { isStateRange } from '@easydeck/engine/profile';
import {
  drawableIcon,
  iconParamsProblem,
  readIconParams,
  resolveIconParams,
  svgTextOf,
} from '@easydeck/engine/icons';
import { parseVariableKey, variableKey } from '@easydeck/engine/variables';
import { renderTemplate } from '@easydeck/engine/template';

import IconParams from './IconParams.vue';
import IconPicker from './IconPicker.vue';
import { TEXT_POSITIONS, textPositionIcon } from '../icons/text-position.js';
import KeyLabel from './KeyLabel.vue';
import MacroEditor from './MacroEditor.vue';
import ColorPicker from './ColorPicker.vue';
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
  /** Asks a plugin for the choices behind one of its `optionsFrom` parameters. */
  loadOptions?: (
    pluginId: string,
    source: string,
    params: Readonly<Record<string, unknown>>,
  ) => Promise<readonly { value: string; label?: LocalizedText }[]>;
  /** Passed through to a password field; the value never comes back. */
  filledSecrets?: readonly string[];
  saveSecret?: (value: string, reference?: string) => Promise<string>;
  clearSecret?: (reference: string) => Promise<void>;
}>();

const emit = defineEmits<{
  save: [button: ButtonDefinition];
  cancel: [];
  /** Passed up from a macro step to whoever can open a plugin's settings. */
  configurePlugin: [pluginId: string];
}>();

const { t, locale } = useI18n();

/** A plugin's own words, in the best language it offered. */
const say = (text: LocalizedText | undefined): string =>
  text === undefined ? '' : (text[locale.value] ?? text.en);

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

// --- the button's script, and the states that differ from it ---------------

/**
 * Which state actually holds the script being shown.
 *
 * The first one, unless this state has claimed its own. Having every state
 * carry a script made a two-state button twice the work and twice the thing
 * to keep in step — and the usual case is a key that looks different when the
 * mic is muted while doing the same thing on a press.
 */
const scriptOwner = computed<number>(() =>
  stateIndex.value === 0 || state.value.ownActions === true ? stateIndex.value : 0,
);

const script = computed(() => draft.value.states[scriptOwner.value]?.actions ?? {});

function setScript(actions: NonNullable<ButtonStateDefinition['actions']>): void {
  const states = [...draft.value.states];
  const at = scriptOwner.value;
  states[at] = { ...states[at]!, actions };
  draft.value = { ...draft.value, states };
}

/**
 * Turns a state's own script on or off.
 *
 * Switching it on copies what was being followed, so the panel does not empty
 * the moment somebody ticks the box: they asked to differ from the button's
 * script, not to throw it away and start again.
 *
 * Switching it off leaves that copy in the state, unused. It costs a few lines
 * in the profile and means the box can be un-ticked and re-ticked without the
 * work in between being lost.
 */
function setOwnScript(own: boolean): void {
  if (!own) {
    patchState({ ownActions: false });
    return;
  }

  const inherited = draft.value.states[0]?.actions;
  patchState({
    ownActions: true,
    ...(state.value.actions === undefined && inherited
      ? { actions: JSON.parse(JSON.stringify(inherited)) as NonNullable<ButtonStateDefinition['actions']> }
      : {}),
  });
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
const trigger = ref<'press' | 'longPress' | 'doublePress' | 'event'>('press');

const ACTION_MIME = 'application/x-easydeck-action';
/** A step carried out of the sequence below, with enough of it to rebuild. */
const STEP_PAYLOAD_MIME = 'application/x-easydeck-step-payload';

/**
 * A state tab accepts three things: another tab, a new action, and a step
 * being carried out of the sequence below.
 *
 * The tab used to light up for an action and then drop it on the floor —
 * it only ever looked at what it was told about reordering.
 */
function onStateDragOver(index: number, event: DragEvent): void {
  const types = event.dataTransfer?.types ?? [];
  const carried = types.includes(ACTION_MIME) || types.includes(STEP_PAYLOAD_MIME);
  if (dragState.value === undefined && !carried) return;

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
  const carried = event.dataTransfer?.getData(STEP_PAYLOAD_MIME);
  const from = dragState.value;

  dragState.value = undefined;
  dropState.value = undefined;

  if (carried) {
    moveStep(index, carried);
    return;
  }

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
/**
 * The name as it is being typed, held here rather than read off the draft.
 *
 * Bound straight to the state, the field was rewritten with the stored name
 * on every repaint — and the editor repaints whenever a variable ticks over,
 * which with a gauge on the deck is every couple of seconds. It looked like
 * the field undoing what you typed, letter by letter.
 *
 * The same shape the condition boxes already use, and for the same reason:
 * these commit when you leave them, so between the first keystroke and that
 * moment the field is the only place the new name exists.
 */
const renameDraft = ref('');

async function startRename(index: number): Promise<void> {
  renaming.value = index;
  renameDraft.value = draft.value.states[index]?.id ?? '';
  await nextTick();

  // `v-for` gives an array of refs even when only one is rendered.
  const field = Array.isArray(renameField.value) ? renameField.value[0] : renameField.value;
  field?.select();
}

/**
 * Carries a step from the state being edited to another one.
 *
 * A move rather than a copy: dragging a step onto a tab is the gesture for
 * "it belongs over there", and leaving it behind as well would mean pressing
 * the key runs it twice, once per state, with nothing on screen to say why.
 *
 * It lands at the end of the same gesture it came from. A tab is a place, not
 * a position, and that state's sequence already has an order somebody chose.
 */
function moveStep(target: number, payload: string): void {
  let carried: { trigger: string; index: number; action: Record<string, unknown> };
  try {
    carried = JSON.parse(payload) as typeof carried;
  } catch {
    return;
  }

  const source = stateIndex.value;
  if (target === source) return;

  const gesture = carried.trigger as 'press' | 'longPress' | 'doublePress' | 'event';

  const states = draft.value.states.map((item, position) => {
    const actions = item.actions ?? {};

    if (position === source) {
      const remaining = (actions[gesture] ?? []).filter((_, at) => at !== carried.index);
      return { ...item, actions: { ...actions, [gesture]: remaining } };
    }

    if (position === target) {
      const sequence = actions[gesture] ?? [];
      return {
        ...item,
        actions: { ...actions, [gesture]: [...sequence, carried.action as never] },
      };
    }

    return item;
  });

  draft.value = { ...draft.value, states };
}

// --- a picture that answers to a variable ---------------------------------

const iconParamsOpen = ref(false);

/**
 * Whether the picture has anything to say about itself — or tried to.
 *
 * A broken declaration counts. Hiding the gear when the metadata will not
 * parse leaves somebody staring at an icon they just wrote, with no way to
 * tell "declares nothing" from "declares something with a comma in the wrong
 * place"; the window says which.
 */
const iconIsParametric = computed(() => {
  const source = state.value.visual.icon?.source;
  if (!source) return false;

  const svg = svgTextOf(source) ?? '';
  return readIconParams(svg).length > 0 || iconParamsProblem(svg) !== undefined;
});

function setIconParams(params: Record<string, IconBinding>): void {
  const icon = state.value.visual.icon;
  if (!icon) return;

  // An empty set is stored as absent: a profile should not carry a field
  // saying that nothing was configured.
  patchVisual({
    icon: Object.keys(params).length > 0 ? { ...icon, params } : { source: icon.source },
  });
}

/**
 * Sets or clears the picture, and leaves the background colour alone.
 *
 * Choosing a picture used to throw the colour away, on the grounds that a
 * picture fills the key edge to edge and hides whatever is under it. That is
 * true of a photograph and false of everything else: a library icon is a glyph
 * on transparency, so what was actually hidden was the colour, and every such
 * key has been a white mark on black since — the one arrangement nobody chose.
 */
function setPicture(icon: IconSpec | undefined): void {
  patchVisual(icon ? { icon } : { icon: undefined });
}

// --- binding --------------------------------------------------------------

/**
 * The declaration behind the binding, found by family rather than by key.
 *
 * `obs.mute(Микрофон)` is declared once as `obs.mute`, so the whole key would
 * match nothing — and without the declaration the state editor would not know
 * the variable is a boolean and would offer the wrong control for `when`.
 */
const binding = computed<VariableDeclaration | undefined>(() => {
  const name = draft.value.stateFrom;
  if (!name) return undefined;

  const { family } = parseVariableKey(name);
  return props.declarations.find((variable) => variable.name === family);
});

/** The family part of the binding, which is what the list above holds. */
const boundFamily = computed(() =>
  draft.value.stateFrom ? parseVariableKey(draft.value.stateFrom).family : '',
);

/** Each level of argument the chosen family asks for: usually none, rarely two. */
const boundArguments = computed<VariableArgument[]>(() => {
  const levels: VariableArgument[] = [];
  let argument = binding.value?.argument;

  while (argument) {
    levels.push(argument);
    argument = argument.then;
  }

  return levels;
});

/** What has been filled in for each level, split back out of the key. */
const boundArgumentValues = computed<string[]>(() => {
  const name = draft.value.stateFrom;
  if (!name) return [];

  const { argument } = parseVariableKey(name);
  if (argument === undefined || argument === '') return [];

  return argument.split(',').map((part) => part.trim());
});

/** Choices for one level, loaded from the plugin the family belongs to. */
const argumentOptions = ref<Record<number, readonly { value: string; label?: LocalizedText }[]>>({});

const argumentChoices = (level: number): readonly { value: string; label?: LocalizedText }[] =>
  argumentOptions.value[level] ?? [];

/**
 * Asks the plugin what may go in each level, passing what came before.
 *
 * The second level depends on the first — which sources a scene holds — so
 * the earlier answer travels as `argument`, the name a family's loader
 * expects when there are no action parameters to name.
 */
async function loadArgumentOptions(): Promise<void> {
  const family = boundFamily.value;
  const pluginId = binding.value?.pluginId;
  if (!family || !pluginId || !props.loadOptions) {
    argumentOptions.value = {};
    return;
  }

  const loaded: Record<number, readonly { value: string; label?: LocalizedText }[]> = {};

  for (const [level, argument] of boundArguments.value.entries()) {
    if (!argument.optionsFrom) continue;

    try {
      loaded[level] = await props.loadOptions(pluginId, argument.optionsFrom, {
        argument: boundArgumentValues.value[level - 1] ?? '',
      });
    } catch {
      loaded[level] = [];
    }
  }

  argumentOptions.value = loaded;
}

watch([boundFamily, () => boundArgumentValues.value.join(',')], () => void loadArgumentOptions(), {
  immediate: true,
});

/** Switching family clears whatever was filled in for the old one. */
function setFamily(family: string): void {
  draft.value = { ...draft.value, stateFrom: family || undefined };
}

/** Rebuilds the key from its parts, so the profile stores one plain string. */
function setArgument(level: number, value: string): void {
  const parts = [...boundArgumentValues.value];
  parts[level] = value;

  // Levels after this one described something inside the old value, so they
  // are dropped: the sources of one scene are not the sources of another.
  const kept = parts.slice(0, level + 1).filter((part) => part !== undefined && part !== '');

  draft.value = {
    ...draft.value,
    stateFrom: variableKey(boundFamily.value, kept.join(', ')),
  };
}

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

/**
 * The label field takes the height of what is in it.
 *
 * Measured rather than counted from the newlines: a line long enough to wrap
 * takes two rows on screen whether or not anybody pressed Enter, and a field
 * sized by Enter presses alone would hide it. The border is added back because
 * `scrollHeight` is the content and its padding, while the height being set is
 * the whole box.
 *
 * The floor of two rows costs nothing here: `height: auto` on a textarea falls
 * back to its `rows`, so the measurement never comes out shorter than that.
 */
function fitLabel(): void {
  const field = labelField.value;
  if (!field) return;

  field.style.height = 'auto';
  field.style.height = `${field.scrollHeight + field.offsetHeight - field.clientHeight}px`;
}

function onLabelInput(text: string): void {
  patchLabel({ text });
  fitLabel();
}

// Switching state, or opening the editor at all, brings other text with it.
watch(() => state.value.visual.label?.text, () => void nextTick(fitLabel));
onMounted(fitLabel);

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

/**
 * The picture with its parameters filled in, which is what the key will show.
 *
 * The stored source is the template — a needle at its default angle, a bar
 * empty — and showing that in the preview meant the one thing a parametric
 * icon is for was the one thing the editor could not demonstrate. Wiring a
 * gauge up and watching the preview stay still reads as the wiring having
 * failed.
 *
 * Same call the panel and the grid make, over the same text: an editor that
 * substituted differently would be a fourth opinion about what an icon looks
 * like.
 */
const previewIcon = computed(() => {
  const icon = state.value.visual.icon;
  if (!icon) return undefined;

  const svg = svgTextOf(icon.source);
  if (svg === undefined) return icon.source;

  return drawableIcon({
    ...icon,
    values: resolveIconParams(readIconParams(svg), icon.params, props.variables),
  });
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
            :value="renameDraft"
            @input="renameDraft = ($event.target as HTMLInputElement).value"
            @keydown.enter="($event.target as HTMLInputElement).blur()"
            @keydown.esc="renaming = undefined"
            @blur="renameState(renameDraft); renaming = undefined"
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

          <!--
            The key beside the three things there are to change about it.
            Centred, the preview left the column beside it empty and put every
            control below the fold; against the left edge it pays for itself
            twice, as a picture of the key and as the width the buttons need.
          -->
          <div class="look-top">
            <div
              class="preview"
              :style="{ background: preview.background }"
            >
              <img v-if="previewIcon" class="preview-icon" :src="previewIcon" alt="" />
              <!-- The same component the grid uses, so the preview cannot
                   drift from what the key will actually look like. -->
              <KeyLabel
                v-if="preview.label"
                :label="preview.label"
                :has-picture="Boolean(state.visual.icon)"
              />
            </div>

            <!--
              All three always here, none in place of another. The colour used
              to disappear the moment a picture was chosen, which read as the
              two being alternatives — they are not, and a picture with any
              transparency in it has been sitting on plain black ever since.
            -->
            <div class="look-tools">
              <ColorPicker
                :label="t('editor.look.background')"
                :model-value="state.visual.background"
                fallback="#111318"
                :title="t('editor.background')"
                @update:model-value="patchVisual({ background: $event })"
              />

              <IconPicker
                :label="t('editor.look.picture')"
                :icon="state.visual.icon"
                :user-icons="userIcons"
                :omitted-icons="omittedIcons"
                @update="setPicture($event)"
              >
                <!-- Only where the picture asks for it: an ordinary icon
                     declares no parameters, so the gear is absent from almost
                     every key. -->
                <template #tools>
                  <button
                    v-if="iconIsParametric"
                    type="button"
                    class="icon-gear"
                    :title="t('editor.iconParams')"
                    :aria-label="t('editor.iconParams')"
                    @click="iconParamsOpen = true"
                  >
                    ⚙
                  </button>
                </template>
              </IconPicker>

              <ColorPicker
                :label="t('editor.look.text')"
                :model-value="state.visual.label?.color"
                fallback="#ffffff"
                :title="t('editor.textColor')"
                @update:model-value="patchLabel({ color: $event })"
              />
            </div>
          </div>

          <label class="field">
            <span>{{ t('editor.text') }}</span>
            <!-- The text and the variable list share one row, so the list
                 opens across both rather than under the field alone. -->
            <VariablePicker
              :values="variables"
              :declarations="declarations"
              @pick="insertVariable($event)"
            >
              <!-- A textarea, because a key's label is not one line.
                   Where the text breaks is part of how a key looks — "Сцена"
                   over "Ожидание" reads at a glance where one wrapped line
                   does not — and the engine has always honoured a newline;
                   there was simply no way to type one. It takes the height of
                   what is in it: a handle to drag was one more thing to get
                   right about a field whose correct height is never in
                   question. -->
              <textarea
                ref="labelField"
                class="grow label-text"
                rows="2"
                :value="state.visual.label?.text ?? ''"
                @input="onLabelInput(($event.target as HTMLTextAreaElement).value)"
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

          <p v-if="merged" class="muted desc">{{ t('editor.spanHint') }}</p>

          <!-- Above the line the key is being drawn; below it, the key is being
               wired to a variable. Two jobs in one column, and the only thing
               that said so was the order they happened to be in. -->
          <hr class="divider" />

          <label class="field">
            <span>{{ t('editor.stateFrom') }}</span>
            <select :value="boundFamily" @change="setFamily(($event.target as HTMLSelectElement).value)">
              <option value="">{{ t('editor.stateFromHint') }}</option>
              <option v-for="variable in declarations" :key="variable.name" :value="variable.name">
                {{ variable.name }}<template v-if="variable.argument">(…)</template> —
                {{ t(`variables.types.${variable.type}`) }}
              </option>
            </select>
          </label>

          <!--
            The argument of a family, asked for as its own field rather than
            typed into the name.

            A plugin's variable may name something in another program —
            `obs.mute(Микрофон)` — and the list above holds one row for the
            family, not one per microphone. Turning the whole thing into a
            text box would have cost every ordinary variable its list to give
            these one; a second field costs nothing to anybody who never
            picks a family, because it is not there.
          -->
          <label v-for="(argument, level) in boundArguments" :key="level" class="field">
            <span>{{ say(argument.label) }}</span>

            <select
              v-if="argumentChoices(level).length > 0"
              :value="boundArgumentValues[level] ?? ''"
              @change="setArgument(level, ($event.target as HTMLSelectElement).value)"
            >
              <option value="" disabled>{{ t('editor.choose') }}</option>
              <option v-for="choice in argumentChoices(level)" :key="choice.value" :value="choice.value">
                {{ choice.label ? say(choice.label) : choice.value }}
              </option>
            </select>

            <!-- Typed by hand when the plugin cannot say: OBS closed, or a
                 name it has never heard of because it is about to exist. -->
            <input
              v-else
              type="text"
              :value="boundArgumentValues[level] ?? ''"
              :placeholder="say(argument.description)"
              @input="setArgument(level, ($event.target as HTMLInputElement).value)"
            />
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

          <!-- A button has one script, held by its first state. A state that
               genuinely acts differently says so here — and until it does, it
               shows the button's script rather than an empty one, because a
               blank panel reads as "this key does nothing". -->
          <label v-if="stateIndex > 0" class="own-script">
            <input type="checkbox" :checked="state.ownActions === true" @change="setOwnScript(($event.target as HTMLInputElement).checked)" />
            <span>{{ t('editor.ownScript') }}</span>
            <em v-if="!state.ownActions" class="muted small">{{ t('editor.ownScriptHint', { state: draft.states[0]?.id ?? '' }) }}</em>
          </label>

          <MacroEditor
            :actions="script"
            :trigger="trigger"
            :plugins="plugins"
            :values="variables"
            :declarations="declarations"
            :folders="folders"
            :pages="pages"
            :buttons="buttons"
            :own-states="ownStates"
            :plugin-statuses="pluginStatuses"
            :load-options="loadOptions"
            :filled-secrets="filledSecrets"
            :save-secret="saveSecret"
            :clear-secret="clearSecret"
            @update="setScript($event)"
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
  <IconParams
    v-if="iconParamsOpen && state.visual.icon"
    :source="state.visual.icon.source"
    :bindings="state.visual.icon.params"
    :declarations="declarations"
    :values="variables"
    @update="setIconParams"
    @close="iconParamsOpen = false"
  />

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

.look-top {
  display: flex;
  align-items: stretch;
  gap: 10px;
}

/* Three buttons over the preview's height, spread to meet its edges: the row
   of controls and the picture of the key end together. */
.look-tools {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 6px;
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
  align-self: flex-start;
  border: 1px solid var(--border);
  border-radius: 12px;
  display: flex;
  overflow: hidden;
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

/*
 * A column, so the macro editor can fill it.
 *
 * The drop zone under the last step is "the rest of the space", and there is
 * no rest of the space unless something claims the column's height.
 */
.behaviour {
  padding: 14px 18px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.behaviour > :deep(.macro) {
  flex: 1;
  min-height: 0;
}

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

.icon-gear {
  flex: none;
  padding: 4px 6px;
  font-size: 12px;
  line-height: 1;
  background: none;
  border: none;
  color: var(--text-muted);
}

.icon-gear:hover {
  color: var(--accent);
}

/* Sized from its contents, so there is no handle to drag and nothing to
   scroll: `fitLabel` sets the height, and a scrollbar would only appear in the
   moment between typing and measuring. The rest — the frame, the fill, the
   padding — comes from the global field rules, so it matches the boxes above
   and below it. */
.label-text {
  resize: none;
  overflow-y: hidden;
  line-height: 1.35;
}

.divider {
  width: 100%;
  margin: 5px 0 2px;
  border: none;
  border-top: 1px solid var(--border);
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

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type {
  ActionDefinition,
  LocalizedText,
  ParamDefinition,
  VariableDeclaration,
  VariableValue,
} from '@easydeck/core';

import { THIS_BUTTON } from '@easydeck/engine/actions';

import ColorPicker from './ColorPicker.vue';
import HotkeyInput from './HotkeyInput.vue';
import PasswordInput from './PasswordInput.vue';
import VariablePicker from './VariablePicker.vue';

const props = defineProps<{
  definition?: ActionDefinition;
  params: Readonly<Record<string, unknown>>;
  /** Choices the host can offer that a plugin cannot know about. */
  values: Readonly<Record<string, VariableValue>>;
  declarations: readonly VariableDeclaration[];
  folders: readonly { id: string; name: string }[];
  pages: readonly { id: string; name: string }[];
  /** Buttons of the current page, with the states each of them defines. */
  buttons: readonly { id: string; name: string; states: readonly string[] }[];
  /** States of the button being edited, used when no target is chosen. */
  ownStates: readonly string[];
  /**
   * The button being edited, for the questions asked on its behalf.
   *
   * `this_btn` means the key doing the pressing, which while a form is open is
   * the key being edited. Without a name to put in its place, asking what
   * widget that key has answers nothing — and the form then says the key has
   * no widget, about a key that may well have one.
   */
  ownButtonId?: string;
  /**
   * Asks a plugin for the choices behind a parameter it declared with
   * `optionsFrom` — the scenes OBS has open right now.
   *
   * A function rather than a list, because the answer depends on a program
   * that may not be running, and on the other parameters already filled in:
   * which filters exist depends on which source was picked.
   */
  loadOptions?: (
    pluginId: string,
    source: string,
    params: Readonly<Record<string, unknown>>,
  ) => Promise<readonly { value: string; label?: LocalizedText }[]>;
  /**
   * Asks what shape a field should take, for one declaring `shapeFrom`.
   *
   * The answer is a whole parameter definition rather than a list of choices:
   * whether "the new value" is a number, a colour or a list is not knowable
   * until the setting it applies to has been picked.
   */
  loadShape?: (
    source: string,
    params: Readonly<Record<string, unknown>>,
  ) => Promise<ParamDefinition | undefined>;
  /**
   * References that have a password behind them.
   *
   * Which is all a window is ever told about a password. See PasswordInput.
   */
  filledSecrets?: readonly string[];
  /** Stores a password and answers with the reference to put on the button. */
  saveSecret?: (value: string, reference?: string) => Promise<string>;
  clearSecret?: (reference: string) => Promise<void>;
}>();

const emit = defineEmits<{ update: [params: Record<string, unknown>] }>();

const { t, locale } = useI18n();

const say = (text: LocalizedText | undefined): string =>
  text === undefined ? '' : (text[locale.value] ?? text.en);

const declared = computed<readonly ParamDefinition[]>(() => props.definition?.params ?? []);

/**
 * The fields worth showing, in order, with any borrowed shapes applied.
 *
 * Two rules, both from the parameter's own declaration. A field waits until
 * what it depends on has been answered — a form for "hide this filter" that
 * showed the scene, the source and the filter at once would be two empty boxes
 * and a puzzle about which to fill first. And a field whose *type* is only
 * knowable now takes the definition that came back for it.
 */
const fields = computed<readonly ParamDefinition[]>(() =>
  declared.value
    .filter((param) => answered(param.dependsOn))
    .map((param) => shapes.value[param.name] ?? param),
);

/**
 * Whether every name given has been answered.
 *
 * Empty means unanswered, as it does in every list here. A button field that
 * genuinely means "this one" says so with a value of its own, so there is no
 * deliberate empty left to mistake for a blank.
 */
function answered(names: readonly string[] | undefined): boolean {
  if (!names || names.length === 0) return true;

  return names.every((name) => {
    const value = props.params[name];
    return value !== undefined && value !== null && value !== '';
  });
}

// --- choices only the plugin knows ---------------------------------------

/**
 * What each dynamic parameter is currently offering.
 *
 * Empty until asked, and empty again whenever the plugin cannot answer — that
 * is not a failure but the ordinary case: somebody sets up an OBS key with
 * OBS closed, and the field falls back to a box they can type a name into.
 */
const dynamic = ref<Record<string, readonly { value: string; label?: LocalizedText }[]>>({});
const loading = ref(new Set<string>());

/**
 * Definitions that arrived at run time, for fields declaring `shapeFrom`.
 *
 * The point is that they are *borrowed*: the widget's own declaration of its
 * period, with its list of choices, or of its colour, with the picker. Nothing
 * here restates what a setting is, so there is nothing to drift.
 */
const shapes = ref<Record<string, ParamDefinition>>({});

async function loadShapeFor(param: ParamDefinition): Promise<void> {
  const source = param.shapeFrom;
  if (!source || !props.loadShape) return;

  try {
    const shape = await props.loadShape(source, asked.value);
    // Keeping the declared field when nothing came back is what stops the form
    // flickering between a number box and a text box while a list loads.
    shapes.value = shape
      ? { ...shapes.value, [param.name]: { ...shape, name: param.name } }
      : dropped(shapes.value, param.name);
  } catch {
    shapes.value = dropped(shapes.value, param.name);
  }
}

function dropped(
  from: Record<string, ParamDefinition>,
  name: string,
): Record<string, ParamDefinition> {
  const { [name]: _gone, ...rest } = from;
  return rest;
}

const pluginOf = (type: string | undefined): string => (type ?? '').split('.')[0] ?? '';

/**
 * The parameters as a question rather than as an answer.
 *
 * One substitution, and it is the meaning of the value rather than a
 * convenience: `this_btn` is the key doing the pressing, and while a form is
 * open that is the key being edited. What gets *stored* stays `this_btn` —
 * the action must still follow the press when it runs somewhere else.
 */
const asked = computed<Record<string, unknown>>(() => {
  const filled: Record<string, unknown> = { ...props.params };

  for (const param of declared.value) {
    if (param.type !== 'profile-button') continue;
    if (filled[param.name] === THIS_BUTTON && props.ownButtonId) filled[param.name] = props.ownButtonId;
  }

  return filled;
});

async function loadOptionsFor(param: ParamDefinition): Promise<void> {
  const source = param.optionsFrom;
  const pluginId = pluginOf(props.definition?.type);
  if (!source || !pluginId || !props.loadOptions) return;

  loading.value = new Set(loading.value).add(param.name);
  try {
    const options = await props.loadOptions(pluginId, source, asked.value);
    dynamic.value = { ...dynamic.value, [param.name]: options };
  } catch {
    dynamic.value = { ...dynamic.value, [param.name]: [] };
  } finally {
    const next = new Set(loading.value);
    next.delete(param.name);
    loading.value = next;
  }
}

/**
 * What the answers depend on, as a value rather than an object.
 *
 * Watching `params` itself watched the *reference*, and the parent hands down
 * a fresh one on every render — so a variable ticking over somewhere else in
 * the window counted as "the parameters changed" and every list was fetched
 * again. Comparing the contents means the question is only re-asked when the
 * answer could actually be different.
 */
const dependencies = computed(() => JSON.stringify(asked.value));

/**
 * Reloads the dynamic lists when the action changes, or when something that
 * feeds them does.
 *
 * The second half is what makes a dependent list work: choosing a source has
 * to change which filters are offered.
 *
 * What is deliberately absent is emptying the lists first. Clearing before
 * fetching turned every select into a text box and back again — which, with a
 * hardware gauge repainting the window every couple of seconds, is the
 * flicker you could see. The old answers stay on screen until better ones
 * arrive; only a different action throws them away, since they belong to the
 * action that asked for them.
 */
watch(
  () => props.definition?.type,
  () => {
    dynamic.value = {};
    shapes.value = {};
    for (const param of declared.value) {
      if (param.optionsFrom) void loadOptionsFor(param);
      if (param.shapeFrom) void loadShapeFor(param);
    }
  },
  { immediate: true },
);

/**
 * Waits for typing to stop before asking again.
 *
 * A parameter can be typed into rather than picked — that is the fallback
 * when the plugin has no list to offer — and a request per keystroke would
 * ask OBS about the filters of "W", "We", "Web"… None of those answers is
 * wanted, and the last one arrives no later for having skipped them.
 */
const RELOAD_DELAY_MS = 300;
let reload: ReturnType<typeof setTimeout> | undefined;

watch(dependencies, () => {
  if (reload) clearTimeout(reload);
  reload = setTimeout(() => {
    for (const param of declared.value) {
      if (param.optionsFrom) void loadOptionsFor(param);
      if (param.shapeFrom) void loadShapeFor(param);
    }
  }, RELOAD_DELAY_MS);
});

onBeforeUnmount(() => {
  if (reload) clearTimeout(reload);
});

const choices = (param: ParamDefinition): readonly { value: string; label?: LocalizedText }[] =>
  dynamic.value[param.name] ?? [];

/**
 * Every text parameter is a template, so say so where it is being filled in.
 *
 * The engine substitutes variables into any text an action receives, not only
 * into labels — but nothing on screen suggests that, and a feature nobody can
 * discover is not much of a feature.
 */
const takesText = computed(() =>
  fields.value.some((param) => param.type === 'text' || param.type === 'string'),
);

const variableNames = computed(() => {
  const names = new Set([
    ...Object.keys(props.values),
    ...props.declarations.map((item) => item.name),
  ]);
  return [...names].sort();
});

/** Built here, not in the template: `{{` inside one is a parse error. */
const example = computed(() => `{{${variableNames.value[0] ?? 'name'}}}`);

// --- inserting a variable -------------------------------------------------

/**
 * The live controls, so a pick can land where the caret is rather than at the
 * end of the field. Appending would be wrong the moment anyone edits text they
 * already wrote, which is most of the time.
 */
const controls = ref<Record<string, HTMLInputElement | HTMLTextAreaElement | undefined>>({});

function keep(name: string, element: unknown): void {
  controls.value[name] = (element ?? undefined) as
    | HTMLInputElement
    | HTMLTextAreaElement
    | undefined;
}

function insert(param: ParamDefinition, variable: string): void {
  const token = `{{${variable}}}`;
  const element = controls.value[param.name];

  if (!element) {
    set(param, `${valueOf(param)}${token}`);
    return;
  }

  const start = element.selectionStart ?? element.value.length;
  const end = element.selectionEnd ?? start;
  set(param, `${element.value.slice(0, start)}${token}${element.value.slice(end)}`);

  // After the value round-trips through the parent, put the caret back where
  // the user was — behind what was just inserted.
  void nextTick(() => {
    element.focus();
    element.selectionStart = start + token.length;
    element.selectionEnd = start + token.length;
  });
}

/**
 * States offered for a `button-state` parameter.
 *
 * Follows whichever button the action targets, falling back to the button
 * being edited — which is what an empty target means at run time.
 */
const stateChoices = computed<readonly string[]>(() => {
  const target = props.params['buttonId'];
  if (typeof target !== 'string' || target === '' || target === THIS_BUTTON) return props.ownStates;

  return props.buttons.find((button) => button.id === target)?.states ?? props.ownStates;
});

function valueOf(param: ParamDefinition): string {
  const raw = props.params[param.name];
  if (raw !== undefined) return String(raw);
  return param.default === undefined ? '' : String(param.default);
}

function set(param: ParamDefinition, raw: string | boolean): void {
  const value =
    param.type === 'number'
      ? raw === '' ? undefined : Number(raw)
      : param.type === 'boolean'
        ? Boolean(raw)
        : raw;

  emit('update', { ...props.params, [param.name]: value });
}

/**
 * Hands a password to the daemon and keeps the reference it answers with.
 *
 * The password goes straight out of the window; what lands on the button is
 * `secret:9f8b…`. Passing the old reference back in means changing a password
 * is not a change to the profile at all.
 */
async function storeSecret(
  param: ParamDefinition,
  value: string,
  reference: string | undefined,
): Promise<void> {
  if (!props.saveSecret) return;

  const stored = await props.saveSecret(value, reference);
  if (stored !== reference) set(param, stored);
}

async function dropSecret(param: ParamDefinition, reference: string): Promise<void> {
  await props.clearSecret?.(reference);
  set(param, '');
}
</script>

<template>
  <!--
    Every control here is chosen from the parameter's declared type, never
    from its action. That is the whole point of manifests: a plugin nobody has
    written yet gets a working form, and the configurator needs no knowledge
    of what any particular action does.
  -->
  <div v-if="fields.length > 0" class="params">
    <label v-for="param in fields" :key="param.name" class="field">
      <span class="label">
        {{ say(param.label) }}
        <em v-if="param.required === false">{{ t('editor.optional') }}</em>
      </span>

      <!-- Text is a template, so the variables that can go in it are offered
           right where it is written. -->
      <VariablePicker
        v-if="param.type === 'text'"
        :values="values"
        :declarations="declarations"
        @pick="insert(param, $event)"
      >
        <textarea
          :ref="(element) => keep(param.name, element)"
          rows="3"
          :value="valueOf(param)"
          :placeholder="say(param.placeholder)"
          @input="set(param, ($event.target as HTMLTextAreaElement).value)"
        />
      </VariablePicker>

      <input
        v-else-if="param.type === 'boolean'"
        type="checkbox"
        :checked="valueOf(param) === 'true'"
        @change="set(param, ($event.target as HTMLInputElement).checked)"
      />

      <input
        v-else-if="param.type === 'number'"
        type="number"
        :value="valueOf(param)"
        :min="param.min"
        :max="param.max"
        :step="param.step"
        @input="set(param, ($event.target as HTMLInputElement).value)"
      />

      <ColorPicker
        v-else-if="param.type === 'color'"
        :model-value="valueOf(param)"
        @update:model-value="set(param, $event)"
      />

      <!-- Chosen from a list rather than typed: a key cannot be misspelled
           this way, and the list is also the answer to what may go here. -->
      <HotkeyInput
        v-else-if="param.type === 'hotkey'"
        :model-value="valueOf(param)"
        @update:model-value="set(param, $event)"
      />

      <!-- The value never reaches this window: what the button holds is a
           reference, and the password lives outside the profile. -->
      <PasswordInput
        v-else-if="param.type === 'password'"
        :model-value="valueOf(param)"
        :filled="(filledSecrets ?? []).includes(valueOf(param))"
        @save="(value, reference) => storeSecret(param, value, reference)"
        @clear="dropSecret(param, $event)"
      />

      <!-- A list the plugin supplies, when it can. The name is typed by hand
           when it cannot: setting up an OBS key while OBS is closed is the
           ordinary case, not the exception, and a select with nothing in it
           would make the key impossible to configure until the program it
           drives happens to be running. -->
      <select
        v-else-if="param.type === 'select' && (param.options?.length || choices(param).length)"
        :value="valueOf(param)"
        @change="set(param, ($event.target as HTMLSelectElement).value)"
      >
        <option value="" disabled>{{ t('editor.choose') }}</option>
        <option
          v-for="option in param.options?.length ? param.options : choices(param)"
          :key="option.value"
          :value="option.value"
        >
          {{ option.label ? say(option.label) : option.value }}
        </option>
      </select>

      <!-- Nothing to choose, and the parameter said what that means. A text
           box here would invite an answer that cannot be right — there is no
           name to type for a key that has no widget on it. -->
      <p
        v-else-if="param.type === 'select' && param.emptyNote && !loading.has(param.name)"
        class="note"
      >
        {{ say(param.emptyNote) }}
      </p>

      <input
        v-else-if="param.type === 'select'"
        type="text"
        :value="valueOf(param)"
        :placeholder="loading.has(param.name) ? t('editor.loadingOptions') : say(param.placeholder)"
        @input="set(param, ($event.target as HTMLInputElement).value)"
      />

      <!-- The host fills these in: only it knows this profile's variables,
           folders and pages. -->
      <input
        v-else-if="param.type === 'variable'"
        type="text"
        list="easydeck-variables"
        :value="valueOf(param)"
        @input="set(param, ($event.target as HTMLInputElement).value)"
      />

      <select
        v-else-if="param.type === 'profile-folder'"
        :value="valueOf(param)"
        @change="set(param, ($event.target as HTMLSelectElement).value)"
      >
        <option value="" disabled>{{ t('editor.choose') }}</option>
        <option v-for="folder in folders" :key="folder.id" :value="folder.id">
          {{ folder.name }}
        </option>
      </select>

      <select
        v-else-if="param.type === 'profile-page'"
        :value="valueOf(param)"
        @change="set(param, ($event.target as HTMLSelectElement).value)"
      >
        <option value="" disabled>{{ t('editor.choose') }}</option>
        <option v-for="page in pages" :key="page.id" :value="page.id">{{ page.name }}</option>
      </select>

      <select
        v-else-if="param.type === 'profile-button'"
        :value="valueOf(param)"
        @change="set(param, ($event.target as HTMLSelectElement).value)"
      >
        <!-- Empty is a missing answer here, as in every other list. "This
             button" is a choice with a name of its own, so the form can tell
             "nobody has chosen" from "this one, deliberately". -->
        <option value="" disabled>{{ t('editor.choose') }}</option>
        <option :value="THIS_BUTTON">{{ t('editor.thisButton') }}</option>
        <option v-for="button in buttons" :key="button.id" :value="button.id">
          {{ button.name }}
        </option>
      </select>

      <select
        v-else-if="param.type === 'button-state'"
        :value="valueOf(param)"
        @change="set(param, ($event.target as HTMLSelectElement).value)"
      >
        <option value="" disabled>{{ t('editor.choose') }}</option>
        <option v-for="stateId in stateChoices" :key="stateId" :value="stateId">
          {{ stateId }}
        </option>
      </select>

      <VariablePicker
        v-else
        :values="values"
        :declarations="declarations"
        @pick="insert(param, $event)"
      >
        <input
          :ref="(element) => keep(param.name, element)"
          type="text"
          :value="valueOf(param)"
          :placeholder="say(param.placeholder)"
          @input="set(param, ($event.target as HTMLInputElement).value)"
        />
      </VariablePicker>

      <span v-if="param.description" class="desc">{{ say(param.description) }}</span>
    </label>

    <p v-if="takesText" class="muted templates">
      {{ t('editor.templatesWork') }} <code>{{ example }}</code>
    </p>

    <datalist id="easydeck-variables">
      <option v-for="name in variableNames" :key="name" :value="name" />
    </datalist>
  </div>

  <p v-else class="muted none">{{ t('editor.noParams') }}</p>
</template>

<style scoped>
.params {
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 12px;
}

.label {
  color: var(--text-muted);
}

.label em {
  font-style: normal;
  font-size: 10px;
  opacity: 0.75;
  margin-left: 4px;
}

.desc {
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.3;
}

/* Where a control would have been, saying why there is none. Framed like a
   field rather than like prose, so the form keeps its rhythm. */
.note {
  margin: 0;
  padding: 5px 9px;
  border: 1px dashed var(--border);
  border-radius: 7px;
  font-size: 12px;
  color: var(--text-muted);
}

input[type='checkbox'] {
  align-self: flex-start;
  width: 16px;
  height: 16px;
}

input[type='color'] {
  width: 46px;
  height: 26px;
  padding: 2px;
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: 6px;
}

/* Everything else about it comes from the global field rules; only the handle
   is this field's own decision — an action's text may be a paragraph. */
textarea {
  resize: vertical;
}

.none {
  font-size: 11px;
  margin: 2px 0 0;
}

.templates {
  font-size: 11px;
  margin: 0;
}

.templates code {
  font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  background: var(--surface-2);
  border-radius: 4px;
  padding: 0 3px;
}
</style>

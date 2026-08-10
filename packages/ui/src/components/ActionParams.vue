<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type {
  ActionDefinition,
  LocalizedText,
  ParamDefinition,
  VariableDeclaration,
  VariableValue,
} from '@easydeck/core';

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
}>();

const emit = defineEmits<{ update: [params: Record<string, unknown>] }>();

const { t, locale } = useI18n();

const say = (text: LocalizedText | undefined): string =>
  text === undefined ? '' : (text[locale.value] ?? text.en);

const fields = computed<readonly ParamDefinition[]>(() => props.definition?.params ?? []);

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

const pluginOf = (type: string | undefined): string => (type ?? '').split('.')[0] ?? '';

async function loadOptionsFor(param: ParamDefinition): Promise<void> {
  const source = param.optionsFrom;
  const pluginId = pluginOf(props.definition?.type);
  if (!source || !pluginId || !props.loadOptions) return;

  loading.value = new Set(loading.value).add(param.name);
  try {
    const options = await props.loadOptions(pluginId, source, props.params);
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
 * Reloads every dynamic list when the action changes or a parameter is
 * edited.
 *
 * The second half is what makes a dependent list work: choosing a source has
 * to change which filters are offered, and nothing else would tell this that
 * the question has a different answer now.
 */
watch(
  [() => props.definition?.type, () => props.params],
  () => {
    dynamic.value = {};
    for (const param of fields.value) {
      if (param.optionsFrom) void loadOptionsFor(param);
    }
  },
  { immediate: true, deep: true },
);

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
  if (typeof target !== 'string' || target.length === 0) return props.ownStates;

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

      <input
        v-else-if="param.type === 'color'"
        type="color"
        :value="valueOf(param) || '#000000'"
        @input="set(param, ($event.target as HTMLInputElement).value)"
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
        <!-- Empty is meaningful here, not a missing answer: it means the
             button doing the pressing. -->
        <option value="">{{ t('editor.thisButton') }}</option>
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

textarea {
  font: inherit;
  color: inherit;
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 5px 8px;
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

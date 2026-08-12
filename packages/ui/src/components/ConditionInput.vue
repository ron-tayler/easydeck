<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { THIS_BUTTON } from '@easydeck/engine/actions';
import type {
  Condition,
  ConditionOperator,
  ConditionSource,
  LocalizedText,
  VariableDeclaration,
} from '@easydeck/core';

/**
 * What an `if` asks about, as three controls.
 *
 * Where the left-hand side comes from, how to compare, and what to compare
 * with. Deliberately not a box for an expression: this program has blocks, so
 * a language would be a second way of saying the same thing, and its mistakes
 * would only show up at the moment somebody pressed the key.
 *
 * The template source is the way out for anything the other two cannot say —
 * it is the same `{{…}}` templating a label uses, rendered and then compared.
 */

const props = defineProps<{
  modelValue?: Condition;
  /** Variables offered by name, the user's own and the plugins' alike. */
  declarations: readonly VariableDeclaration[];
  values: Readonly<Record<string, string | number | boolean>>;
  /** Buttons of the current page, for a condition about one of them. */
  buttons: readonly { id: string; name: string }[];
  /** States of the button being edited, for a condition about itself. */
  ownStates: readonly string[];
  /** The key being edited, which is what `this_btn` means while a form is open. */
  ownButtonId?: string;
  /**
   * The settings the widget on a key declares.
   *
   * Asked for rather than typed: nobody knows a widget's parameter names by
   * heart, and a name typed wrong answers nothing at run time without saying
   * why. The same list the action that changes a widget offers.
   */
  loadWidgetParams?: (
    buttonId: string,
  ) => Promise<readonly { value: string; label?: LocalizedText }[]>;
}>();

const emit = defineEmits<{ 'update:modelValue': [condition: Condition] }>();

const { t, locale } = useI18n();

const SOURCES: readonly ConditionSource[] = [
  'variable',
  'button-state',
  'widget-param',
  'template',
];

/** Comparisons that mean something for numbers, offered only where they do. */
const ORDERED: readonly ConditionOperator[] = ['>', '>=', '<', '<='];
const TEXTUAL: readonly ConditionOperator[] = ['contains', 'starts-with', 'ends-with'];
const ALWAYS: readonly ConditionOperator[] = ['==', '!='];
const ALONE: readonly ConditionOperator[] = ['empty', 'not-empty'];

const condition = computed<Condition>(() => props.modelValue ?? { source: 'variable', operator: '==' });

/** A button's state is a name, so ordering it would be nonsense. */
const operators = computed<readonly ConditionOperator[]>(() =>
  condition.value.source === 'button-state'
    ? [...ALWAYS]
    : [...ALWAYS, ...ORDERED, ...TEXTUAL, ...ALONE],
);

/** `empty` and `not-empty` have nothing to compare with, so no value field. */
const needsValue = computed(() => !ALONE.includes(condition.value.operator));

const variableNames = computed(() => {
  const names = new Set([
    ...props.declarations.map((variable) => variable.name),
    ...Object.keys(props.values),
  ]);
  return [...names].sort();
});

/**
 * The settings the chosen key's widget offers, fetched as it is chosen.
 *
 * Empty means either "no widget there" or "nobody can be asked"; the field says
 * so rather than falling back to a box, because there is no name anybody could
 * usefully type into it.
 */
const widgetParams = ref<readonly { value: string; label?: LocalizedText }[]>([]);

watch(
  () => [condition.value.source, condition.value.name, props.ownButtonId] as const,
  async ([source, chosen]) => {
    if (source !== 'widget-param' || !props.loadWidgetParams) {
      widgetParams.value = [];
      return;
    }

    // `this_btn` is the key being edited while a form is open — the same
    // substitution an action's form makes, and for the same reason.
    const buttonId = chosen === THIS_BUTTON ? props.ownButtonId : chosen;
    if (!buttonId) {
      widgetParams.value = [];
      return;
    }

    try {
      widgetParams.value = await props.loadWidgetParams(buttonId);
    } catch {
      widgetParams.value = [];
    }
  },
  { immediate: true },
);

const say = (text: LocalizedText | undefined): string =>
  text === undefined ? '' : (text[locale.value] ?? text.en ?? '');

function patch(change: Partial<Condition>): void {
  emit('update:modelValue', { ...condition.value, ...change });
}

function setSource(source: ConditionSource): void {
  // The other side's fields go with it: a name means a variable in one and a
  // button in another, and carrying one over would read as an answer nobody
  // gave.
  emit('update:modelValue', {
    source,
    operator: source === 'button-state' ? '==' : condition.value.operator,
    ...(source === 'widget-param' ? { name: THIS_BUTTON } : {}),
    ...(source === 'template' ? { text: '' } : {}),
  });
}
</script>

<template>
  <div class="condition">
    <select :value="condition.source" @change="setSource(($event.target as HTMLSelectElement).value as ConditionSource)">
      <option v-for="source in SOURCES" :key="source" :value="source">
        {{ t(`editor.condition.source.${source}`) }}
      </option>
    </select>

    <!-- Which variable, offered by name; typing one that no plugin has
         published yet is allowed, because a key may be set up before the
         program behind it is running. -->
    <input
      v-if="condition.source === 'variable'"
      type="text"
      list="easydeck-variables"
      :value="condition.name ?? ''"
      :placeholder="t('editor.condition.variable')"
      @input="patch({ name: ($event.target as HTMLInputElement).value })"
    />

    <input
      v-else-if="condition.source === 'template'"
      type="text"
      class="wide"
      :value="condition.text ?? ''"
      :placeholder="t('editor.condition.templateHint', { example: '{{obs.scene}}' })"
      @input="patch({ text: ($event.target as HTMLInputElement).value })"
    />

    <!-- Which key, the same way an action names one: a choice of its own for
         "this button" rather than a blank standing in for it. -->
    <select
      v-else
      :value="condition.name ?? ''"
      @change="patch({ name: ($event.target as HTMLSelectElement).value })"
    >
      <option value="" disabled>{{ t('editor.choose') }}</option>
      <option :value="THIS_BUTTON">{{ t('editor.thisButton') }}</option>
      <option v-for="button in buttons" :key="button.id" :value="button.id">
        {{ button.name }}
      </option>
    </select>

    <!-- And which of that widget's settings, offered rather than typed:
         nobody knows a widget's parameter names by heart. -->
    <select
      v-if="condition.source === 'widget-param' && widgetParams.length > 0"
      :value="condition.param ?? ''"
      @change="patch({ param: ($event.target as HTMLSelectElement).value })"
    >
      <option value="" disabled>{{ t('editor.choose') }}</option>
      <option v-for="param in widgetParams" :key="param.value" :value="param.value">
        {{ param.label ? say(param.label) : param.value }}
      </option>
    </select>

    <!-- No widget on that key, or nobody to ask. A box would invite a name
         that cannot be right. -->
    <span v-else-if="condition.source === 'widget-param'" class="note">
      {{ t('editor.condition.noWidget') }}
    </span>

    <select
      :value="condition.operator"
      @change="patch({ operator: ($event.target as HTMLSelectElement).value as ConditionOperator })"
    >
      <option v-for="operator in operators" :key="operator" :value="operator">
        {{ t(`editor.condition.operator.${operator}`) }}
      </option>
    </select>

    <select
      v-if="needsValue && condition.source === 'button-state'"
      :value="String(condition.value ?? '')"
      @change="patch({ value: ($event.target as HTMLSelectElement).value })"
    >
      <option value="" disabled>{{ t('editor.choose') }}</option>
      <option v-for="stateId in ownStates" :key="stateId" :value="stateId">{{ stateId }}</option>
    </select>

    <input
      v-else-if="needsValue"
      type="text"
      :value="String(condition.value ?? '')"
      :placeholder="t('editor.condition.value')"
      @input="patch({ value: ($event.target as HTMLInputElement).value })"
    />

    <!-- The window keeps one list of variable names; this adds the plugins'
         to it rather than growing a second one beside it. -->
    <datalist id="easydeck-variables">
      <option v-for="name in variableNames" :key="name" :value="name" />
    </datalist>
  </div>
</template>

<style scoped>
.condition {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 6px 0;
}

.condition select,
.condition input {
  min-width: 7em;
  flex: 1 1 7em;
}

.condition .note {
  flex: 1 1 7em;
  font-size: 12px;
  color: var(--text-muted);
}

.condition .wide {
  flex: 2 1 14em;
}
</style>

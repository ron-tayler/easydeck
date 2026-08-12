<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { THIS_BUTTON } from '@easydeck/engine/actions';
import type {
  Condition,
  ConditionOperator,
  ConditionSource,
  LocalizedText,
  ParamDefinition,
  VariableDeclaration,
} from '@easydeck/core';

import ColorPicker from './ColorPicker.vue';

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
  /**
   * The declaration of the setting being compared, for the value box.
   *
   * The same question the widget action asks, and the same answer: that
   * setting's own control, its options and its bounds.
   */
  loadShape?: (
    source: string,
    params: Readonly<Record<string, unknown>>,
  ) => Promise<ParamDefinition | undefined>;
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

/**
 * The chosen setting's own declaration, for the box to compare it with.
 *
 * A period is one of four numbers, a colour wants a picker, a thickness has
 * bounds. Borrowed rather than restated, exactly as the action that changes a
 * widget borrows it — so what somebody sets and what somebody tests against
 * offer the same answers.
 */
const valueShape = ref<ParamDefinition | undefined>();

/** The key this condition is about, with `this_btn` resolved. */
const askedButton = computed<string | undefined>(() => {
  if (condition.value.source !== 'widget-param') return undefined;
  const chosen = condition.value.name;
  return chosen === THIS_BUTTON ? props.ownButtonId : chosen || undefined;
});

/**
 * Answers arriving out of order must not win.
 *
 * Both of these are fetched as somebody clicks through a list, so a slow reply
 * about the key they were on can land after a quick one about the key they are
 * on. Stamping each request and dropping stale replies is the whole guard.
 */
let asking = 0;

watch(
  () => [askedButton.value, condition.value.param] as const,
  async ([buttonId, param]) => {
    const mine = ++asking;
    const stale = (): boolean => mine !== asking;

    if (!buttonId) {
      widgetParams.value = [];
      valueShape.value = undefined;
      return;
    }

    if (props.loadWidgetParams) {
      try {
        const options = await props.loadWidgetParams(buttonId);
        if (!stale()) widgetParams.value = options;
      } catch {
        if (!stale()) widgetParams.value = [];
      }
    }

    if (!param || !props.loadShape) {
      if (!stale()) valueShape.value = undefined;
      return;
    }

    try {
      const shape = await props.loadShape('widget-param-shape', { buttonId, param });
      if (!stale()) valueShape.value = shape;
    } catch {
      if (!stale()) valueShape.value = undefined;
    }
  },
  { immediate: true },
);

/** Keeps a number a number, so `>` compares as one rather than as text. */
function numberOrText(raw: string): string | number {
  if (raw === '') return raw;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : raw;
}

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

    <!--
      A widget's setting knows what it accepts, so the box to compare it with
      is that setting's own control: a list of periods, a colour picker, a
      number with the bounds it declared. Typing into a box was asking somebody
      to guess which of four numbers the graph's period is spelled as.
    -->
    <select
      v-else-if="needsValue && valueShape?.options?.length"
      :value="String(condition.value ?? '')"
      @change="patch({ value: ($event.target as HTMLSelectElement).value })"
    >
      <option value="" disabled>{{ t('editor.choose') }}</option>
      <option v-for="option in valueShape.options" :key="option.value" :value="option.value">
        {{ option.label ? say(option.label) : option.value }}
      </option>
    </select>

    <input
      v-else-if="needsValue && valueShape?.type === 'number'"
      type="number"
      :value="String(condition.value ?? '')"
      :min="valueShape.min"
      :max="valueShape.max"
      :step="valueShape.step"
      @input="patch({ value: numberOrText(($event.target as HTMLInputElement).value) })"
    />

    <ColorPicker
      v-else-if="needsValue && valueShape?.type === 'color'"
      :model-value="String(condition.value ?? '')"
      @update:model-value="patch({ value: $event })"
    />

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

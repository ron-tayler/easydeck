<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { parseVariableKey, variableKey } from '@easydeck/engine/variables';
import type {
  LocalizedText,
  VariableArgument,
  VariableDeclaration,
  VariableValue,
} from '@easydeck/core';

import VariableMenu from './VariableMenu.vue';

/**
 * A field that holds the name of a variable.
 *
 * Everywhere one is chosen, so that choosing one is the same act each time:
 * a condition's left-hand side, an action's parameter, the variable a state is
 * bound to, the one an icon's needle follows. They were a text box with a
 * datalist in three of those places and a plain `select` in the other two —
 * the first admits any typo silently, the second is a hundred rows deep with
 * no structure in it at all.
 *
 * A family is picked in two halves, because that is what it is: `obs.mute` and
 * then which microphone, `clock.timer` and then which timer. The list holds one
 * row for the family however many keys are under it, so without the second half
 * a family could be named here and never filled in — which is what an `if`
 * about a named timer ran into.
 */

const props = defineProps<{
  modelValue?: string;
  values: Readonly<Record<string, VariableValue>>;
  declarations: readonly VariableDeclaration[];
  /** `declared` offers families rather than each of their live keys. */
  mode?: 'all' | 'declared';
  placeholder?: string;
  /** Offers "none" as a choice, for a binding that may be left off. */
  clearLabel?: string;
  /**
   * Asks the plugin what may go in a family's argument.
   *
   * Without it the argument is still typeable — which is also what happens
   * when the plugin cannot say, because OBS is closed or the timer has not
   * been started yet.
   */
  loadOptions?: (
    pluginId: string,
    source: string,
    params: Readonly<Record<string, unknown>>,
  ) => Promise<readonly { value: string; label?: LocalizedText }[]>;
}>();

const emit = defineEmits<{ 'update:modelValue': [name: string] }>();

/*
 * The menu and the argument fields are further root nodes, so anything the
 * caller puts on this — a class, a title — has to be aimed at the field by
 * hand. Otherwise Vue drops it and says so only in the console.
 */
defineOptions({ inheritAttrs: false });

const { t, locale } = useI18n();

const say = (text: LocalizedText | undefined): string =>
  text === undefined ? '' : (text[locale.value] ?? text.en ?? '');

const at = ref<{ x: number; y: number }>();

function open(event: MouseEvent): void {
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
  at.value = { x: box.left, y: box.bottom + 4 };
}

// --- families -------------------------------------------------------------

/** The family half of what is held, which is the whole name for most of them. */
const family = computed(() => (props.modelValue ? parseVariableKey(props.modelValue).family : ''));

const declaration = computed<VariableDeclaration | undefined>(() =>
  family.value ? props.declarations.find((variable) => variable.name === family.value) : undefined,
);

/** Each level of argument the family asks for: usually none, rarely two. */
const levels = computed<VariableArgument[]>(() => {
  const found: VariableArgument[] = [];
  let argument = declaration.value?.argument;
  while (argument) {
    found.push(argument);
    argument = argument.then;
  }
  return found;
});

/** What has been filled in for each level, split back out of the key. */
const filled = computed<string[]>(() => {
  const { argument } = parseVariableKey(props.modelValue ?? '');
  if (argument === undefined || argument === '') return [];
  return argument.split(',').map((part) => part.trim());
});

const choices = ref<Record<number, readonly { value: string; label?: LocalizedText }[]>>({});

/**
 * Asks the plugin what may go in each level, passing what came before.
 *
 * A second level depends on the first — which sources a scene holds — so the
 * earlier answer travels as `argument`, the name a family's loader expects
 * when there are no action parameters to name it.
 */
let asking = 0;
watch(
  [family, () => filled.value.join(','), levels],
  async () => {
    const mine = ++asking;
    const pluginId = declaration.value?.pluginId;

    if (!pluginId || !props.loadOptions || levels.value.length === 0) {
      choices.value = {};
      return;
    }

    const loaded: Record<number, readonly { value: string; label?: LocalizedText }[]> = {};
    for (const [level, argument] of levels.value.entries()) {
      if (!argument.optionsFrom) continue;
      try {
        loaded[level] = await props.loadOptions(pluginId, argument.optionsFrom, {
          argument: filled.value[level - 1] ?? '',
        });
      } catch {
        loaded[level] = [];
      }
    }

    // A list asked for a family somebody has already moved on from must not
    // land on the one they moved to.
    if (mine === asking) choices.value = loaded;
  },
  { immediate: true },
);

/** Rebuilds the key from its parts, so what is stored is one plain string. */
function setArgument(level: number, value: string): void {
  const parts = [...filled.value];
  parts[level] = value;

  // Levels after this one described something inside the old value, so they
  // are dropped: the sources of one scene are not the sources of another.
  const kept = parts.slice(0, level + 1).filter((part) => part !== undefined && part !== '');

  emit('update:modelValue', variableKey(family.value, kept.join(', ')));
}
</script>

<template>
  <button
    type="button"
    class="trigger"
    :class="{ empty: !modelValue }"
    v-bind="$attrs"
    @click="open"
  >
    <span class="chosen">{{ modelValue || placeholder || t('editor.choose') }}</span>
    <span class="caret" aria-hidden="true">▾</span>
  </button>

  <!--
    The second half of a family, asked for as its own field.
    Not there at all for an ordinary variable, so it costs nothing to anybody
    who never picks a family.
  -->
  <template v-for="(argument, level) in levels" :key="level">
    <select
      v-if="(choices[level] ?? []).length > 0"
      :value="filled[level] ?? ''"
      :title="say(argument.label)"
      @change="setArgument(level, ($event.target as HTMLSelectElement).value)"
    >
      <option value="" disabled>{{ say(argument.label) || t('editor.choose') }}</option>
      <option v-for="choice in choices[level]" :key="choice.value" :value="choice.value">
        {{ choice.label ? say(choice.label) : choice.value }}
      </option>
    </select>

    <!-- Typed by hand when the plugin cannot say: OBS closed, or a name it has
         never heard of because it is about to exist. -->
    <input
      v-else
      type="text"
      :value="filled[level] ?? ''"
      :title="say(argument.label)"
      :placeholder="say(argument.label)"
      @input="setArgument(level, ($event.target as HTMLInputElement).value)"
    />
  </template>

  <VariableMenu
    v-if="at"
    :x="at.x"
    :y="at.y"
    :values="values"
    :declarations="declarations"
    :mode="mode"
    :chosen="modelValue"
    :clear-label="clearLabel"
    @pick="emit('update:modelValue', $event)"
    @close="at = undefined"
  />
</template>

<style scoped>
/* Looks like the selects it stands beside, because it is one. */
.trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  min-width: 0;
  text-align: left;
  font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  font-size: 11px;
}

.trigger.empty .chosen {
  color: var(--text-muted);
  font-family: inherit;
  font-size: 12px;
}

.chosen {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.caret {
  flex: none;
  color: var(--text-muted);
  font-size: 9px;
}
</style>

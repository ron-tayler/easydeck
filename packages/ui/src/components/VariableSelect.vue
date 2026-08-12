<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { VariableDeclaration, VariableValue } from '@easydeck/core';

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
}>();

const emit = defineEmits<{ 'update:modelValue': [name: string] }>();

/*
 * The menu is a second root node, so anything the caller puts on this — a
 * class, a title, a `disabled` — has to be aimed at the field by hand.
 * Otherwise Vue drops it and says so only in the console.
 */
defineOptions({ inheritAttrs: false });

const { t } = useI18n();

const at = ref<{ x: number; y: number }>();

function open(event: MouseEvent): void {
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
  at.value = { x: box.left, y: box.bottom + 4 };
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

<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { VariableDeclaration, VariableValue } from '@easydeck/core';

import VariableMenu from './VariableMenu.vue';

/**
 * A variable list attached to whatever field it wraps.
 *
 * Wraps the control rather than sitting beside it so the trigger can be
 * aligned to the field it belongs to. What it shows is the same menu every
 * other variable field opens — this one puts a name into the text being
 * written rather than making it the whole answer, and that is the only
 * difference between them.
 */
defineProps<{
  values: Readonly<Record<string, VariableValue>>;
  declarations: readonly VariableDeclaration[];
}>();

const emit = defineEmits<{ pick: [name: string] }>();

const { t } = useI18n();

const at = ref<{ x: number; y: number }>();

function toggle(event: MouseEvent): void {
  if (at.value) {
    at.value = undefined;
    return;
  }

  const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
  at.value = { x: box.right - 260, y: box.bottom + 4 };
}
</script>

<template>
  <div class="wrap">
    <div class="row">
      <slot />
      <button
        type="button"
        class="toggle"
        :class="{ open: Boolean(at) }"
        :title="t('editor.pickVariable')"
        :aria-expanded="Boolean(at)"
        @click="toggle"
      >
        {var}
      </button>
    </div>

    <VariableMenu
      v-if="at"
      :x="at.x"
      :y="at.y"
      :values="values"
      :declarations="declarations"
      @pick="emit('pick', $event)"
      @close="at = undefined"
    />
  </div>
</template>

<style scoped>
.wrap {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.row {
  display: flex;
  align-items: center;
  gap: 5px;
}

/*
 * The field grows; whatever else shares the row does not.
 *
 * It used to be "the first child fills the space", which held only while the
 * field happened to come first. Naming what grows survives anything else being
 * put in the row beside it.
 */
.row > :deep(.grow),
.row > :deep(input:not([type='color'])),
.row > :deep(textarea) {
  flex: 1;
  min-width: 0;
}

.toggle {
  flex: none;
  padding: 4px 6px;
  font-size: 11px;
  font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  color: var(--text-muted);
}

.toggle.open,
.toggle:hover {
  color: var(--accent);
  border-color: var(--accent);
}

</style>

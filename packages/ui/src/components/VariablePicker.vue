<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { VariableDeclaration, VariableValue } from '@easydeck/core';

/**
 * A variable list attached to whatever field it wraps.
 *
 * Wraps the control rather than sitting beside it so the trigger can be
 * aligned to the field it belongs to, and the list can open *underneath* that
 * field. An absolutely positioned popover would have been prettier and would
 * have been clipped: every field this is used in lives inside a dialog column
 * that scrolls.
 */
const props = defineProps<{
  values: Readonly<Record<string, VariableValue>>;
  declarations: readonly VariableDeclaration[];
}>();

const emit = defineEmits<{ pick: [name: string] }>();

const { t } = useI18n();

const open = ref(false);

const rows = computed(() => {
  const declared = new Map(props.declarations.map((item) => [item.name, item]));
  const names = new Set([...Object.keys(props.values), ...declared.keys()]);

  return [...names]
    .map((name) => ({
      name,
      value: String(props.values[name] ?? ''),
      pluginId: declared.get(name)?.pluginId,
    }))
    .sort((a, b) => {
      if (Boolean(a.pluginId) !== Boolean(b.pluginId)) return a.pluginId ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
});

function choose(name: string): void {
  emit('pick', name);
  open.value = false;
}
</script>

<template>
  <div class="wrap">
    <div class="row">
      <slot />
      <button
        type="button"
        class="toggle"
        :class="{ open }"
        :title="t('editor.pickVariable')"
        :aria-expanded="open"
        @click="open = !open"
      >
        {var}
      </button>
    </div>

    <div v-if="open" class="list">
      <button
        v-for="row in rows"
        :key="row.name"
        type="button"
        class="item"
        @click="choose(row.name)"
      >
        <code>{{ row.name }}</code>
        <!-- The value is the point: it is how you tell `viewers` from
             `viewersTotal` without leaving the field you are filling in. -->
        <span class="value">{{ row.value }}</span>
      </button>

      <p v-if="rows.length === 0" class="muted none">{{ t('variables.none') }}</p>
    </div>
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

.list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  max-height: 148px;
  overflow-y: auto;
  padding: 3px;
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: 7px;
}

.item {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  padding: 3px 6px;
  background: none;
  border: none;
  border-radius: 5px;
  text-align: left;
}

.item:hover {
  background: var(--accent-soft);
}

code {
  font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  font-size: 11px;
}

.value {
  font-size: 11px;
  color: var(--text-muted);
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.none {
  font-size: 11px;
  margin: 3px 6px;
}
</style>

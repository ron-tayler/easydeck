<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

/**
 * A list of names somebody keeps: added to, renamed, taken from.
 *
 * The control behind the `list` setting type. What it edits is one string with
 * a line per entry, because a setting is a single value — but nobody should
 * have to know that, least of all by being handed a textarea and told to put
 * one per line.
 *
 * Blank rows are allowed while typing and dropped on the way out: a row that
 * has just been added is empty for as long as it takes to name it, and a
 * control that deleted it mid-word would be unusable.
 */

const props = defineProps<{
  /** One entry per line, which is how a `list` is stored. */
  modelValue: string;
  placeholder?: string;
  /**
   * What may go in a row, where that is knowable.
   *
   * With choices a row is a list to pick from; without them it is a box to
   * type in. Same control either way, because it is the same list — the only
   * difference is whether anybody can say in advance what belongs in it. A
   * meter naming three OBS inputs should not be typed from memory; a set of
   * timer names has nothing to offer and must be.
   */
  options?: readonly { value: string; label?: string }[];
}>();

const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const { t } = useI18n();

const choosable = computed(() => (props.options ?? []).length > 0);

const rows = computed<string[]>(() =>
  props.modelValue === '' ? [] : props.modelValue.split('\n'),
);

function put(next: readonly string[]): void {
  emit('update:modelValue', next.join('\n'));
}

function rename(at: number, name: string): void {
  const next = [...rows.value];
  next[at] = name;
  put(next);
}

function add(): void {
  put([...rows.value, '']);
}

function remove(at: number): void {
  put(rows.value.filter((_, index) => index !== at));
}
</script>

<template>
  <div class="list">
    <div v-for="(row, at) in rows" :key="at" class="row">
      <select
        v-if="choosable"
        :value="row"
        @change="rename(at, ($event.target as HTMLSelectElement).value)"
      >
        <option value="" disabled>{{ t('editor.choose') }}</option>
        <option v-for="option in options" :key="option.value" :value="option.value">
          {{ option.label ?? option.value }}
        </option>
      </select>

      <input
        v-else
        type="text"
        :value="row"
        :placeholder="placeholder"
        @input="rename(at, ($event.target as HTMLInputElement).value)"
      />

      <button type="button" class="remove" :title="t('variables.remove')" @click="remove(at)">
        ✕
      </button>
    </div>

    <button type="button" class="add" @click="add">+ {{ t('variables.add') }}</button>
  </div>
</template>

<style scoped>
.list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.row input,
.row select {
  flex: 1;
  min-width: 0;
}

.remove {
  flex: none;
  padding: 3px 6px;
  background: none;
  border: none;
  color: var(--text-muted);
}

.remove:hover {
  color: var(--danger);
}

.add {
  align-self: flex-start;
  padding: 2px 8px;
  font-size: 12px;
}
</style>

<script setup lang="ts">
import { computed } from 'vue';
import type { DeckState, KeyView } from '@easydeck/core';

import DeckKey from './DeckKey.vue';

const props = defineProps<{
  state?: DeckState;
  keys: readonly KeyView[];
  pressedKeys: ReadonlySet<number>;
}>();

const emit = defineEmits<{ press: [key: number] }>();

const rows = computed(() => props.state?.device.rows ?? 3);
const cols = computed(() => props.state?.device.cols ?? 5);

const byKey = computed(() => new Map(props.keys.map((view) => [view.key, view])));
const slots = computed(() => Array.from({ length: rows.value * cols.value }, (_, index) => index));
</script>

<template>
  <div class="grid" :style="{ gridTemplateColumns: `repeat(${cols}, 1fr)` }">
    <DeckKey
      v-for="index in slots"
      :key="index"
      :index="index"
      :view="byKey.get(index)"
      :pressed="pressedKeys.has(index)"
      @press="emit('press', $event)"
    />
  </div>
</template>

<style scoped>
.grid {
  display: grid;
  gap: 10px;
  width: 100%;
  max-width: 640px;
}
</style>

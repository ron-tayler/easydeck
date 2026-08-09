<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import type { DeckSummary, KeyView } from '@easydeck/core';

import DeckKey from './DeckKey.vue';

/** Just enough of a button for the grid to know what it may stretch over. */
export interface KeySpan {
  readonly key: number;
  readonly colSpan?: number;
  readonly rowSpan?: number;
}

const props = defineProps<{
  deck?: DeckSummary;
  keys: readonly KeyView[];
  pressedKeys: ReadonlySet<number>;
  selectedKey?: number;
  /** Buttons on the current page, with whatever they already span. */
  spans: readonly KeySpan[];
}>();

const emit = defineEmits<{
  select: [key: number];
  menu: [payload: { key: number; x: number; y: number }];
  dropAction: [payload: { key: number; actionType: string; label: string }];
  dropKey: [payload: { from: number; to: number }];
  resize: [payload: { key: number; colSpan: number; rowSpan: number }];
}>();

const rows = computed(() => props.deck?.rows ?? 3);
const cols = computed(() => props.deck?.cols ?? 5);

const byKey = computed(() => new Map(props.keys.map((view) => [view.key, view])));
const slots = computed(() => Array.from({ length: rows.value * cols.value }, (_, index) => index));

/** Only a key that owns a button can have its picture stretched. */
const owners = computed(() => new Set(props.spans.map((span) => span.key)));

// --- stretching -----------------------------------------------------------

const grid = ref<HTMLElement>();
const drag = ref<
  { key: number; axis: 'col' | 'row' | 'both'; colSpan: number; rowSpan: number } | undefined
>();

/**
 * Keys already claimed by *other* merged buttons.
 *
 * Consulted while dragging so the region simply stops at an occupied key
 * instead of growing into an overlap that the profile would then refuse to
 * save. Refusing after the fact would be a worse way to learn the rule.
 */
const blocked = computed(() => {
  const taken = new Set<number>();
  const dragging = drag.value?.key;

  for (const span of props.spans) {
    if (span.key === dragging) continue;
    const spanCols = span.colSpan ?? 1;
    const spanRows = span.rowSpan ?? 1;
    if (spanCols === 1 && spanRows === 1) continue;

    const left = span.key % cols.value;
    const top = Math.floor(span.key / cols.value);
    for (let row = top; row < top + spanRows; row++) {
      for (let col = left; col < left + spanCols; col++) taken.add(row * cols.value + col);
    }
  }

  return taken;
});

function onResizeStart(payload: { key: number; axis: 'col' | 'row' | 'both' }): void {
  const current = props.spans.find((span) => span.key === payload.key);
  drag.value = {
    ...payload,
    colSpan: current?.colSpan ?? 1,
    rowSpan: current?.rowSpan ?? 1,
  };

  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

/** The cell under the pointer, in grid coordinates. */
function cellAt(event: MouseEvent): { col: number; row: number } | undefined {
  const box = grid.value?.getBoundingClientRect();
  if (!box) return undefined;

  const col = Math.floor(((event.clientX - box.left) / box.width) * cols.value);
  const row = Math.floor(((event.clientY - box.top) / box.height) * rows.value);
  return {
    col: Math.max(0, Math.min(cols.value - 1, col)),
    row: Math.max(0, Math.min(rows.value - 1, row)),
  };
}

function onMove(event: MouseEvent): void {
  const state = drag.value;
  const cell = cellAt(event);
  if (!state || !cell) return;

  const left = state.key % cols.value;
  const top = Math.floor(state.key / cols.value);

  const wantedCols = state.axis === 'row' ? state.colSpan : Math.max(1, cell.col - left + 1);
  const wantedRows = state.axis === 'col' ? state.rowSpan : Math.max(1, cell.row - top + 1);

  // Grow only as far as the region stays clear; the first blocked key stops it.
  let maxCols = wantedCols;
  let maxRows = wantedRows;
  for (let row = top; row < top + wantedRows; row++) {
    for (let col = left; col < left + wantedCols; col++) {
      if (!blocked.value.has(row * cols.value + col)) continue;
      maxCols = Math.min(maxCols, col - left);
      maxRows = Math.min(maxRows, row - top);
    }
  }

  drag.value = {
    ...state,
    colSpan: Math.max(1, maxCols),
    rowSpan: Math.max(1, maxRows),
  };
}

function onUp(): void {
  const state = drag.value;
  stopDrag();
  if (state) emit('resize', { key: state.key, colSpan: state.colSpan, rowSpan: state.rowSpan });
}

function stopDrag(): void {
  drag.value = undefined;
  window.removeEventListener('mousemove', onMove);
  window.removeEventListener('mouseup', onUp);
}

onBeforeUnmount(stopDrag);

/** The outline shown while dragging, in grid-track coordinates. */
const preview = computed(() => {
  const state = drag.value;
  if (!state) return undefined;

  return {
    gridColumn: `${(state.key % cols.value) + 1} / span ${state.colSpan}`,
    gridRow: `${Math.floor(state.key / cols.value) + 1} / span ${state.rowSpan}`,
  };
});
</script>

<template>
  <div ref="grid" class="grid" :style="{ gridTemplateColumns: `repeat(${cols}, 1fr)` }">
    <DeckKey
      v-for="index in slots"
      :key="index"
      :index="index"
      :view="byKey.get(index)"
      :pressed="pressedKeys.has(index)"
      :selected="selectedKey === index"
      :resizable="owners.has(index)"
      :style="{
        gridColumn: (index % cols) + 1,
        gridRow: Math.floor(index / cols) + 1,
      }"
      @select="emit('select', $event)"
      @menu="emit('menu', $event)"
      @drop-action="emit('dropAction', $event)"
      @drop-key="emit('dropKey', $event)"
      @resize-start="onResizeStart"
    />

    <!--
      Drawn over the keys rather than by resizing them: the profile is only
      changed once, on release, so a drag that goes nowhere costs no save.

      Every key is placed explicitly above, because this overlay is a grid item
      too — left to auto-placement the keys would flow *around* it, and the
      whole panel would visibly reshuffle mid-drag.
    -->
    <div v-if="preview" class="preview" :style="preview" />
  </div>
</template>

<style scoped>
.grid {
  display: grid;
  gap: 10px;
  width: 100%;
  max-width: 640px;
  position: relative;
}

.preview {
  pointer-events: none;
  border: 2px solid var(--accent);
  border-radius: 12px;
  background: var(--accent-soft);
  margin: -5px;
  z-index: 3;
}
</style>

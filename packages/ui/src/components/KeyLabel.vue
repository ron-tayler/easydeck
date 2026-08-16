<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { LabelSpec } from '@easydeck/protocol';
import { layoutLabel } from '@easydeck/engine/label';

import { measureKeyText } from '../icons/measure-text.js';

/**
 * A key's text, drawn the way the device draws it.
 *
 * One component rather than a rule repeated in every place a key appears —
 * the grid, the editor's preview — because that repetition is what let the
 * three of them drift apart: the panel put text at the bottom the window
 * centred, the window wrapped where the panel shrank, and each applied a
 * scale of its own.
 *
 * It fills whatever it is placed in and measures that, so the caller only has
 * to give it a positioned box the size of the key.
 */

const props = defineProps<{
  label: LabelSpec;
  /** Whether a picture sits under the text, which moves an unpositioned label. */
  hasPicture?: boolean;
}>();

const root = ref<HTMLElement>();
const size = ref({ width: 0, height: 0 });
/** The container's border, which this reaches back over. */
const inset = ref(0);
const fontsReady = ref(false);
let watching: ResizeObserver | undefined;

/**
 * The key's whole face, border included.
 *
 * An absolutely positioned child is laid out from inside its container's
 * border, while the panel measures across the entire key — so the border is
 * measured here and given back as negative inset. Left alone, the text lands
 * a border's width below where the device puts it, and the layout is taken
 * against a box two pixels short.
 */
function measureSelf(): void {
  const parent = root.value?.parentElement;
  const border = parent ? Number.parseFloat(getComputedStyle(parent).borderTopWidth) || 0 : 0;
  inset.value = border;

  const box = root.value?.getBoundingClientRect();
  if (box && box.width > 0) {
    size.value = { width: box.width + border * 2, height: box.height + border * 2 };
  }
}

onMounted(() => {
  if (!root.value) return;

  /*
   * Measured once now, and again whenever the key changes size.
   *
   * The observer alone is not enough: it reports nothing until something
   * moves, so a window that starts hidden — in the tray, on another desktop —
   * would show keys with no text until the first resize.
   */
  measureSelf();
  watching = new ResizeObserver(() => measureSelf());
  watching.observe(root.value);

  void document.fonts.ready.then(() => {
    // The first measurement used whatever font was available; the real one has
    // different metrics, and the layout has to be taken again.
    fontsReady.value = true;
    measureSelf();
  });
});

onBeforeUnmount(() => watching?.disconnect());

const laidOut = computed(() => {
  if (size.value.width === 0) return undefined;

  // Read so the layout is recomputed once the real font has loaded.
  void fontsReady.value;

  return layoutLabel(props.label, size.value, measureKeyText, {
    hasPicture: props.hasPicture === true,
  });
});
</script>

<template>
  <span
    ref="root"
    class="label"
    :style="{
      color: label.color ?? '#ffffff',
      inset: `${-inset}px`,
    }"
  >
    <!--
      One positioned line per line of text, rather than a block with a line
      height: a line box puts its baseline at the font's ascent from the top,
      so placing each line by that distance lands the baseline exactly where
      the layout says — the same place the canvas draws it.
    -->
    <span
      v-for="(line, index) in laidOut?.lines ?? []"
      :key="index"
      class="line"
      :style="{
        top: `${(laidOut?.baselines[index] ?? 0) - (laidOut?.fontAscent ?? 0)}px`,
        fontSize: `${laidOut?.fontSize}px`,
      }"
    >{{ line }}</span>
  </span>
</template>

<style scoped>
.label {
  position: absolute;
  pointer-events: none;
  /* The device's own font at its own weight; anything else makes the same
     nominal size read as a different size. */
  font-family: 'EasyDeck Sans', system-ui, sans-serif;
  font-weight: 400;
}

.line {
  position: absolute;
  left: 0;
  right: 0;
  text-align: center;
  /* The font's own line box, so its baseline sits at `fontAscent` from the
     top — the number the layout positioned against. */
  line-height: normal;
  white-space: pre;
}
</style>

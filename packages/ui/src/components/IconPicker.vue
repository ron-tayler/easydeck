<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { IconSpec, LibraryImage, LocalizedText } from '@easydeck/core';
import type { IconColorSlot } from '@easydeck/engine/icons';
import { drawableIcon, readIconPalette, svgTextOf, usesCurrentColor } from '@easydeck/engine/icons';

import ColorPicker from './ColorPicker.vue';
import IconLibrary from './IconLibrary.vue';
import { isAnimated } from '../icons/rasterize.js';

/**
 * The key's picture, as one control in a row.
 *
 * It used to be the library itself — a column of tiles three wide, wedged into
 * the editor beside everything else a button has, and present whether or not
 * anyone was choosing a picture. The collection now opens in a window with
 * room for it, and what remains here belongs beside the background colour: a
 * button saying whether there is a picture, and a way to take it off again.
 */

const props = defineProps<{
  icon?: IconSpec;
  /** The user's own folder, read by the daemon; empty until it is fetched. */
  userIcons: readonly LibraryImage[];
  /** Pictures the folder holds but the library had no room for. */
  omittedIcons?: number;
  /**
   * Names the button, and widens it to fit the word.
   *
   * Standing in a column with the two colour buttons, what it opens has to be
   * readable when there is no picture on it yet and nothing to look at.
   */
  label?: string;
}>();

const emit = defineEmits<{ update: [icon: IconSpec | undefined] }>();

const { t, locale } = useI18n();

const say = (text: LocalizedText | undefined): string =>
  text === undefined ? '' : (text[locale.value] ?? text.en);

/** What the icon's main ink falls back to, and what the swatch shows. */
const DEFAULT_INK = '#ffffff';

const browsing = ref(false);
const mixing = ref(false);

const animated = computed(() => Boolean(props.icon && isAnimated(props.icon.source)));

const svg = computed(() => (props.icon ? (svgTextOf(props.icon.source) ?? '') : ''));

/**
 * The colours this picture offers, in the order the swatches appear.
 *
 * The unnamed one comes first when the artwork uses `currentColor`, because it
 * is the icon's main ink and the only one most icons have. Named slots follow,
 * and almost no icon declares any.
 */
const slots = computed<readonly (IconColorSlot | undefined)[]>(() => [
  ...(usesCurrentColor(svg.value) ? [undefined] : []),
  ...readIconPalette(svg.value),
]);

/** The thumbnail shows the picture as the key will draw it, colour included. */
const shown = computed(() => (props.icon ? drawableIcon(props.icon) : undefined));

function inkOf(slot: IconColorSlot | undefined): string | undefined {
  return slot === undefined ? props.icon?.color : props.icon?.colors?.[slot.name];
}

function defaultOf(slot: IconColorSlot | undefined): string {
  if (slot === undefined) return DEFAULT_INK;
  // A slot defaulting to `currentColor` follows the main ink, so that is what
  // its swatch has to show — the word itself is not a colour anyone can see.
  return slot.default === undefined || usesCurrentColor(slot.default)
    ? (props.icon?.color ?? DEFAULT_INK)
    : slot.default;
}

function setInk(slot: IconColorSlot | undefined, color: string): void {
  const icon = props.icon;
  if (!icon) return;

  emit(
    'update',
    slot === undefined
      ? { ...icon, color }
      : { ...icon, colors: { ...icon.colors, [slot.name]: color } },
  );
}

/**
 * A new picture keeps nothing of the old one.
 *
 * Its colours were chosen against artwork that is no longer here, and its
 * parameter bindings named things the new picture may not declare at all.
 */
function chosen(source: string): void {
  emit('update', { source });
  browsing.value = false;
}
</script>

<template>
  <span class="picture" :class="{ wide: label }">
   <span class="row">
    <!--
      One colour: the picker opens on the button, because a panel listing a
      single swatch would be a window in front of the one thing it holds.
    -->
    <ColorPicker
      v-if="slots.length === 1"
      :model-value="inkOf(slots[0])"
      :fallback="defaultOf(slots[0])"
      :title="t('color.icon')"
      @update:model-value="setInk(slots[0], $event)"
    />

    <!-- Several: a swatch each, named, since which one is the outline and
         which the fill is not a thing a colour can say about itself. -->
    <button
      v-else-if="slots.length > 1"
      type="button"
      class="inks"
      :title="t('color.icon')"
      :aria-label="t('color.icon')"
      :aria-expanded="mixing"
      @click="mixing = !mixing"
    >
      <span
        v-for="(slot, at) in slots.slice(0, 4)"
        :key="at"
        class="ink"
        :style="{ background: inkOf(slot) ?? defaultOf(slot) }"
      />
    </button>

    <button
      type="button"
      class="choose"
      :class="{ wide: label }"
      :title="icon ? t('editor.iconChange') : t('editor.iconChoose')"
      @click="browsing = true"
    >
      <img v-if="icon" :src="shown" alt="" />
      <!-- A frame with a hill and a sun in it: the picture that stands for
           there being no picture yet. -->
      <svg v-else-if="label" class="glyph" viewBox="0 0 16 16" aria-hidden="true">
        <rect
          x="1.6"
          y="2.8"
          width="12.8"
          height="10.4"
          rx="1.6"
          fill="none"
          stroke="currentColor"
          stroke-width="1.3"
        />
        <circle cx="5.6" cy="6.4" r="1.1" fill="currentColor" />
        <path d="M2.4 12 6 8.6l2.4 2.2 2.4-2.6 2.8 3.8Z" fill="currentColor" />
      </svg>
      <span v-else class="empty">{{ t('editor.iconChoose') }}</span>

      <span v-if="label" class="name">{{ label }}</span>
      <span v-if="animated" class="badge">GIF</span>
    </button>

    <!-- Whatever else this particular picture needs — the parameter gear, on
         the few icons that declare any. Beside the button rather than before
         it: it belongs to the picture, and reads as belonging to it. -->
    <slot name="tools" />

    <button
      v-if="icon"
      type="button"
      class="clear"
      :title="t('editor.iconClear')"
      @click="emit('update', undefined)"
    >
      ✕
    </button>
   </span>

    <!--
      The named inks, one row each, opened underneath rather than over.

      Opened from the swatches rather than from the gear next door: these are
      chosen by eye, and the gear is where a picture is wired to a variable. It
      pushes the form down instead of floating above it for the same reason the
      variable list does — this control lives in a column that scrolls, and a
      panel positioned within one is cut off at the first edge it meets.
    -->
    <div v-if="mixing && slots.length > 1" class="mixer">
      <label v-for="(slot, at) in slots" :key="at" class="slot">
        <ColorPicker
          :model-value="inkOf(slot)"
          :fallback="defaultOf(slot)"
          @update:model-value="setInk(slot, $event)"
        />
        <span>{{ slot ? say(slot.label) || slot.name : t('color.iconInk') }}</span>
      </label>
    </div>

    <IconLibrary
      v-if="browsing"
      :user-icons="userIcons"
      :omitted="omittedIcons ?? 0"
      @pick="chosen"
      @close="browsing = false"
    />
  </span>
</template>

<style scoped>
.picture {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}

.picture > .row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex-wrap: wrap;
}

.choose {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  height: 30px;
  padding: 0 8px 0 4px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface-2);
  color: inherit;
  cursor: pointer;
}

/* As with the colour buttons: the width comes from whatever it stands in. The
   gear and the cross keep their size, and the button takes the rest. */
.picture.wide > .row {
  flex-wrap: nowrap;
  gap: 2px;
}

/* Every ink the picture offers, in one button the size of a single swatch.
   Four at most: past that they are stripes rather than colours, and the panel
   behind them lists all of them by name anyway. */
.inks {
  flex: none;
  display: flex;
  width: 30px;
  height: 30px;
  padding: 3px;
  gap: 2px;
  overflow: hidden;
}

.ink {
  flex: 1;
  min-width: 0;
  border-radius: 2px;
  box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.2);
}

.mixer {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 7px;
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: 9px;
}

.slot {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  white-space: nowrap;
}

/* Matched to the colour buttons it stands between: same height, same word in
   the same place, so the three read as one set rather than three controls. */
.choose.wide {
  flex: 1;
  min-width: 0;
  gap: 7px;
  padding: 0 9px;
  background: var(--surface-1);
}

.choose .glyph {
  flex: none;
  width: 17px;
  height: 17px;
  color: var(--text-muted);
}

.choose .name {
  font-size: 12px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.choose:hover {
  border-color: var(--accent);
}

.choose img {
  width: 22px;
  height: 22px;
  object-fit: cover;
  border-radius: 4px;
  background: var(--surface-1);
}

.empty {
  font-size: 12px;
  padding-left: 4px;
  white-space: nowrap;
}

.badge {
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--surface-1);
  border: 1px solid var(--border);
  font-size: 10px;
}

.clear {
  border: none;
  background: none;
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
  padding: 2px 4px;
}

.clear:hover {
  color: var(--danger);
}

</style>

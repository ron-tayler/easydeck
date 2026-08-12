<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  ICON_CANVAS,
  composeIcon,
  readIconLayers,
  readLayerSource,
  svgTextOf,
} from '@easydeck/engine/icons';

/**
 * Where a picture sits on the key, decided once.
 *
 * A picture fills the key edge to edge, which is right for a photograph and
 * wrong for a glyph — a mark meant to be looked at from a metre away, drawn
 * corner to corner. There is no setting for it and deliberately so: one that
 * changed how a picture met the key's edge was offered on every icon, where
 * what people wanted was for the picture to fill the key.
 *
 * So this is a moment rather than a setting. The picture is put where it goes,
 * and what comes out is an ordinary SVG with the picture inside it at that
 * size and in that corner. Everything after this point sees a picture.
 *
 * Opening with the placement that changes nothing is the point of the arrival
 * state: somebody who only wanted the glyph presses one button and gets
 * exactly what they would have got before this window existed — and gets the
 * original artwork back, not a wrapper around it, so it stays the same picture
 * as the one on the other seven keys already wearing it.
 */

const props = defineProps<{
  /** The picture as chosen, which may already be one this window produced. */
  source: string;
  /** What the key shows behind it, so the placement is judged against it. */
  background?: string;
}>();

const emit = defineEmits<{ apply: [source: string]; cancel: [] }>();

const { t } = useI18n();

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const canvas = ref<HTMLElement>();
const box = ref<Box>({ x: 0, y: 0, width: ICON_CANVAS, height: ICON_CANVAS });

/** The artwork itself, with any placement this window made already undone. */
const artwork = computed(() => {
  const svg = svgTextOf(props.source);
  const layer = svg ? readIconLayers(svg)[0] : undefined;
  return (layer && svg ? readLayerSource(svg, layer.id) : undefined) ?? props.source;
});

/**
 * The placement that changes nothing: the picture covering the key, cropped to
 * do it, which is what every picture does without this window.
 *
 * Worked out from the artwork's own proportions, because covering a square key
 * with a wide picture means a box wider than the key with its sides hanging
 * over the edge — that overhang *is* the crop.
 */
const cover = ref<Box>({ x: 0, y: 0, width: ICON_CANVAS, height: ICON_CANVAS });

const untouched = computed(
  () =>
    Math.abs(box.value.x - cover.value.x) < 0.5 &&
    Math.abs(box.value.y - cover.value.y) < 0.5 &&
    Math.abs(box.value.width - cover.value.width) < 0.5 &&
    Math.abs(box.value.height - cover.value.height) < 0.5,
);

const style = computed(() => ({
  left: `${box.value.x}%`,
  top: `${box.value.y}%`,
  width: `${box.value.width}%`,
  height: `${box.value.height}%`,
}));

/** How much of the key the picture takes, along its longer side. */
const size = computed(() =>
  Math.round((Math.max(box.value.width, box.value.height) / ICON_CANVAS) * 100),
);

onMounted(() => {
  const svg = svgTextOf(props.source);
  const layer = svg ? readIconLayers(svg)[0] : undefined;

  const image = new Image();
  image.onload = () => {
    const ratio = image.naturalWidth / image.naturalHeight;
    cover.value = coverBox(Number.isFinite(ratio) && ratio > 0 ? ratio : 1);
    // A picture arriving already placed keeps its placement; anything else
    // starts where it would have been without this window.
    box.value = layer ? { ...layer } : { ...cover.value };
  };
  image.onerror = () => {
    cover.value = coverBox(1);
    box.value = layer ? { ...layer } : { ...cover.value };
  };
  image.src = artwork.value;
});

/** The box a picture of this shape needs to cover a square key. */
function coverBox(ratio: number): Box {
  const width = ratio >= 1 ? ICON_CANVAS * ratio : ICON_CANVAS;
  const height = ratio >= 1 ? ICON_CANVAS : ICON_CANVAS / ratio;

  return { x: (ICON_CANVAS - width) / 2, y: (ICON_CANVAS - height) / 2, width, height };
}

// --- moving and sizing ----------------------------------------------------

/**
 * Sized about its own middle, so a picture being made smaller stays where it
 * was put rather than creeping towards the corner the handle is in.
 */
function resize(to: number): void {
  const scale = to / Math.max(box.value.width, box.value.height);
  const width = box.value.width * scale;
  const height = box.value.height * scale;

  box.value = {
    x: box.value.x + (box.value.width - width) / 2,
    y: box.value.y + (box.value.height - height) / 2,
    width,
    height,
  };
}

function onWheel(event: WheelEvent): void {
  const step = event.deltaY < 0 ? 1.06 : 1 / 1.06;
  resize(Math.min(ICON_CANVAS * 4, Math.max(4, Math.max(box.value.width, box.value.height) * step)));
}

function onDown(event: PointerEvent): void {
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}

function onMove(event: PointerEvent): void {
  if (!(event.buttons & 1)) return;

  const rect = canvas.value?.getBoundingClientRect();
  if (!rect) return;

  // Measured against the canvas rather than taken from the movement of the
  // element, which is being moved by this and would chase itself.
  const perPixel = ICON_CANVAS / rect.width;
  box.value = {
    ...box.value,
    x: box.value.x + event.movementX * perPixel,
    y: box.value.y + event.movementY * perPixel,
  };
}

function centre(): void {
  box.value = {
    ...box.value,
    x: (ICON_CANVAS - box.value.width) / 2,
    y: (ICON_CANVAS - box.value.height) / 2,
  };
}

/**
 * Left as it was found unless it was actually moved.
 *
 * Wrapping a picture that was not placed would make it a picture of its own —
 * a second copy in the profile, unrecognisable as the one already on seven
 * other keys, and one the library could no longer offer back.
 */
function apply(): void {
  if (untouched.value) return emit('apply', artwork.value);

  const svg = composeIcon([{ source: artwork.value, ...box.value }]);
  emit('apply', `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`);
}
</script>

<template>
  <div class="backdrop" @click.self="emit('cancel')" @keydown.esc="emit('cancel')">
    <div class="dialog" role="dialog" aria-modal="true">
      <header>
        <h2>{{ t('iconEditor.title') }}</h2>
        <button type="button" class="close" :aria-label="t('settings.close')" @click="emit('cancel')">
          ✕
        </button>
      </header>

      <p class="muted hint">{{ t('iconEditor.hint') }}</p>

      <!-- The key itself, at the size the window can spare: the placement is a
           judgement about how a mark sits on a square, and it cannot be made
           against anything but the square. -->
      <div
        ref="canvas"
        class="key"
        :style="{ background: background ?? '#111318' }"
        @wheel.prevent="onWheel"
      >
        <img
          class="placed"
          :src="artwork"
          :style="style"
          alt=""
          draggable="false"
          @pointerdown="onDown"
          @pointermove="onMove"
        />
      </div>

      <div class="row">
        <label class="field">
          <span>{{ t('iconEditor.size') }}</span>
          <input
            type="range"
            min="4"
            max="200"
            :value="size"
            @input="resize((Number(($event.target as HTMLInputElement).value) / 100) * ICON_CANVAS)"
          />
          <span class="reading">{{ size }}%</span>
        </label>

        <button type="button" @click="centre">{{ t('iconEditor.centre') }}</button>
        <button type="button" @click="box = { ...cover }">{{ t('iconEditor.fill') }}</button>
      </div>

      <footer>
        <button type="button" @click="emit('cancel')">{{ t('prompt.cancel') }}</button>
        <button type="button" class="primary" @click="apply">{{ t('iconEditor.apply') }}</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  background: rgb(0 0 0 / 45%);
  display: grid;
  place-items: center;
  z-index: 40;
}

.dialog {
  width: 340px;
  max-width: 92vw;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: var(--surface-0);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 18px 48px var(--shadow);
}

header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

h2 { margin: 0; font-size: 14px; }
.close { background: none; border: none; color: var(--text-muted); padding: 2px 6px; }
.hint { margin: 0; font-size: 11px; }

/* Square, and the only square in the window: everything here is a judgement
   about how something sits on a key. */
.key {
  position: relative;
  width: 100%;
  aspect-ratio: 1;
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
  touch-action: none;
}

.placed {
  position: absolute;
  /* The whole picture inside the box that was dragged, which is what the box
     means. Cropping happens at the key's edge, by the box hanging over it. */
  object-fit: contain;
  cursor: grab;
  user-select: none;
}

.placed:active { cursor: grabbing; }

.row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.field {
  display: flex;
  align-items: center;
  gap: 7px;
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--text-muted);
}

.field input { flex: 1; min-width: 0; }

.reading {
  width: 4ch;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.primary {
  border-color: var(--accent);
  color: var(--accent);
}
</style>

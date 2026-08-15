<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import {
  DEFAULT_BACKGROUND,
  backgroundCss,
  linearGradientCss,
  opacityOf,
  sampleStops,
  shade,
  withOpacity,
} from '@easydeck/engine/background';
import type {
  BackgroundSpec,
  GradientBackground,
  GradientSpot,
  GradientStop,
} from '@easydeck/engine/background';

import ColorPicker from './ColorPicker.vue';

/**
 * The gradient, edited on a picture of the key rather than in a list of numbers.
 *
 * Two things are being described here and they are not the same thing. A ramp
 * runs straight across the key and is a line with colours on it — the bar, the
 * way every program has drawn one for thirty years. A spot is a place: light
 * thrown at a point, which nothing on a bar can say. So the ramp lives on a bar
 * and the spots live on the key, each where it is, and a click on an empty part
 * of the key is how one comes into existence.
 *
 * Everything is applied as it happens. The button editor around this is itself
 * a draft — nothing reaches the profile until that dialog is saved — so there
 * is no cost to the key changing under the pointer, and every judgement being
 * made here is a judgement about how it looks.
 */

const props = defineProps<{ background?: BackgroundSpec }>();

const emit = defineEmits<{ update: [value: BackgroundSpec | undefined]; close: [] }>();

const { t } = useI18n();

/** A new spot: white, half seen through, and big enough to notice at once. */
const NEW_SPOT = { color: '#ffffff99', radius: 0.45 } as const;

/** Where a ramp starts when there was none: the key's own colour, lifted. */
const LIFT = 0.35;

type Picked = { readonly kind: 'stop' | 'spot'; readonly index: number };

/** What the pointer is doing to the key, while it is doing it. */
type Dragging =
  | { readonly kind: 'spot'; readonly index: number }
  | { readonly kind: 'angle'; readonly end: 0 | 1 };

const surface = ref<HTMLElement>();
const bar = ref<HTMLElement>();
const picked = ref<Picked>();
const dragging = ref<Dragging>();
const draggingStop = ref<number>();

/** What is on the key now, always as an object — a colour is a gradient of none. */
const spec = computed<GradientBackground>(() => {
  const value = props.background;
  if (value === undefined) return { base: DEFAULT_BACKGROUND };
  return typeof value === 'string' ? { base: value } : value;
});

const linear = computed(() => spec.value.linear);
const spots = computed<readonly GradientSpot[]>(() => spec.value.spots ?? []);
const stops = computed<readonly GradientStop[]>(() => linear.value?.stops ?? []);

const css = computed(() => backgroundCss(props.background));

/** The bar shows the ramp laid flat, whatever angle it runs at on the key. */
const rampCss = computed(() =>
  linear.value ? linearGradientCss({ ...linear.value, angle: 90 }) : 'none',
);

/**
 * How far from the middle of the key the two direction handles sit.
 *
 * Not where the ramp actually begins and ends: a gradient's line, as CSS
 * defines it and as the panel paints it, runs past the edges of the box at
 * every angle but the diagonals — the handles would spend most of their time
 * outside the key, clipped by it. What is being dragged here is a direction,
 * so the handles keep a fixed distance and stay where they can be reached.
 */
const REACH = 0.38;

/** The two handles, and the line drawn between them, in fractions of the key. */
const line = computed(() => {
  const radians = ((linear.value?.angle ?? 0) * Math.PI) / 180;
  const dx = Math.sin(radians) * REACH;
  const dy = -Math.cos(radians) * REACH;

  return { x0: 0.5 - dx, y0: 0.5 - dy, x1: 0.5 + dx, y1: 0.5 + dy };
});

const ends = computed(() => [
  { left: `${line.value.x0 * 100}%`, top: `${line.value.y0 * 100}%` },
  { left: `${line.value.x1 * 100}%`, top: `${line.value.y1 * 100}%` },
]);

/**
 * The line between them, drawn as one rotated strip.
 *
 * Worked out here rather than in the template: it is trigonometry, and
 * trigonometry written inside an attribute is trigonometry nobody will ever
 * check. The length is a percentage of the key's width, which is why the key
 * is kept square.
 */
const lineStyle = computed(() => {
  const dx = line.value.x1 - line.value.x0;
  const dy = line.value.y1 - line.value.y0;

  return {
    left: `${line.value.x0 * 100}%`,
    top: `${line.value.y0 * 100}%`,
    width: `${Math.hypot(dx, dy) * 100}%`,
    transform: `rotate(${(Math.atan2(dy, dx) * 180) / Math.PI}deg)`,
  };
});

/** The colour of whatever is selected, or nothing when nothing is. */
const chosenColor = computed<string | undefined>(() => {
  const at = picked.value;
  if (!at) return undefined;
  return at.kind === 'stop' ? stops.value[at.index]?.color : spots.value[at.index]?.color;
});

const chosenOpacity = computed(() =>
  chosenColor.value === undefined ? 100 : Math.round(opacityOf(chosenColor.value) * 100),
);

// --- writing it back -----------------------------------------------------

/**
 * A background with nothing over it is a colour again.
 *
 * The object form only exists while there is something to describe; dropping
 * back to a plain string means a key someone tried a gradient on and then
 * cleared is stored exactly as it would have been if they never had.
 */
function apply(next: GradientBackground): void {
  const hasSpots = (next.spots?.length ?? 0) > 0;
  if (!next.linear && !hasSpots) return emit('update', next.base);

  emit('update', {
    base: next.base,
    ...(next.linear ? { linear: next.linear } : {}),
    ...(hasSpots ? { spots: next.spots } : {}),
  });
}

function setBase(base: string): void {
  apply({ ...spec.value, base });
}

// --- the ramp ------------------------------------------------------------

function toggleLinear(): void {
  if (linear.value) {
    if (picked.value?.kind === 'stop') picked.value = undefined;
    apply({ base: spec.value.base, ...(spots.value.length > 0 ? { spots: spots.value } : {}) });
    return;
  }

  apply({
    ...spec.value,
    linear: {
      angle: 160,
      stops: [
        { color: shade(spec.value.base, LIFT), at: 0 },
        { color: spec.value.base, at: 1 },
      ],
    },
  });
}

function setAngle(angle: number): void {
  if (!linear.value) return;
  apply({ ...spec.value, linear: { ...linear.value, angle: ((angle % 360) + 360) % 360 } });
}

function setStops(next: readonly GradientStop[]): void {
  if (!linear.value) return;
  apply({ ...spec.value, linear: { ...linear.value, stops: next } });
}

function patchStop(index: number, change: Partial<GradientStop>): void {
  setStops(stops.value.map((stop, at) => (at === index ? { ...stop, ...change } : stop)));
}

/**
 * A stop added where the bar was clicked, in the colour the ramp already has
 * there — so the picture is unchanged until it is dragged or recoloured.
 */
function addStop(at: number): void {
  const next = [...stops.value, { color: sampleStops(stops.value, at), at }];
  setStops(next);
  picked.value = { kind: 'stop', index: next.length - 1 };
}

/**
 * Two is the fewest a ramp can be made of, so the last two cannot be removed.
 * Turning the ramp off entirely is the switch above, which says what it does.
 */
function removeStop(index: number): void {
  if (stops.value.length <= 2) return;

  setStops(stops.value.filter((_stop, at) => at !== index));
  picked.value = undefined;
}

// --- the spots -----------------------------------------------------------

function patchSpot(index: number, change: Partial<GradientSpot>): void {
  apply({
    ...spec.value,
    spots: spots.value.map((spot, at) => (at === index ? { ...spot, ...change } : spot)),
  });
}

function addSpot(x: number, y: number): number {
  const next = [...spots.value, { ...NEW_SPOT, x, y }];
  apply({ ...spec.value, spots: next });

  const index = next.length - 1;
  picked.value = { kind: 'spot', index };
  return index;
}

function removeSpot(index: number): void {
  apply({ ...spec.value, spots: spots.value.filter((_spot, at) => at !== index) });
  picked.value = undefined;
}

// --- whatever is selected ------------------------------------------------

function setChosenColor(color: string): void {
  const at = picked.value;
  if (!at) return;

  if (at.kind === 'stop') patchStop(at.index, { color });
  else patchSpot(at.index, { color });
}

function setChosenOpacity(percent: number): void {
  if (chosenColor.value === undefined) return;
  setChosenColor(withOpacity(chosenColor.value, percent / 100));
}

function removeChosen(): void {
  const at = picked.value;
  if (!at) return;

  if (at.kind === 'stop') removeStop(at.index);
  else removeSpot(at.index);
}

// --- the key, and dragging on it -----------------------------------------

const clamp = (value: number, low = 0, high = 1): number =>
  Math.min(high, Math.max(low, value));

/** Where the pointer is on the key, 0..1 from the top-left corner. */
function pointOn(element: HTMLElement | undefined, event: PointerEvent): { x: number; y: number } {
  const box = element?.getBoundingClientRect();
  if (!box) return { x: 0, y: 0 };

  return {
    x: clamp((event.clientX - box.left) / box.width),
    y: clamp((event.clientY - box.top) / box.height),
  };
}

/**
 * Pressing an empty part of the key puts a spot there and starts moving it.
 *
 * One gesture rather than two: a button that adds one in the middle for you to
 * then drag is the same work with a step in it, and "put it here" is what the
 * hand was already doing.
 */
function onSurfaceDown(event: PointerEvent): void {
  const point = pointOn(surface.value, event);
  const index = addSpot(point.x, point.y);

  dragging.value = { kind: 'spot', index };
  surface.value?.setPointerCapture(event.pointerId);
}

function onSpotDown(index: number, event: PointerEvent): void {
  picked.value = { kind: 'spot', index };
  dragging.value = { kind: 'spot', index };
  surface.value?.setPointerCapture(event.pointerId);
}

function onEndDown(end: 0 | 1, event: PointerEvent): void {
  dragging.value = { kind: 'angle', end };
  surface.value?.setPointerCapture(event.pointerId);
}

/**
 * Dragging either end of the line turns the ramp.
 *
 * The far end follows the near one, because the line always runs through the
 * middle of the key: what is being set is a direction, and a gradient with an
 * off-centre line is a thing this format cannot store or the panel draw.
 * Holding shift snaps to fifteen degrees, for the eight obvious directions.
 */
function onSurfaceMove(event: PointerEvent): void {
  const held = dragging.value;
  if (!held) return;

  const point = pointOn(surface.value, event);

  if (held.kind === 'spot') {
    patchSpot(held.index, { x: point.x, y: point.y });
    return;
  }

  const degrees = (Math.atan2(point.x - 0.5, 0.5 - point.y) * 180) / Math.PI;
  const aimed = held.end === 1 ? degrees : degrees + 180;
  setAngle(event.shiftKey ? Math.round(aimed / 15) * 15 : Math.round(aimed));
}

function onSurfaceUp(event: PointerEvent): void {
  dragging.value = undefined;
  surface.value?.releasePointerCapture(event.pointerId);
}

// --- the bar -------------------------------------------------------------

function onBarDown(event: PointerEvent): void {
  addStop(pointOn(bar.value, event).x);
}

function onStopDown(index: number, event: PointerEvent): void {
  picked.value = { kind: 'stop', index };
  draggingStop.value = index;
  bar.value?.setPointerCapture(event.pointerId);
}

function onBarMove(event: PointerEvent): void {
  const index = draggingStop.value;
  if (index === undefined) return;

  patchStop(index, { at: pointOn(bar.value, event).x });
}

function onBarUp(event: PointerEvent): void {
  draggingStop.value = undefined;
  bar.value?.releasePointerCapture(event.pointerId);
}

// --- ready-made ----------------------------------------------------------

/**
 * Six that are worth having, and one of them is what most keys want.
 *
 * A gradient editor with nothing in it is a blank canvas handed to somebody who
 * came here to make a key look better, not to mix colours. Each of these is a
 * complete background — the colour underneath included — so one press is a
 * finished key that can then be argued with.
 */
const PRESETS: readonly GradientBackground[] = [
  {
    base: '#14161c',
    linear: { angle: 160, stops: [{ color: '#2b3446', at: 0 }, { color: '#14161c', at: 1 }] },
  },
  {
    base: '#0b1220',
    linear: { angle: 150, stops: [{ color: '#1e3a8a', at: 0 }, { color: '#0b1220', at: 1 }] },
    spots: [{ color: '#38bdf866', x: 0.75, y: 0.2, radius: 0.5 }],
  },
  {
    base: '#3b1414',
    linear: { angle: 155, stops: [{ color: '#f97316', at: 0 }, { color: '#7c2d12', at: 1 }] },
  },
  {
    base: '#05221c',
    linear: { angle: 150, stops: [{ color: '#0f766e', at: 0 }, { color: '#05221c', at: 1 }] },
    spots: [{ color: '#34d39955', x: 0.25, y: 0.25, radius: 0.45 }],
  },
  {
    base: '#120e1c',
    spots: [
      { color: '#a855f7aa', x: 0.2, y: 0.2, radius: 0.55 },
      { color: '#22d3eeaa', x: 0.8, y: 0.8, radius: 0.55 },
    ],
  },
  {
    base: '#1a1a1a',
    linear: { angle: 180, stops: [{ color: '#4b5563', at: 0 }, { color: '#111111', at: 1 }] },
  },
];

function usePreset(preset: GradientBackground): void {
  picked.value = undefined;
  apply(preset);
}

// --- closing -------------------------------------------------------------

/** What was on the key when this opened, for the one who changes their mind. */
const before = props.background;

function cancel(): void {
  emit('update', before);
  emit('close');
}

/**
 * Escape gives up, and stops there.
 *
 * Three windows can be on screen at once and each closes on Escape, so which
 * one hears it is decided by where each listens. The colour picker takes the
 * key on the way down, in the capture phase, and stops it; this window listens
 * on the way back up, so a colour panel over it gets the press first; and the
 * button editor underneath listens on `window`, which the bubble ends at — so
 * stopping the event here keeps a whole key someone is still working on from
 * being thrown away by one press.
 */
function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.stopPropagation();
    cancel();
    return;
  }

  // Only when the key itself has focus: Delete belongs to whatever field the
  // pointer is in, and a hex being edited is exactly where it is pressed most.
  const target = event.target as HTMLElement | null;
  if (event.key !== 'Delete' || target?.tagName === 'INPUT') return;

  removeChosen();
}

onMounted(() => document.addEventListener('keydown', onKey));
onBeforeUnmount(() => document.removeEventListener('keydown', onKey));
</script>

<template>
  <div class="backdrop" @click.self="cancel">
    <div class="dialog" role="dialog" aria-modal="true" :aria-label="t('gradient.title')">
      <header>
        <h2>{{ t('gradient.title') }}</h2>
        <button type="button" class="close" :aria-label="t('settings.close')" @click="cancel">
          ✕
        </button>
      </header>

      <p class="muted hint">{{ t('gradient.hint') }}</p>

      <!--
        The key at the size the window can spare, and the only place the two
        kinds of thing meet: the line says which way the ramp runs, the circles
        say where the light is. Both are dragged where they are, on the picture
        they change.
      -->
      <div
        ref="surface"
        class="key"
        :style="{ background: css }"
        @pointerdown.self="onSurfaceDown"
        @pointermove="onSurfaceMove"
        @pointerup="onSurfaceUp"
        @pointercancel="onSurfaceUp"
      >
        <template v-if="linear">
          <span class="line" :style="lineStyle" />

          <span
            v-for="end in ([0, 1] as const)"
            :key="end"
            class="end"
            :style="ends[end]"
            :title="t('gradient.angle')"
            @pointerdown.stop="onEndDown(end, $event)"
          />
        </template>

        <span
          v-for="(spot, index) in spots"
          :key="index"
          class="spot"
          :class="{ current: picked?.kind === 'spot' && picked.index === index }"
          :style="{
            left: `${spot.x * 100}%`,
            top: `${spot.y * 100}%`,
            background: spot.color,
          }"
          :title="t('gradient.spot')"
          @pointerdown.stop="onSpotDown(index, $event)"
        />
      </div>

      <!-- Whole backgrounds rather than ramps: one press is a finished key. -->
      <div class="presets" :aria-label="t('gradient.presets')">
        <button
          v-for="(preset, index) in PRESETS"
          :key="index"
          type="button"
          class="preset"
          :style="{ background: backgroundCss(preset) }"
          :title="t('gradient.presets')"
          @click="usePreset(preset)"
        />
      </div>

      <!-- The ramp: a switch, the bar it is made of, and which way it runs. -->
      <div class="section">
        <label class="switch">
          <input type="checkbox" :checked="Boolean(linear)" @change="toggleLinear" />
          <span>{{ t('gradient.linear') }}</span>
        </label>

        <template v-if="linear">
          <div
            ref="bar"
            class="bar"
            :title="t('gradient.addStop')"
            @pointerdown.self="onBarDown"
            @pointermove="onBarMove"
            @pointerup="onBarUp"
            @pointercancel="onBarUp"
          >
            <!-- The ramp itself, over the chequer that shows through wherever
                 a stop is faded, and never in the pointer's way. -->
            <span class="ramp" :style="{ backgroundImage: rampCss }" />

            <span
              v-for="(stop, index) in stops"
              :key="index"
              class="stop"
              :class="{ current: picked?.kind === 'stop' && picked.index === index }"
              :style="{ left: `${stop.at * 100}%`, background: stop.color }"
              @pointerdown.stop="onStopDown(index, $event)"
              @dblclick.stop="removeStop(index)"
            />
          </div>

          <label class="field">
            <span>{{ t('gradient.angle') }}</span>
            <input
              type="range"
              min="0"
              max="359"
              :value="linear.angle"
              @input="setAngle(Number(($event.target as HTMLInputElement).value))"
            />
            <input
              type="number"
              class="degrees"
              min="0"
              max="359"
              :value="Math.round(linear.angle)"
              @input="setAngle(Number(($event.target as HTMLInputElement).value))"
            />
          </label>
        </template>
      </div>

      <!--
        What is selected, wherever it was selected: one colour, one strength,
        and the one number that differs between a stop and a spot. Three rows
        that change their meaning read worse than three rows that stay put.
      -->
      <div class="section chosen">
        <template v-if="picked && chosenColor !== undefined">
          <div class="row">
            <ColorPicker
              :label="picked.kind === 'spot' ? t('gradient.spot') : t('gradient.stop')"
              :model-value="chosenColor"
              @update:model-value="setChosenColor"
            />

            <button
              type="button"
              class="drop"
              :title="t('gradient.remove')"
              :aria-label="t('gradient.remove')"
              :disabled="picked.kind === 'stop' && stops.length <= 2"
              @click="removeChosen"
            >
              ✕
            </button>
          </div>

          <label class="field">
            <span>{{ t('gradient.opacity') }}</span>
            <input
              type="range"
              min="0"
              max="100"
              :value="chosenOpacity"
              @input="setChosenOpacity(Number(($event.target as HTMLInputElement).value))"
            />
          </label>

          <label v-if="picked.kind === 'spot'" class="field">
            <span>{{ t('gradient.radius') }}</span>
            <input
              type="range"
              min="5"
              max="150"
              :value="Math.round((spots[picked.index]?.radius ?? 0) * 100)"
              @input="
                patchSpot(picked.index, {
                  radius: Number(($event.target as HTMLInputElement).value) / 100,
                })
              "
            />
          </label>

          <label v-else class="field">
            <span>{{ t('gradient.position') }}</span>
            <input
              type="range"
              min="0"
              max="100"
              :value="Math.round((stops[picked.index]?.at ?? 0) * 100)"
              @input="
                patchStop(picked.index, {
                  at: Number(($event.target as HTMLInputElement).value) / 100,
                })
              "
            />
          </label>
        </template>

        <p v-else class="muted hint">{{ t('gradient.nothing') }}</p>
      </div>

      <footer>
        <!-- The colour under all of it, kept here as well as in the row this
             opened from: it is half of every gradient, and going back out to
             change it would be leaving the picture to adjust the picture. -->
        <ColorPicker
          :label="t('gradient.base')"
          :model-value="spec.base"
          @update:model-value="setBase"
        />

        <button type="button" @click="cancel">{{ t('prompt.cancel') }}</button>
        <button type="button" class="primary" @click="emit('close')">
          {{ t('gradient.done') }}
        </button>
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
  max-height: 92vh;
  overflow-y: auto;
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

/* Square, and rounded like a key: every judgement made here is about how a
   colour sits on one. */
.key {
  position: relative;
  width: 100%;
  aspect-ratio: 1;
  max-height: 220px;
  margin: 0 auto;
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
  cursor: crosshair;
  touch-action: none;
}

/* Faint, and out of the pointer's way: it says which way the ramp runs, and
   the two ends are what anybody actually grabs. */
.line {
  position: absolute;
  height: 1px;
  transform-origin: 0 50%;
  background: rgb(255 255 255 / 0.7);
  box-shadow: 0 0 0 1px rgb(0 0 0 / 0.35);
  pointer-events: none;
}

.end,
.spot {
  position: absolute;
  border-radius: 50%;
  border: 2px solid #ffffff;
  box-shadow: 0 0 0 1px rgb(0 0 0 / 0.5);
  transform: translate(-50%, -50%);
  cursor: grab;
  touch-action: none;
}

.end {
  width: 12px;
  height: 12px;
  background: rgb(0 0 0 / 0.25);
}

.spot {
  width: 16px;
  height: 16px;
}

/* The selected one wears the accent, the same as everywhere else a thing can
   be chosen: which spot the sliders below are about must never be a guess. */
.spot.current {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px rgb(0 0 0 / 0.5), 0 0 0 4px var(--accent-soft);
}

.presets {
  display: flex;
  gap: 6px;
}

.preset {
  flex: 1;
  height: 26px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
}

.preset:hover { border-color: var(--accent); }

.section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}

.switch {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  cursor: pointer;
}

.switch input { margin: 0; }

/* The ramp laid flat, on a chequer so a stop that fades out says so. */
.bar {
  position: relative;
  height: 22px;
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: copy;
  touch-action: none;
  background:
    repeating-conic-gradient(rgb(255 255 255 / 0.14) 0% 25%, rgb(0 0 0 / 0.14) 0% 50%) 0 0 /
    10px 10px;
}

.ramp {
  position: absolute;
  inset: 0;
  border-radius: 5px;
  pointer-events: none;
}

.stop {
  position: absolute;
  top: 50%;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid #ffffff;
  box-shadow: 0 0 0 1px rgb(0 0 0 / 0.5);
  transform: translate(-50%, -50%);
  cursor: grab;
  touch-action: none;
}

.stop.current {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px rgb(0 0 0 / 0.5), 0 0 0 3px var(--accent-soft);
}

.field {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--text-muted);
}

.field > span {
  flex: none;
  width: 84px;
}

.field input[type='range'] {
  flex: 1;
  min-width: 0;
}

.degrees {
  flex: none;
  width: 54px;
  padding: 3px 4px;
  font-size: 12px;
  text-align: center;
}

/* Kept at a fixed height so the window does not jump every time something is
   selected or let go of. */
.chosen {
  min-height: 104px;
}

.row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.row > :first-child {
  flex: 1;
  min-width: 0;
}

.drop {
  flex: none;
  padding: 4px 8px;
  background: none;
  border: 1px solid var(--border);
  color: var(--text-muted);
}

.drop:disabled { opacity: 0.4; cursor: default; }

footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}

footer > :first-child {
  flex: 1;
  min-width: 0;
  margin-right: auto;
}
</style>

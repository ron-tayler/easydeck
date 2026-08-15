<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import {
  backgroundBase,
  backgroundCss,
  contrastInk,
  hasGradient,
  withoutGradient,
} from '@easydeck/engine/background';
import type { BackgroundSpec } from '@easydeck/engine/background';

import GradientEditor from './GradientEditor.vue';

/**
 * The gradient, as one button in the row the background lives on.
 *
 * Beside the colour rather than instead of it, and for the same reason the
 * picture and the colour stand together: the colour is what a gradient is drawn
 * on, not an alternative to it. Pressing this opens the editor; what it shows
 * meanwhile is the key's own background, so the row reports what the key looks
 * like rather than describing it.
 */

const props = defineProps<{
  background?: BackgroundSpec;
  /** Names the button. Without a word it is a rectangle with a picture of one. */
  label?: string;
}>();

const emit = defineEmits<{ update: [value: BackgroundSpec | undefined] }>();

const { t } = useI18n();

const editing = ref(false);

const present = computed(() => hasGradient(props.background));

const preview = computed(() => backgroundCss(props.background));

/**
 * Read against the colour underneath rather than the gradient over it.
 *
 * The same judgement the colour button beside it makes, from the same function:
 * the two stand side by side showing two versions of one background, and one of
 * them deciding differently about black or white would be visible.
 */
const ink = computed(() => contrastInk(backgroundBase(props.background) ?? '#111318'));
</script>

<template>
  <span class="gradient">
    <button
      type="button"
      class="choose"
      :class="{ wide: label, on: present }"
      :style="{ background: preview, color: ink }"
      :title="present ? t('gradient.change') : t('gradient.add')"
      :aria-label="present ? t('gradient.change') : t('gradient.add')"
      @click="editing = true"
    >
      <!-- A square with light falling across it: the one mark that says
           "gradient" without a word, and readable on whatever it is drawn on. -->
      <svg class="glyph" viewBox="0 0 16 16" aria-hidden="true">
        <defs>
          <linearGradient id="gradient-glyph" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stop-color="currentColor" stop-opacity="0.15" />
            <stop offset="1" stop-color="currentColor" stop-opacity="0.95" />
          </linearGradient>
        </defs>
        <rect
          x="1.8"
          y="1.8"
          width="12.4"
          height="12.4"
          rx="2.4"
          fill="url(#gradient-glyph)"
          stroke="currentColor"
          stroke-width="1.2"
        />
      </svg>

      <span v-if="label" class="name">{{ label }}</span>
    </button>

    <!-- Only once there is one to take off, like the picture's own cross. -->
    <button
      v-if="present"
      type="button"
      class="clear"
      :title="t('gradient.clear')"
      :aria-label="t('gradient.clear')"
      @click="emit('update', withoutGradient(background))"
    >
      ✕
    </button>

    <GradientEditor
      v-if="editing"
      :background="background"
      @update="emit('update', $event)"
      @close="editing = false"
    />
  </span>
</template>

<style scoped>
.gradient {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.choose {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  height: 30px;
  padding: 0 9px;
  font-size: 12px;
  /* The colour it is showing is arbitrary, so the glyph and any word beside it
     carry their own shadow — the same arrangement the colour button uses. */
  text-shadow: 0 0 2px rgb(0 0 0 / 0.25);
}

.choose.wide {
  flex: 1;
}

.choose.on {
  border-color: var(--accent);
}

.glyph {
  flex: none;
  width: 17px;
  height: 17px;
  filter: drop-shadow(0 0 1px rgb(0 0 0 / 0.35));
}

.name {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.clear {
  flex: none;
  padding: 4px 7px;
  background: none;
  border: none;
  color: var(--text-muted);
}

.clear:hover { color: var(--danger); }
</style>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { IconSpec, LibraryImage } from '@easydeck/core';

import IconLibrary from './IconLibrary.vue';
import { LARGE_IMAGE_BYTES, isAnimated } from '../icons/rasterize.js';

/**
 * The button's picture: what it is now, and one way to change it.
 *
 * This used to be the library itself — a column of tiles three wide, wedged
 * into the editor beside everything else a button has. It was the wrong shape
 * for the job twice over: too narrow to browse several hundred pictures, and
 * always present whether or not anyone was choosing one. The collection now
 * opens in a window with room for it, and what stays here is the answer to
 * "what does this key show" plus the button that changes it.
 */

const props = defineProps<{
  icon?: IconSpec;
  /** The label colour, so a library icon matches the text beside it. */
  color: string;
  /** The user's own folder, read by the daemon; empty until it is fetched. */
  userIcons: readonly LibraryImage[];
  /** Pictures the folder holds but the library had no room for. */
  omittedIcons?: number;
}>();

const emit = defineEmits<{ update: [icon: IconSpec | undefined] }>();

const { t } = useI18n();

const browsing = ref(false);

const animated = computed(() => Boolean(props.icon && isAnimated(props.icon.source)));
const heavy = computed(() => Boolean(props.icon && props.icon.source.length > LARGE_IMAGE_BYTES));

function patch(change: Partial<IconSpec>): void {
  if (!props.icon) return;
  emit('update', { ...props.icon, ...change });
}

function chosen(source: string): void {
  // Keeps whatever else was set — the fit, above all — so picking a different
  // picture does not quietly undo how the last one was framed.
  emit('update', { ...props.icon, source });
  browsing.value = false;
}
</script>

<template>
  <div class="picker">
    <div class="head">
      <span class="muted">{{ t('editor.icon') }}</span>
      <button v-if="icon" type="button" class="clear" @click="emit('update', undefined)">
        {{ t('editor.iconClear') }}
      </button>
    </div>

    <button type="button" class="choose" @click="browsing = true">
      <img v-if="icon" :src="icon.source" alt="" />
      <span v-else class="none">＋</span>
      <span class="what">
        <span>{{ icon ? t('editor.iconChange') : t('editor.iconChoose') }}</span>
        <span v-if="icon" class="facts muted">
          <span v-if="animated" class="badge">GIF</span>
          {{ Math.round(icon.source.length / 1024) }} KB
        </span>
      </span>
    </button>

    <p v-if="heavy" class="warn">{{ t('editor.iconHeavy') }}</p>

    <div v-if="icon" class="pair">
      <label class="field">
        <span>{{ t('editor.iconFit') }}</span>
        <select
          :value="icon.fit ?? 'cover'"
          @change="patch({ fit: ($event.target as HTMLSelectElement).value as 'contain' | 'cover' })"
        >
          <option value="cover">{{ t('editor.iconFits.cover') }}</option>
          <option value="contain">{{ t('editor.iconFits.contain') }}</option>
        </select>
      </label>
    </div>

    <IconLibrary
      v-if="browsing"
      :color="color"
      :user-icons="userIcons"
      :omitted="omittedIcons ?? 0"
      @pick="chosen"
      @close="browsing = false"
    />
  </div>
</template>

<style scoped>
.picker {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
}

.clear {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 11px;
  padding: 2px 4px;
}

.clear:hover {
  color: var(--danger);
}

.choose {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-2);
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.choose:hover {
  border-color: var(--accent);
}

.choose img,
.choose .none {
  width: 48px;
  height: 48px;
  flex-shrink: 0;
  object-fit: contain;
  display: grid;
  place-items: center;
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-muted);
  font-size: 20px;
}

.what {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.facts {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
}

.badge {
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--surface-1);
  border: 1px solid var(--border);
  font-size: 10px;
}

.pair {
  display: flex;
  gap: 8px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
  font-size: 12px;
}

.warn {
  margin: 0;
  font-size: 11px;
  color: var(--danger);
}
</style>

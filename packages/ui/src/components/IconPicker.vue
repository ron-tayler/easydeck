<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { IconSpec, LibraryImage } from '@easydeck/core';

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

function chosen(source: string): void {
  emit('update', { source });
  browsing.value = false;
}
</script>

<template>
  <span class="picture">
    <button
      type="button"
      class="choose"
      :title="icon ? t('editor.iconChange') : t('editor.iconChoose')"
      @click="browsing = true"
    >
      <img v-if="icon" :src="icon.source" alt="" />
      <span v-else class="empty">{{ t('editor.iconChoose') }}</span>
      <span v-if="animated" class="badge">GIF</span>
    </button>

    <button
      v-if="icon"
      type="button"
      class="clear"
      :title="t('editor.iconClear')"
      @click="emit('update', undefined)"
    >
      ✕
    </button>

    <IconLibrary
      v-if="browsing"
      :color="color"
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

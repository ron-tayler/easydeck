<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { IconSpec, LibraryImage } from '@easydeck/core';

import { ICON_LIBRARY, iconSvg } from '../icons/library.js';
import type { LibraryIcon } from '../icons/library.js';
import { LARGE_IMAGE_BYTES, fileIconSource, isAnimated, libraryIconSource } from '../icons/rasterize.js';

const props = defineProps<{
  icon?: IconSpec;
  /** The label colour, so a library icon matches the text beside it. */
  color: string;
  /** The user's own folder, read by the daemon; empty until it is fetched. */
  userIcons: readonly LibraryImage[];
}>();

const emit = defineEmits<{ update: [icon: IconSpec | undefined] }>();

const { t } = useI18n();

const search = ref('');
const busy = ref(false);
const problem = ref('');

const matches = computed<readonly LibraryIcon[]>(() => {
  const query = search.value.trim().toLowerCase();
  if (query === '') return ICON_LIBRARY;

  return ICON_LIBRARY.filter(
    (icon) =>
      icon.id.includes(query) || icon.keywords.some((word) => word.toLowerCase().includes(query)),
  );
});

const userMatches = computed<readonly LibraryImage[]>(() => {
  const query = search.value.trim().toLowerCase();
  if (query === '') return props.userIcons;
  return props.userIcons.filter((image) => image.name.toLowerCase().includes(query));
});

/** Rendered inline so the grid needs no network and no build-time sprite. */
const preview = (icon: LibraryIcon): string =>
  `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(iconSvg(icon, 'currentColor'))))}`;

const animated = computed(() => Boolean(props.icon && isAnimated(props.icon.source)));

const heavy = computed(
  () => Boolean(props.icon && props.icon.source.length > LARGE_IMAGE_BYTES),
);

function patch(change: Partial<IconSpec>): void {
  if (!props.icon) return;
  emit('update', { ...props.icon, ...change });
}

async function chooseLibrary(icon: LibraryIcon): Promise<void> {
  problem.value = '';
  busy.value = true;
  try {
    emit('update', { ...props.icon, source: await libraryIconSource(icon, props.color) });
  } catch (error) {
    problem.value = error instanceof Error ? error.message : String(error);
  } finally {
    busy.value = false;
  }
}

async function chooseFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  // Cleared straight away, so picking the same file twice in a row still fires.
  input.value = '';
  if (!file) return;

  problem.value = '';
  busy.value = true;
  try {
    emit('update', { ...props.icon, source: await fileIconSource(file) });
  } catch (error) {
    problem.value = error instanceof Error ? error.message : String(error);
  } finally {
    busy.value = false;
  }
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

    <div v-if="icon" class="current">
      <img :src="icon.source" alt="" />
      <div class="facts">
        <span v-if="animated" class="badge">GIF</span>
        <span class="muted size">{{ Math.round(icon.source.length / 1024) }} KB</span>
      </div>
    </div>

    <p v-if="heavy" class="warn">{{ t('editor.iconHeavy') }}</p>
    <p v-if="problem" class="warn">{{ problem }}</p>

    <div v-if="icon" class="pair">
      <label class="field">
        <span>{{ t('editor.iconFit') }}</span>
        <select :value="icon.fit ?? 'cover'" @change="patch({ fit: ($event.target as HTMLSelectElement).value as 'contain' | 'cover' })">
          <option value="cover">{{ t('editor.iconFits.cover') }}</option>
          <option value="contain">{{ t('editor.iconFits.contain') }}</option>
        </select>
      </label>
    </div>

    <input v-model="search" type="text" class="search" :placeholder="t('editor.iconSearch')" />

    <!-- The user's own folder first: someone who put a file there is looking
         for that file, not for one of ours. -->
    <template v-if="userMatches.length > 0">
      <span class="group muted">{{ t('editor.iconMine') }}</span>
      <div class="grid">
        <button
          v-for="item in userMatches"
          :key="item.name"
          type="button"
          class="tile"
          :title="item.name"
          :disabled="busy"
          @click="emit('update', { ...icon, source: item.source })"
        >
          <img :src="item.source" alt="" />
        </button>
      </div>
    </template>

    <span v-if="userIcons.length > 0" class="group muted">{{ t('editor.iconBuiltIn') }}</span>

    <div class="grid">
      <button
        v-for="item in matches"
        :key="item.id"
        type="button"
        class="tile"
        :title="item.id"
        :disabled="busy"
        @click="chooseLibrary(item)"
      >
        <img :src="preview(item)" alt="" />
      </button>
      <p v-if="matches.length === 0 && userMatches.length === 0" class="muted none">
        {{ t('editor.iconNone') }}
      </p>
    </div>

    <label class="upload">
      <input type="file" accept="image/*,.gif" @change="chooseFile" />
      <span>{{ t('editor.iconFile') }}</span>
    </label>
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

.clear:hover { color: var(--danger); }

.current {
  display: flex;
  align-items: center;
  gap: 9px;
}

.current img {
  width: 48px;
  height: 48px;
  object-fit: contain;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 7px;
}

.facts { display: flex; flex-direction: column; gap: 3px; }

.badge {
  align-self: flex-start;
  padding: 0 5px;
  border-radius: 7px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 10px;
}

.size { font-size: 11px; }

.field { display: flex; flex-direction: column; gap: 3px; font-size: 12px; }
.field span { color: var(--text-muted); }
.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; }

.search { width: 100%; }

.group { font-size: 11px; margin-top: 2px; }

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(30px, 1fr));
  gap: 4px;
  max-height: 132px;
  overflow-y: auto;
  padding: 4px;
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: 7px;
}

.tile {
  display: grid;
  place-items: center;
  aspect-ratio: 1;
  padding: 4px;
  background: none;
  border: 1px solid transparent;
  color: var(--text);
}

.tile:hover:not(:disabled) { border-color: var(--accent); background: var(--accent-soft); }
.tile img { width: 100%; height: 100%; }

.upload input { display: none; }

.upload span {
  display: inline-block;
  padding: 4px 10px;
  font-size: 12px;
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: 7px;
  cursor: pointer;
}

.upload span:hover { border-color: var(--border-strong); }

.warn { margin: 0; font-size: 11px; color: var(--danger); line-height: 1.35; }
.none { font-size: 11px; margin: 4px; grid-column: 1 / -1; }
</style>

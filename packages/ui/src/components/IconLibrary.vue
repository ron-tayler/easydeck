<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { LibraryImage } from '@easydeck/core';

import { ICON_LIBRARY, iconSvg } from '../icons/library.js';
import type { LibraryIcon } from '../icons/library.js';
import { fileIconSource, libraryIconSource } from '../icons/rasterize.js';

/**
 * The whole icon collection, in a window of its own.
 *
 * It used to be a strip down the side of the button editor, which meant a
 * column three tiles wide for a library of several hundred pictures, and no
 * room at all for where a picture came from. A collection arrives organised —
 * by who drew it, by what it is for — and that structure is the fastest way to
 * find anything in it, so it gets the space to be shown.
 */

const props = defineProps<{
  /** The label colour, so a built-in icon matches the text beside it. */
  color: string;
  /** The user's own folder, read by the daemon. */
  userIcons: readonly LibraryImage[];
  /**
   * Pictures the folder holds that the library could not carry.
   *
   * Said out loud rather than swallowed: a file sitting in the folder and
   * absent from here looks like the program losing it.
   */
  omitted?: number;
}>();

const emit = defineEmits<{ pick: [source: string]; close: [] }>();

const { t } = useI18n();

const search = ref('');
const busy = ref(false);
const problem = ref('');

/**
 * Which folder is open, or undefined for the built-in set.
 *
 * Undefined rather than a reserved name: any name would have to be one no real
 * folder could carry, and there is no such name — "built-in" is a perfectly
 * good thing to call a folder of icons.
 */
const folder = ref<string | undefined>(undefined);

/**
 * Folders, in the order they were read, each with how many it holds.
 *
 * Nesting is shown by indentation rather than by a tree that opens and
 * closes: an icon collection is two or three levels deep at most, and a tree
 * that has to be unfolded before it says anything is slower than a list.
 */
const folders = computed(() => {
  /*
   * Every level gets a row, including the ones holding nothing but other
   * folders. A pack lands two deep — `Downloaded/Entypo+` — and listing only
   * the leaf leaves an indented name with no visible parent, which reads as a
   * bug rather than a hierarchy. The count is everything underneath, so
   * clicking a parent shows the whole branch.
   */
  const counted = new Map<string, number>();

  for (const image of props.userIcons) {
    const group = image.group === '' ? t('icons.loose') : image.group;
    const parts = group.split('/');

    for (let depth = 1; depth <= parts.length; depth++) {
      const path = parts.slice(0, depth).join('/');
      counted.set(path, (counted.get(path) ?? 0) + 1);
    }
  }

  return [
    { path: undefined, label: t('icons.builtIn'), depth: 0, count: ICON_LIBRARY.length },
    ...[...counted]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, count]) => ({
        path,
        label: path.slice(path.lastIndexOf('/') + 1),
        depth: path.split('/').length - 1,
        count,
      })),
  ];
});


const query = computed(() => search.value.trim().toLowerCase());

/** Rendered inline so the grid needs no network and no build-time sprite. */
const preview = (icon: LibraryIcon): string =>
  `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(iconSvg(icon, 'currentColor'))))}`;

/**
 * Searching looks everywhere; browsing looks in one folder.
 *
 * Someone typing a word wants it found wherever it is — that is what the box
 * is for — and someone who has clicked a folder wants that folder.
 */
const builtIn = computed<readonly LibraryIcon[]>(() => {
  if (query.value === '') return folder.value === undefined ? ICON_LIBRARY : [];

  return ICON_LIBRARY.filter(
    (icon) =>
      icon.id.includes(query.value) ||
      icon.keywords.some((word) => word.toLowerCase().includes(query.value)),
  );
});

const mine = computed<readonly LibraryImage[]>(() => {
  if (query.value === '') {
    if (folder.value === undefined) return [];

    // A folder means everything under it, not just what lies directly inside:
    // clicking the name of a collection should show the collection.
    const loose = t('icons.loose');
    return props.userIcons.filter((image) => {
      const group = image.group === '' ? loose : image.group;
      return group === folder.value || group.startsWith(`${folder.value}/`);
    });
  }

  return props.userIcons.filter((image) => image.name.toLowerCase().includes(query.value));
});

/**
 * How many are drawn at once.
 *
 * A search across a few packs can match thousands, and every tile is an image
 * the browser has to decode. The count below the grid says what was left out,
 * so a narrower search is an obvious next move rather than a guess.
 */
const LIMIT = 400;
const shownMine = computed(() => mine.value.slice(0, LIMIT));
const shownBuiltIn = computed(() => builtIn.value.slice(0, Math.max(0, LIMIT - mine.value.length)));
const hidden = computed(
  () => mine.value.length + builtIn.value.length - shownMine.value.length - shownBuiltIn.value.length,
);

async function pickBuiltIn(icon: LibraryIcon): Promise<void> {
  problem.value = '';
  busy.value = true;
  try {
    emit('pick', await libraryIconSource(icon, props.color));
  } catch (error) {
    problem.value = error instanceof Error ? error.message : String(error);
  } finally {
    busy.value = false;
  }
}

async function pickFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  // Cleared straight away, so picking the same file twice in a row still fires.
  input.value = '';
  if (!file) return;

  problem.value = '';
  busy.value = true;
  try {
    emit('pick', await fileIconSource(file));
  } catch (error) {
    problem.value = error instanceof Error ? error.message : String(error);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="backdrop" @click.self="emit('close')" @keydown.esc="emit('close')">
    <div class="dialog" role="dialog" aria-modal="true">
      <header>
        <h2>{{ t('icons.title') }}</h2>
        <input
          v-model="search"
          type="search"
          class="search"
          :placeholder="t('icons.search')"
          autofocus
        />
        <label class="upload">
          <input type="file" accept="image/*" :disabled="busy" @change="pickFile" />
          <span>{{ t('icons.upload') }}</span>
        </label>
        <button type="button" class="close" :aria-label="t('settings.close')" @click="emit('close')">
          ✕
        </button>
      </header>

      <p v-if="problem" class="warn">{{ problem }}</p>

      <div class="body">
        <nav class="folders">
          <button
            v-for="entry in folders"
            :key="entry.path ?? ''"
            type="button"
            class="folder"
            :class="{ current: folder === entry.path && query === '' }"
            :style="{ paddingLeft: `${8 + entry.depth * 14}px` }"
            @click="((folder = entry.path), (search = ''))"
          >
            <span class="name">{{ entry.label }}</span>
            <span class="count muted">{{ entry.count }}</span>
          </button>
        </nav>

        <div class="grid">
          <!-- The user's own first: someone who put a file there is looking
               for that file, not for one of ours. -->
          <button
            v-for="item in shownMine"
            :key="`${item.group}/${item.name}`"
            type="button"
            class="tile"
            :title="item.group ? `${item.group}/${item.name}` : item.name"
            :disabled="busy"
            @click="emit('pick', item.source)"
          >
            <img :src="item.source" alt="" />
          </button>

          <button
            v-for="icon in shownBuiltIn"
            :key="icon.id"
            type="button"
            class="tile"
            :title="icon.id"
            :disabled="busy"
            @click="void pickBuiltIn(icon)"
          >
            <img :src="preview(icon)" alt="" />
          </button>

          <p v-if="shownMine.length + shownBuiltIn.length === 0" class="muted empty">
            {{ t('icons.nothing') }}
          </p>
        </div>
      </div>

      <footer v-if="hidden > 0 || (omitted ?? 0) > 0" class="muted">
        <span v-if="hidden > 0">{{ t('icons.more', { count: hidden }) }}</span>
        <span v-if="(omitted ?? 0) > 0">{{ t('icons.omitted', { count: omitted }) }}</span>
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
  z-index: 20;
}

.dialog {
  display: flex;
  flex-direction: column;
  width: min(900px, 92vw);
  height: min(640px, 88vh);
  background: var(--surface-0);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 18px 48px var(--shadow);
  overflow: hidden;
}

header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px;
  border-bottom: 1px solid var(--border);
}

h2 {
  margin: 0;
  font-size: 15px;
  white-space: nowrap;
}

.search {
  flex: 1;
  min-width: 0;
}

.upload input {
  display: none;
}

.upload span {
  display: inline-block;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
}

.close {
  border: none;
  background: none;
  color: var(--text-muted);
  font-size: 16px;
  cursor: pointer;
}

.body {
  display: flex;
  flex: 1;
  min-height: 0;
}

.folders {
  width: 220px;
  flex-shrink: 0;
  overflow-y: auto;
  border-right: 1px solid var(--border);
  padding: 6px 0;
}

.folder {
  display: flex;
  width: 100%;
  gap: 8px;
  align-items: center;
  padding: 6px 10px 6px 8px;
  border: none;
  background: none;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.folder.current {
  background: var(--accent-soft);
}

.folder .name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.count {
  font-size: 11px;
}

.grid {
  flex: 1;
  overflow-y: auto;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
  gap: 8px;
  padding: 12px;
  align-content: start;
}

.tile {
  aspect-ratio: 1;
  display: grid;
  place-items: center;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-2);
  cursor: pointer;
}

.tile:hover {
  border-color: var(--accent);
}

.tile img {
  max-width: 100%;
  max-height: 100%;
}

.empty {
  grid-column: 1 / -1;
  padding: 24px;
  text-align: center;
}

.warn {
  margin: 0;
  padding: 8px 12px;
  color: var(--danger);
}

footer {
  display: flex;
  gap: 12px;
  padding: 8px 12px;
  border-top: 1px solid var(--border);
  font-size: 12px;
}
</style>

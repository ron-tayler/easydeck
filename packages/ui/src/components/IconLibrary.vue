<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { IconSpec, LibraryImage } from '@easydeck/protocol';

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

/** A picture already on a key of this profile, and how many keys wear it. */
export interface UsedIcon {
  readonly icon: IconSpec;
  /** The picture as it is drawn — colours and parameters already in it. */
  readonly drawable: string;
  readonly uses: number;
}

const props = defineProps<{
  /**
   * Pictures already used somewhere in this profile, most used first.
   *
   * Whole specifications rather than bare artwork: choosing one should give
   * back the picture that was recognised, colours and all, and not the
   * uncoloured drawing underneath it.
   */
  profileIcons: readonly UsedIcon[];
  /** The user's own folder, read by the daemon. */
  userIcons: readonly LibraryImage[];
  /**
   * Pictures the folder holds that the library could not carry.
   *
   * Said out loud rather than swallowed: a file sitting in the folder and
   * absent from here looks like the program losing it.
   */
  omitted?: number;
  /**
   * Browsing rather than choosing.
   *
   * The same window serves two errands: picking a picture for a key, and
   * simply looking at what is installed. Looking has no use for an upload
   * button — there is a folder for that, and it is one click away — and a
   * tile that does nothing when clicked is better than one that silently
   * changes a key somewhere.
   */
  browse?: boolean;
}>();

/*
 * A whole picture rather than a path to one.
 *
 * A picture chosen from a folder or from our own set is nothing but its
 * artwork, and used to be emitted as exactly that. One chosen off a key of
 * this profile carries what was decided about it too — its ink, its parameter
 * bindings — and it is the picture as recognised that somebody is asking for.
 */
const emit = defineEmits<{ pick: [icon: IconSpec]; close: [], openFolder: [] }>();

const { t } = useI18n();

const search = ref('');
const busy = ref(false);
const problem = ref('');

/**
 * Which shelf the grid is showing.
 *
 * Spelled out rather than left to a nullable folder name, which is what this
 * was while there were only two of them. A third shelf needed a third value,
 * and every candidate was a name a real folder could also carry — "built-in"
 * is a perfectly good thing to call a folder of icons.
 */
type Shelf = { kind: 'profile' } | { kind: 'builtIn' } | { kind: 'folder'; path: string };

const shelf = ref<Shelf>({ kind: 'builtIn' });

const sameShelf = (a: Shelf, b: Shelf): boolean =>
  a.kind === b.kind && (a.kind !== 'folder' || a.path === (b as { path: string }).path);

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
    /*
     * This profile's own, first and only when it has any.
     *
     * A deck settles into a handful of pictures and then reaches for them
     * again — the same glyph on the next key, the same photograph on the next
     * folder. Recognising one of those by eye in a library of several hundred
     * was the slow way round to a picture already in the profile.
     */
    ...(props.profileIcons.length > 0
      ? [
          {
            shelf: { kind: 'profile' } as Shelf,
            label: t('icons.inProfile'),
            depth: 0,
            count: props.profileIcons.length,
          },
        ]
      : []),
    { shelf: { kind: 'builtIn' } as Shelf, label: t('icons.builtIn'), depth: 0, count: ICON_LIBRARY.length },
    ...[...counted]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, count]) => ({
        shelf: { kind: 'folder', path } as Shelf,
        label: path.slice(path.lastIndexOf('/') + 1),
        depth: path.split('/').length - 1,
        count,
      })),
  ];
});


const query = computed(() => search.value.trim().toLowerCase());


/**
 * Searching looks everywhere; browsing looks in one folder.
 *
 * Someone typing a word wants it found wherever it is — that is what the box
 * is for — and someone who has clicked a folder wants that folder.
 */
const builtIn = computed<readonly LibraryIcon[]>(() => {
  if (query.value === '') return shelf.value.kind === 'builtIn' ? ICON_LIBRARY : [];

  return ICON_LIBRARY.filter(
    (icon) =>
      icon.id.includes(query.value) ||
      icon.keywords.some((word) => word.toLowerCase().includes(query.value)),
  );
});

const mine = computed<readonly LibraryImage[]>(() => {
  if (query.value === '') {
    const open = shelf.value;
    if (open.kind !== 'folder') return [];

    // A folder means everything under it, not just what lies directly inside:
    // clicking the name of a collection should show the collection.
    const loose = t('icons.loose');
    return props.userIcons.filter((image) => {
      const group = image.group === '' ? loose : image.group;
      return group === open.path || group.startsWith(`${open.path}/`);
    });
  }

  return props.userIcons.filter((image) => image.name.toLowerCase().includes(query.value));
});

/**
 * Browsed rather than searched, because there is nothing to search by.
 *
 * A picture already on a key has no name of its own — it is bytes on a button,
 * not a file with a word attached. So this shelf is absent from search results
 * instead of matching nothing, and it is one click away when the word does not
 * come to mind.
 */
const used = computed<readonly UsedIcon[]>(() =>
  query.value === '' && shelf.value.kind === 'profile' ? props.profileIcons : [],
);

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

/**
 * A built-in icon is handed over as it is, with no colour decided here.
 *
 * There used to be a rasterizing step, which is why this was asynchronous and
 * could fail. Both went with it: the colour is now chosen after the picture,
 * beside it, and changed as often as anybody likes.
 */
function pickBuiltIn(icon: LibraryIcon): void {
  if (props.browse) return;

  problem.value = '';
  emit('pick', { source: libraryIconSource(icon) });
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
    emit('pick', { source: await fileIconSource(file) });
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
        <button v-if="browse" type="button" class="open-folder" @click="emit('openFolder')">
          {{ t('icons.openFolder') }}
        </button>

        <label v-else class="upload">
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
            :key="`${entry.shelf.kind}:${entry.label}`"
            type="button"
            class="folder"
            :class="{ current: sameShelf(shelf, entry.shelf) && query === '' }"
            :style="{ paddingLeft: `${8 + entry.depth * 14}px` }"
            @click="((shelf = entry.shelf), (search = ''))"
          >
            <span class="name">{{ entry.label }}</span>
            <span class="count muted">{{ entry.count }}</span>
          </button>
        </nav>

        <div class="grid">
          <!-- Drawn as the key draws it, since that is how it will be
               recognised — and picking it gives back that, not the uncoloured
               drawing underneath. -->
          <button
            v-for="entry in used"
            :key="entry.drawable"
            type="button"
            class="tile"
            :title="t('icons.usedOn', { count: entry.uses })"
            @click="browse ? undefined : emit('pick', entry.icon)"
          >
            <img :src="entry.drawable" alt="" />
            <span v-if="entry.uses > 1" class="uses">{{ entry.uses }}</span>
          </button>

          <!-- The user's own first: someone who put a file there is looking
               for that file, not for one of ours. -->
          <button
            v-for="item in shownMine"
            :key="`${item.group}/${item.name}`"
            type="button"
            class="tile"
            :title="item.group ? `${item.group}/${item.name}` : item.name"
            :disabled="busy"
            @click="browse ? undefined : emit('pick', { source: item.source })"
          >
            <img :src="item.source" alt="" />
          </button>

          <button
            v-for="icon in shownBuiltIn"
            :key="icon.id"
            type="button"
            class="tile"
            :title="icon.id"
            @click="pickBuiltIn(icon)"
          >
            <!--
              Inline, and the only picture here that is: these are our own
              paths from a compile-time list, so there is nothing to sanitise,
              and inline is the one form in which `currentColor` can reach the
              page's own colour. As an `<img>` each of these was a separate
              document with nothing to inherit from, so the whole library drew
              itself black on a dark tile.
            -->
            <span class="glyph" v-html="iconSvg(icon)" />
          </button>

          <p v-if="used.length + shownMine.length + shownBuiltIn.length === 0" class="muted empty">
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

.tile {
  position: relative;
}

.tile img {
  max-width: 100%;
  max-height: 100%;
}

/* How many keys already wear this one. Only past the first, because "1" on
   every tile would be a column of ones saying nothing. */
.uses {
  position: absolute;
  right: 2px;
  bottom: 2px;
  padding: 0 4px;
  border-radius: 4px;
  background: var(--surface-1);
  border: 1px solid var(--border);
  font-size: 10px;
  color: var(--text-muted);
}

/* The colour the built-in art is drawn in: `currentColor` inside it reads
   this, which is the same mechanism the key uses, only there the ink is
   written into the picture because an `<img>` cannot inherit one. */
.tile .glyph {
  display: flex;
  width: 100%;
  height: 100%;
  color: var(--text);
}

.tile .glyph :deep(svg) {
  width: 100%;
  height: 100%;
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

<script setup lang="ts">
import type { FolderDefinition } from '@easydeck/protocol';

import { useFolderDrag } from '../composables/useFolderDrag.js';
import { useKeyDrag } from '../composables/useKeyDrag.js';
import type { FolderDrop } from '../composables/useProfileEditor.js';

/** Ours alone, so a key or an action being dragged can never land in the tree. */
const FOLDER_MIME = 'application/x-easydeck-folder';

/**
 * A key from the grid, which the tree opens folders for but never accepts.
 *
 * Resting on a folder walks into it and the drag carries on inside — dropping
 * a key on a folder row would have to invent an answer to "onto which of its
 * keys", and there isn't one.
 */
const KEY_MIME = 'application/x-easydeck-key';

const props = defineProps<{
  folders: readonly FolderDefinition[];
  currentFolderId?: string;
  /** Ids on the path to the current folder, so ancestors read as active too. */
  openIds: ReadonlySet<string>;
  /** The one folder that cannot be moved, and can only be dropped into. */
  rootId?: string;
  depth?: number;
}>();

const emit = defineEmits<{
  open: [folderId: string];
  menu: [payload: { folderId: string; x: number; y: number }];
  move: [payload: { folderId: string; targetId: string; drop: FolderDrop }];
}>();

const drag = useFolderDrag();
const keys = useKeyDrag();

const isRoot = (folderId: string): boolean => folderId === props.rootId;

/** Where on a row the cursor is: its edges mean beside, its middle means into. */
const EDGE = 0.3;

function dropSide(folderId: string, event: DragEvent): FolderDrop {
  // The root is the tree; there is no beside it.
  if (isRoot(folderId)) return 'inside';

  const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const offset = (event.clientY - box.top) / box.height;

  if (offset < EDGE) return 'before';
  if (offset > 1 - EDGE) return 'after';
  return 'inside';
}

function onDragStart(folder: FolderDefinition, event: DragEvent): void {
  drag.start(folder);
  event.dataTransfer?.setData(FOLDER_MIME, folder.id);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
}

function onDragOver(folder: FolderDefinition, event: DragEvent): void {
  const types = event.dataTransfer?.types ?? [];

  /*
   * A key resting here opens the folder, and that is all. No preventDefault,
   * so the row never reads as somewhere the key could be let go — the same
   * `open` a click would emit, because walking in is walking in however it
   * was asked for.
   */
  if (types.includes(KEY_MIME)) {
    keys.dwell(folder.id, () => emit('open', folder.id));
    return;
  }

  if (!types.includes(FOLDER_MIME)) return;
  // Not preventing the default is what shows the cursor a folder cannot go
  // here — which is the answer for a folder's own descendants.
  if (!drag.accepts(folder.id)) return;

  event.preventDefault();
  event.stopPropagation();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';

  drag.over(folder.id, dropSide(folder.id, event));
}

function onDrop(folder: FolderDefinition, event: DragEvent): void {
  const folderId = event.dataTransfer?.getData(FOLDER_MIME);
  const drop = dropSide(folder.id, event);
  drag.end();

  if (folderId && folderId !== folder.id) emit('move', { folderId, targetId: folder.id, drop });
}

/**
 * Leaving for good, rather than crossing into the row's own label.
 *
 * `dragleave` fires on the way to a child element too, and a clock stopped by
 * that would never run down: the pointer is always over one span or another.
 */
function onDragLeave(folder: FolderDefinition, event: DragEvent): void {
  const to = event.relatedTarget as Node | null;
  if (to && (event.currentTarget as HTMLElement).contains(to)) return;

  keys.leave(folder.id);
}

const marks = (folder: FolderDefinition) => {
  const at = drag.target.value;
  const on = at?.folderId === folder.id;

  return {
    current: folder.id === props.currentFolderId,
    ancestor: props.openIds.has(folder.id),
    lifted: drag.dragging.value === folder.id,
    waiting: keys.dwelling.value === folder.id,
    'drop-before': on && at?.drop === 'before',
    'drop-after': on && at?.drop === 'after',
    'drop-inside': on && at?.drop === 'inside',
  };
};
</script>

<template>
  <ul class="tree" :class="{ nested: (depth ?? 0) > 0 }">
    <li v-for="folder in folders" :key="folder.id">
      <button
        type="button"
        class="folder"
        :class="marks(folder)"
        :style="{ paddingLeft: `${8 + (depth ?? 0) * 14}px` }"
        :draggable="!isRoot(folder.id)"
        @click="emit('open', folder.id)"
        @contextmenu.prevent="
          emit('menu', { folderId: folder.id, x: $event.clientX, y: $event.clientY })
        "
        @dragstart="onDragStart(folder, $event)"
        @dragend="drag.end()"
        @dragover="onDragOver(folder, $event)"
        @dragleave="onDragLeave(folder, $event)"
        @drop.prevent.stop="onDrop(folder, $event)"
      >
        <span class="name">{{ folder.name }}</span>
        <!-- Pages are the other axis of the same scene, so their count belongs
             here rather than as separate tree nodes. -->
        <span v-if="folder.pages.length > 1" class="count">{{ folder.pages.length }}</span>
      </button>

      <FolderTree
        v-if="folder.folders && folder.folders.length > 0"
        :folders="folder.folders"
        :current-folder-id="currentFolderId"
        :open-ids="openIds"
        :root-id="rootId"
        :depth="(depth ?? 0) + 1"
        @open="emit('open', $event)"
        @menu="emit('menu', $event)"
        @move="emit('move', $event)"
      />
    </li>
  </ul>
</template>

<style scoped>
.tree {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nested {
  margin-top: 2px;
}

.folder {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  background: none;
  border: 1px solid transparent;
  border-radius: 7px;
  padding: 6px 8px;
  font-size: 13px;
  text-align: left;
}

.folder:hover:not(:disabled) {
  background: var(--surface-2);
  border-color: transparent;
}

.folder.ancestor {
  color: var(--accent);
}

.folder.current {
  background: var(--accent-soft);
  color: var(--accent);
}

/* The row being carried stays where it is, faded, so the tree does not
   reshuffle under the cursor mid-drag. */
.folder.lifted {
  opacity: 0.4;
}

/* A line between two rows means beside them; the whole row lit up means into
   it. The difference has to be readable at a glance, since it is the only
   thing telling nesting from ordering. */
.folder.drop-before {
  box-shadow: inset 0 2px 0 var(--accent);
}

.folder.drop-after {
  box-shadow: inset 0 -2px 0 var(--accent);
}

.folder.drop-inside {
  border-color: var(--accent);
  background: var(--accent-soft);
}

/* A key resting here: the row says it is about to be walked into, and the
   sweep of the bar is the half-second it takes. */
.folder.waiting {
  border-color: var(--accent);
  background: linear-gradient(to right, var(--accent-soft) 50%, transparent 50%) right / 200% 100%
    no-repeat;
  animation: sweep 0.5s linear forwards;
}

@keyframes sweep {
  to {
    background-position: left;
  }
}

.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.count {
  flex: none;
  font-size: 11px;
  color: var(--text-muted);
  background: var(--surface-2);
  border-radius: 999px;
  padding: 1px 6px;
}
</style>

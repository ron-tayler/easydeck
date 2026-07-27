<script setup lang="ts">
import type { FolderDefinition } from '@easydeck/core';

defineProps<{
  folders: readonly FolderDefinition[];
  currentFolderId?: string;
  /** Ids on the path to the current folder, so ancestors read as active too. */
  openIds: ReadonlySet<string>;
  depth?: number;
}>();

const emit = defineEmits<{ open: [folderId: string] }>();
</script>

<template>
  <ul class="tree" :class="{ nested: (depth ?? 0) > 0 }">
    <li v-for="folder in folders" :key="folder.id">
      <button
        type="button"
        class="folder"
        :class="{ current: folder.id === currentFolderId, ancestor: openIds.has(folder.id) }"
        :style="{ paddingLeft: `${8 + (depth ?? 0) * 14}px` }"
        @click="emit('open', folder.id)"
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
        :depth="(depth ?? 0) + 1"
        @open="emit('open', $event)"
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

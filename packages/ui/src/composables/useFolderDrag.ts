import { ref } from 'vue';
import type { FolderDefinition } from '@easydeck/protocol';

import type { FolderDrop } from './useProfileEditor.js';

/**
 * The folder currently being dragged, and where it would land.
 *
 * Module state, not per-component: the tree draws itself recursively, so a
 * drag that starts in one instance finishes in another, and the row under the
 * cursor has to be the only one showing a line. Handing this down through the
 * props of every level would mean the root being told about a hover three
 * levels below it for no reason of its own.
 *
 * One gesture at a time is all a pointer can do, so one set of refs is all
 * this needs.
 */

/** What the cursor is over, once it is a place a folder could go. */
export interface FolderDropTarget {
  readonly folderId: string;
  readonly drop: FolderDrop;
}

const dragging = ref<string>();
const target = ref<FolderDropTarget>();

/**
 * The dragged folder and everything under it.
 *
 * Kept as ids so any row can ask whether it is off limits without walking the
 * tree again — a folder may not be dropped onto its own descendants, since
 * that would take the branch out of the tree along with itself.
 */
const carried = ref<ReadonlySet<string>>(new Set());

function collect(folder: FolderDefinition, into = new Set<string>()): Set<string> {
  into.add(folder.id);
  for (const child of folder.folders ?? []) collect(child, into);
  return into;
}

export function useFolderDrag() {
  return {
    dragging,
    target,

    start(folder: FolderDefinition): void {
      dragging.value = folder.id;
      carried.value = collect(folder);
      target.value = undefined;
    },

    over(folderId: string, drop: FolderDrop): void {
      target.value = { folderId, drop };
    },

    /** True while a folder is in flight and this one is not part of it. */
    accepts(folderId: string): boolean {
      return dragging.value !== undefined && !carried.value.has(folderId);
    },

    end(): void {
      dragging.value = undefined;
      target.value = undefined;
      carried.value = new Set();
    },
  };
}

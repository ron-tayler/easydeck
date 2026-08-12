import { ref } from 'vue';

/**
 * A key being carried between pages and folders.
 *
 * Module state for the same reason the folder tree's is: one pointer, one
 * gesture, and the pieces that have to agree about it — the grid, the tree,
 * the pagination, the cancel zone — are scattered across the window with no
 * common parent worth threading it through.
 *
 * The awkward part this exists to solve is that the drag *navigates*. Hovering
 * a folder opens it, so by the time the key is dropped, "the page it came
 * from" is no longer the page on screen. Both ends are therefore carried in
 * the drag itself rather than read from wherever the deck happens to be.
 */

/** The key in flight, and the page it was picked up from. */
export interface CarriedKey {
  readonly pageId: string;
  readonly key: number;
}

/** Where the deck stood when the drag began, to go back to if it is called off. */
export interface DragOrigin {
  readonly folderId: string;
  readonly pageId: string;
}

/**
 * How long the pointer has to rest on a folder or a page before it opens.
 *
 * Long enough that crossing the tree on the way somewhere else does not leaf
 * through three folders, short enough not to feel like waiting. Half a second
 * is the figure every file manager settled on.
 */
const DWELL_MS = 500;

const carried = ref<CarriedKey>();
const origin = ref<DragOrigin>();
/** The folder or page the pointer is resting on, whether or not it has opened. */
const dwelling = ref<string>();
/** Set by whoever consumes the drop, so letting go afterwards changes nothing. */
let landed = false;
let timer: ReturnType<typeof setTimeout> | undefined;

function stopClock(): void {
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
}

export function useKeyDrag() {
  return {
    carried,
    dwelling,

    start(key: CarriedKey, from: DragOrigin): void {
      carried.value = key;
      origin.value = from;
      landed = false;
      dwelling.value = undefined;
      stopClock();
    },

    /**
     * The pointer is over something that can be opened.
     *
     * Called on every dragover, so resting on the same target has to be free:
     * the clock is started once and left alone, and having fired it is not
     * restarted, or a pointer parked on a folder would reopen it forever.
     */
    dwell(id: string, open: () => void): void {
      if (!carried.value || dwelling.value === id) return;

      stopClock();
      dwelling.value = id;
      timer = setTimeout(() => {
        timer = undefined;
        open();
      }, DWELL_MS);
    },

    /** The pointer left that target — as long as it is still the one waiting. */
    leave(id: string): void {
      if (dwelling.value !== id) return;
      stopClock();
      dwelling.value = undefined;
    },

    /** Marks the drag as having gone somewhere, so it is not undone on release. */
    land(): void {
      landed = true;
    },

    /**
     * The gesture is over.
     *
     * Returns where to go back to when the key was not dropped anywhere —
     * cancelled, dropped into the void, or abandoned with Escape. Without it,
     * calling a drag off would leave the deck standing in whatever folder the
     * pointer happened to pass through, which is worse than not cancelling.
     */
    end(): DragOrigin | undefined {
      const back = landed ? undefined : origin.value;

      stopClock();
      carried.value = undefined;
      origin.value = undefined;
      dwelling.value = undefined;
      landed = false;

      return back;
    },
  };
}

import type { ActionDescriptor } from './action.js';

/**
 * Editing a script that has blocks in it.
 *
 * A script used to be a list, so a step was a number and every edit was a
 * splice. With `if` and `for` it is a tree, and a step is a path: which index
 * at the top, then which branch, then which index inside that, and so on —
 * `[0, 'then', 1]` is the second step of the first block's `then`.
 *
 * Kept here, away from the editor, for the reason the folder tree is: moving a
 * step into its own branch is the kind of mistake that produces a profile
 * nobody can open, and it is far easier to be sure of that against a function
 * than against a drag.
 *
 * Every operation returns a new script rather than editing one, which is what
 * the configurator expects — it saves what it is given and re-renders from it.
 */

/** Where a step is: indices, with a branch name before each descent. */
export type StepPath = readonly (number | string)[];

export function stepAt(script: readonly ActionDescriptor[], path: StepPath): ActionDescriptor | undefined {
  if (path.length === 0) return undefined;

  const [head, ...rest] = path;
  if (typeof head !== 'number') return undefined;

  const step = script[head];
  if (!step) return undefined;
  if (rest.length === 0) return step;

  const [branch, ...deeper] = rest;
  if (typeof branch !== 'string') return undefined;

  return stepAt(step.branches?.[branch] ?? [], deeper);
}

/** The list a path points into, which is where an insertion lands. */
export function listAt(script: readonly ActionDescriptor[], path: StepPath): readonly ActionDescriptor[] {
  if (path.length === 0) return script;

  const [head, branch, ...rest] = path;
  if (typeof head !== 'number' || typeof branch !== 'string') return script;

  const step = script[head];
  if (!step) return [];

  return listAt(step.branches?.[branch] ?? [], rest);
}

/**
 * Puts a step into a branch at a position.
 *
 * The path names the list — `[]` for the top, `[0, 'then']` for a block's
 * first branch — and the index is where in it.
 */
export function insertStep(
  script: readonly ActionDescriptor[],
  path: StepPath,
  at: number,
  step: ActionDescriptor,
): ActionDescriptor[] {
  return mapList(script, path, (list) => {
    const next = [...list];
    next.splice(Math.max(0, Math.min(at, next.length)), 0, step);
    return next;
  });
}

export function removeStep(script: readonly ActionDescriptor[], path: StepPath): ActionDescriptor[] {
  const at = path[path.length - 1];
  if (typeof at !== 'number') return [...script];

  return mapList(script, path.slice(0, -1), (list) => list.filter((_, index) => index !== at));
}

/** Replaces a step, keeping everything under it. */
export function updateStep(
  script: readonly ActionDescriptor[],
  path: StepPath,
  change: (step: ActionDescriptor) => ActionDescriptor,
): ActionDescriptor[] {
  const at = path[path.length - 1];
  if (typeof at !== 'number') return [...script];

  return mapList(script, path.slice(0, -1), (list) =>
    list.map((step, index) => (index === at ? change(step) : step)),
  );
}

/**
 * Whether one path is inside another, which is what a drag must never do.
 *
 * Dropping a block into its own branch would hand the editor a piece of script
 * that contains itself: the tree stops being a tree, saving it writes until
 * something gives out, and the profile is unopenable afterwards.
 */
export function isInside(path: StepPath, ancestor: StepPath): boolean {
  if (ancestor.length > path.length) return false;
  return ancestor.every((part, index) => path[index] === part);
}

/**
 * Moves a step from one place to another.
 *
 * The target is a list plus an index, as with `insertStep`. Removing first
 * would shift the target when both are in the same list, so the index is
 * adjusted rather than the order of operations being left to chance.
 */
export function moveStep(
  script: readonly ActionDescriptor[],
  from: StepPath,
  toList: StepPath,
  toIndex: number,
): ActionDescriptor[] {
  const moving = stepAt(script, from);
  if (!moving) return [...script];
  // Into itself: refused, and the script comes back untouched.
  if (isInside(toList, from)) return [...script];

  const fromList = from.slice(0, -1);
  const fromIndex = from[from.length - 1];
  if (typeof fromIndex !== 'number') return [...script];

  const sameList = samePath(fromList, toList);
  const landing = sameList && toIndex > fromIndex ? toIndex - 1 : toIndex;

  return insertStep(removeStep(script, from), shiftPast(toList, fromList, fromIndex), landing, moving);
}

/**
 * Corrects a path for a removal that happened before it was used.
 *
 * The move is a remove followed by an insert, and removing a step shifts every
 * later step in that list — including the block a path descends through. A
 * step dragged from the top of a script into a branch of the block below it
 * was aimed at `[1, 'then']`, and by the time it was inserted that block was
 * at index 0: the insert missed, and the step vanished.
 */
function shiftPast(path: StepPath, removedFrom: StepPath, removedIndex: number): StepPath {
  const depth = removedFrom.length;
  if (path.length <= depth) return path;
  if (!samePath(removedFrom, path.slice(0, depth))) return path;

  const descending = path[depth];
  if (typeof descending !== 'number' || descending <= removedIndex) return path;

  return [...path.slice(0, depth), descending - 1, ...path.slice(depth + 1)];
}

function samePath(a: StepPath, b: StepPath): boolean {
  return a.length === b.length && a.every((part, index) => b[index] === part);
}

/**
 * Rewrites one list somewhere in the tree, rebuilding the way down to it.
 *
 * A branch that ends up empty is dropped, and a step left with no branches at
 * all loses the field: an `if` whose `else` was emptied should read as an `if`
 * with no else, not as one with an empty one.
 */
function mapList(
  script: readonly ActionDescriptor[],
  path: StepPath,
  change: (list: readonly ActionDescriptor[]) => readonly ActionDescriptor[],
): ActionDescriptor[] {
  if (path.length === 0) return [...change(script)];

  const [head, branch, ...rest] = path;
  if (typeof head !== 'number' || typeof branch !== 'string') return [...script];

  return script.map((step, index) => {
    if (index !== head) return step;

    const inner = mapList(step.branches?.[branch] ?? [], rest, change);
    const branches: Record<string, readonly ActionDescriptor[]> = { ...(step.branches ?? {}) };

    if (inner.length === 0) delete branches[branch];
    else branches[branch] = inner;

    const { branches: _dropped, ...rest2 } = step;
    return Object.keys(branches).length > 0 ? { ...rest2, branches } : rest2;
  });
}

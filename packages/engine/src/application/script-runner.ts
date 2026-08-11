import { CORE_DELAY, CORE_FOR, CORE_IF } from '../domain/action.js';
import type { ActionContext, ActionDescriptor } from '../domain/action.js';
import { evaluateCondition } from '../domain/condition.js';
import type { Condition } from '../domain/condition.js';
import type { VariableValue } from '../domain/variables.js';

/**
 * Running what a key is told to do, blocks and all.
 *
 * A script used to be a list, and running it was a loop over that list. With
 * `if` and `for` it is a tree, and this walks it: the two blocks and the wait
 * are handled here, and everything else is handed to the registry exactly as
 * before — so a plugin knows nothing about control flow and cannot redefine
 * what a loop means.
 *
 * **There is no `while`, deliberately.** Every loop here is counted before it
 * starts, so a script cannot be written that never ends. That rules out a few
 * things somebody might want and rules out, permanently, the deck that stops
 * answering because a button is still thinking.
 *
 * The counted loops are still bounded on top of that. A repeat count comes
 * from a variable often enough, and a variable is whatever a plugin last put
 * in it: a viewer count, a byte count, something that was meant to be a
 * percentage. The caps below are what stands between a mistake like that and
 * a deck that has to be killed.
 */

/** Nested blocks past this are a mistake rather than a structure. */
export const MAX_DEPTH = 10;
/** One loop's repeats, however large the number it was given. */
export const MAX_REPEATS = 1000;
/** Steps in one run of one script, counting every pass through a loop. */
export const MAX_STEPS = 10_000;

export class ScriptLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScriptLimitError';
  }
}

/** What the runner needs from the world, which is less than the whole engine. */
export interface ScriptHost {
  /** Runs one ordinary step — anything that is not a block. */
  run(action: ActionDescriptor, context: ActionContext): Promise<void>;
  /** Every variable, as a condition and a template see them. */
  values(): Readonly<Record<string, VariableValue>>;
  /** Reported per failed step; the script carries on to the next one. */
  onError?: (error: Error) => void;
  /** Overridden by tests, which cannot spend real seconds waiting. */
  wait?: (ms: number) => Promise<void>;
}

/**
 * Runs a script to the end, or until it hits a limit.
 *
 * A step that throws is reported and the script continues, which is what it
 * did when a script was a list: one action failing is a warning on the key,
 * not a reason to abandon the rest of what somebody asked for. A limit is
 * different — it means the script is not doing what it says — so it stops.
 */
export async function runScript(
  script: readonly ActionDescriptor[],
  context: ActionContext,
  host: ScriptHost,
): Promise<void> {
  const state = { steps: 0 };
  await runList(script, context, host, state, 0);
}

interface RunState {
  steps: number;
}

async function runList(
  script: readonly ActionDescriptor[],
  context: ActionContext,
  host: ScriptHost,
  state: RunState,
  depth: number,
): Promise<void> {
  if (depth > MAX_DEPTH) {
    throw new ScriptLimitError(`Blocks nested more than ${MAX_DEPTH} deep`);
  }

  for (const step of script) {
    state.steps += 1;
    if (state.steps > MAX_STEPS) {
      throw new ScriptLimitError(`This script ran more than ${MAX_STEPS} steps`);
    }

    switch (step.type) {
      case CORE_IF:
        await runIf(step, context, host, state, depth);
        break;

      case CORE_FOR:
        await runFor(step, context, host, state, depth);
        break;

      case CORE_DELAY:
        await wait(host, milliseconds(step));
        break;

      default:
        try {
          await host.run(step, context);
        } catch (error) {
          // One bad step must not cost the rest of the script.
          host.onError?.(error as Error);
        }
    }
  }
}

async function runIf(
  step: ActionDescriptor,
  context: ActionContext,
  host: ScriptHost,
  state: RunState,
  depth: number,
): Promise<void> {
  const condition = step.params?.['when'] as Condition | undefined;

  // An `if` with nothing asked is false rather than an error: a block dropped
  // on the grid and not yet filled in should sit there quietly, not shout.
  const holds =
    condition === undefined
      ? false
      : evaluateCondition(condition, {
          values: { ...host.values(), ...(context.locals ?? {}) },
          buttonState: (buttonId) => context.buttonState?.(buttonId),
        });

  const branch = holds ? step.branches?.['then'] : step.branches?.['else'];
  if (branch && branch.length > 0) await runList(branch, context, host, state, depth + 1);
}

/**
 * Repeats a branch a number of times worked out before it starts.
 *
 * The count may be a number or the name of a variable. A variable is read
 * once and copied: the loop counts down its own copy, so a `for` over
 * `clicks` does not empty `clicks`, and something changing that variable
 * mid-loop cannot lengthen the loop.
 *
 * A negative count runs `|n|` times. It reads as "this many, the other way",
 * and the alternative — running zero times — turns a sign mistake into a
 * button that silently does nothing.
 */
async function runFor(
  step: ActionDescriptor,
  context: ActionContext,
  host: ScriptHost,
  state: RunState,
  depth: number,
): Promise<void> {
  const body = step.branches?.['do'] ?? [];
  if (body.length === 0) return;

  const total = repeatsOf(step, host);
  if (total === 0) return;

  for (let index = 0; index < total; index += 1) {
    await runList(
      body,
      {
        ...context,
        locals: {
          ...(context.locals ?? {}),
          // One-based: the first pass is the first, not the zeroth. This is
          // read by whoever writes profiles, not by a programmer.
          loop: index + 1,
          'loop.left': total - index - 1,
          'loop.total': total,
        },
      },
      host,
      state,
      depth + 1,
    );
  }
}

function repeatsOf(step: ActionDescriptor, host: ScriptHost): number {
  const params = step.params ?? {};
  const variable = params['variable'];

  const raw =
    typeof variable === 'string' && variable !== ''
      ? host.values()[variable]
      : (params['times'] as VariableValue | undefined);

  const count = Math.floor(Math.abs(Number(raw ?? 0)));
  if (!Number.isFinite(count)) return 0;

  // Refused rather than quietly trimmed. A loop asked for a million repeats is
  // a loop pointed at the wrong variable, and running the first thousand of
  // them would be a key that half worked with nothing said about why.
  if (count > MAX_REPEATS) {
    throw new ScriptLimitError(
      `This loop asked for ${count} repeats; the most a key may do is ${MAX_REPEATS}`,
    );
  }

  return count;
}

function milliseconds(step: ActionDescriptor): number {
  const ms = Number(step.params?.['ms'] ?? 0);
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
}

async function wait(host: ScriptHost, ms: number): Promise<void> {
  if (ms <= 0) return;
  if (host.wait) return host.wait(ms);
  await new Promise((resolve) => setTimeout(resolve, ms));
}

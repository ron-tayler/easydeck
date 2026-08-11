import { renderTemplate } from './template.js';
import type { VariableValue } from './variables.js';

/**
 * What an `if` asks about, as data rather than as code.
 *
 * Three fields — where the left-hand side comes from, how to compare, and what
 * to compare with — which is enough for everything a key does and small enough
 * to draw as three controls. The alternative was an expression language, and
 * the reason against it is that this program already has blocks: `if` and
 * `for` are structure, and a language would be a second way to express the
 * same structure, with a parser to write and a class of errors that only shows
 * up when somebody presses the key.
 *
 * The template source is the escape hatch, and it costs nothing because the
 * templating already exists: `{{obs.scene}} — {{vts.model}}` is computed the
 * same way a label is, and then compared like anything else.
 */

export type ConditionSource = 'variable' | 'template' | 'button-state';

export type ConditionOperator =
  | '=='
  | '!='
  | '>'
  | '>='
  | '<'
  | '<='
  | 'contains'
  | 'starts-with'
  | 'ends-with'
  | 'empty'
  | 'not-empty';

export interface Condition {
  readonly source: ConditionSource;
  /**
   * For `variable`, which one. For `button-state`, which button — empty means
   * the button running the script, which is what somebody means nine times in
   * ten and saves them finding their own id.
   */
  readonly name?: string;
  /** For `template`: the text to render before comparing. */
  readonly text?: string;
  readonly operator: ConditionOperator;
  /** Absent for `empty` and `not-empty`, which have nothing to compare with. */
  readonly value?: VariableValue;
}

/** What a condition needs to look at, which is never the whole engine. */
export interface ConditionContext {
  readonly values: Readonly<Record<string, VariableValue>>;
  /** The state a button is showing; the running button when no id is given. */
  readonly buttonState: (buttonId?: string) => string | undefined;
}

export function evaluateCondition(condition: Condition, context: ConditionContext): boolean {
  const left = leftSide(condition, context);

  switch (condition.operator) {
    case 'empty':
      return left === undefined || String(left) === '';
    case 'not-empty':
      return left !== undefined && String(left) !== '';
    default:
      return compare(left, condition.operator, condition.value);
  }
}

function leftSide(condition: Condition, context: ConditionContext): VariableValue | undefined {
  switch (condition.source) {
    case 'variable':
      return condition.name === undefined ? undefined : context.values[condition.name];

    case 'template':
      return renderTemplate(condition.text ?? '', context.values);

    case 'button-state':
      return context.buttonState(condition.name);

    default:
      return undefined;
  }
}

/**
 * Compares as numbers when both sides read as numbers, as text otherwise.
 *
 * A variable holding `42` and a value typed as `42` must be equal, and so must
 * a scene called `Intro` and the word Intro. Deciding by what the values look
 * like is what makes both true without asking anybody to declare a type in the
 * condition itself.
 */
function compare(
  left: VariableValue | undefined,
  operator: ConditionOperator,
  right: VariableValue | undefined,
): boolean {
  const leftNumber = asNumber(left);
  const rightNumber = asNumber(right);

  if (leftNumber !== undefined && rightNumber !== undefined) {
    switch (operator) {
      case '==':
        return leftNumber === rightNumber;
      case '!=':
        return leftNumber !== rightNumber;
      case '>':
        return leftNumber > rightNumber;
      case '>=':
        return leftNumber >= rightNumber;
      case '<':
        return leftNumber < rightNumber;
      case '<=':
        return leftNumber <= rightNumber;
      default:
        break;
    }
  }

  const leftText = left === undefined ? '' : String(left);
  const rightText = right === undefined ? '' : String(right);

  switch (operator) {
    case '==':
      return leftText === rightText;
    case '!=':
      return leftText !== rightText;
    case 'contains':
      return leftText.includes(rightText);
    case 'starts-with':
      return leftText.startsWith(rightText);
    case 'ends-with':
      return leftText.endsWith(rightText);
    // An ordering asked of text that is not numeric: compared as words, which
    // is at least defined and occasionally what was meant.
    case '>':
      return leftText > rightText;
    case '>=':
      return leftText >= rightText;
    case '<':
      return leftText < rightText;
    case '<=':
      return leftText <= rightText;
    default:
      return false;
  }
}

/** A boolean counts as a number so `on == 1` behaves, which people write. */
function asNumber(value: VariableValue | undefined): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value !== 'string' || value.trim() === '') return undefined;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

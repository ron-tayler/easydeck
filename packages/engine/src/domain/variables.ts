import type { LocalizedText } from './plugin.js';

export type VariableValue = string | number | boolean;

/**
 * What a variable holds, and therefore how everything downstream treats it.
 *
 * The store itself stays untyped on purpose — it is a plain key-value map, and
 * an action that writes a number to a string variable should not explode
 * mid-macro. Types are a *declaration*: they tell the configurator which
 * control to draw and the controller how to map a value onto button states.
 * Nothing enforces them at run time beyond coercing on the way in.
 */
export type VariableType = 'boolean' | 'number' | 'string' | 'enum';

export const VARIABLE_TYPES: readonly VariableType[] = ['boolean', 'number', 'string', 'enum'];

export interface VariableOption {
  readonly value: string;
  readonly label?: LocalizedText;
}

/**
 * A variable someone has declared, as opposed to one that merely exists.
 *
 * Two things declare variables: a profile, for the ones its author created,
 * and a plugin, for the ones it needs in order to publish anything. A plugin's
 * declaration is the point of the whole mechanism — it lets a plugin expose
 * live data (a scene name, a mute flag, a listener count) that buttons can
 * bind to, without the user having to create a variable by hand and spell its
 * name identically in two places.
 */
export interface VariableDeclaration {
  readonly name: string;
  readonly type: VariableType;
  /** Shown instead of the bare name where there is room for it. */
  readonly label?: LocalizedText;
  readonly description?: LocalizedText;
  /** Value the variable starts at when a profile is loaded. */
  readonly initial?: VariableValue;
  /** `enum` only: the values it may take, in the order they are offered. */
  readonly options?: readonly VariableOption[];
  /**
   * The plugin that declared it; absent for a variable the user created.
   *
   * A plugin's variable cannot be deleted from the configurator — the plugin
   * writes to it regardless, so deleting it would only produce a variable that
   * reappears with no explanation. Its value stays editable, because setting
   * one by hand is exactly how you test a button that binds to it.
   */
  readonly pluginId?: string;
}

/**
 * Truthiness as a profile author would expect rather than as JavaScript would:
 * the strings "false" and "0" read as false, because that is what a variable
 * round-tripped through JSON or typed into a field usually means.
 */
export function isTruthy(value: VariableValue | undefined): boolean {
  if (value === undefined) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return value !== '' && value !== 'false' && value !== '0';
}

/** The type a value would be declared as, for variables nobody declared. */
export function inferVariableType(value: VariableValue | undefined): VariableType {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  return 'string';
}

/**
 * Brings a raw value in line with a declared type.
 *
 * Applied where values enter from outside — the configurator, a stored
 * profile, an API client — so that a boolean variable holds `true` rather than
 * the string `"true"`, which would otherwise compare unequal to everything
 * that matters.
 */
export function coerceVariable(type: VariableType, raw: VariableValue): VariableValue {
  switch (type) {
    case 'boolean':
      return typeof raw === 'boolean' ? raw : isTruthy(raw);

    case 'number': {
      const parsed = typeof raw === 'number' ? raw : Number(raw);
      return Number.isFinite(parsed) ? parsed : 0;
    }

    default:
      return typeof raw === 'string' ? raw : String(raw);
  }
}

/** What a declared variable holds before anything has written to it. */
export function initialVariableValue(declaration: VariableDeclaration): VariableValue {
  if (declaration.initial !== undefined) {
    return coerceVariable(declaration.type, declaration.initial);
  }

  switch (declaration.type) {
    case 'boolean':
      return false;
    case 'number':
      return 0;
    case 'enum':
      return declaration.options?.[0]?.value ?? '';
    default:
      return '';
  }
}

export interface VariableChange {
  readonly name: string;
  readonly value: VariableValue | undefined;
  readonly previous: VariableValue | undefined;
}

/**
 * Reactive key-value store shared by everything in a profile.
 *
 * Variables are what lift this above a plain trigger-action deck: button
 * labels interpolate them, button states are bound to them, and actions
 * write them. A change notifies subscribers, which is what eventually makes
 * the affected keys repaint.
 *
 * Setting a variable to the value it already holds is deliberately silent —
 * otherwise a polling action would repaint the panel continuously.
 */
export class VariableStore {
  private readonly values = new Map<string, VariableValue>();
  private readonly listeners = new Set<(change: VariableChange) => void>();

  constructor(initial: Readonly<Record<string, VariableValue>> = {}) {
    for (const [name, value] of Object.entries(initial)) this.values.set(name, value);
  }

  get(name: string): VariableValue | undefined {
    return this.values.get(name);
  }

  has(name: string): boolean {
    return this.values.has(name);
  }

  set(name: string, value: VariableValue): void {
    const previous = this.values.get(name);
    if (previous === value) return;

    this.values.set(name, value);
    this.notify({ name, value, previous });
  }

  delete(name: string): void {
    if (!this.values.has(name)) return;

    const previous = this.values.get(name);
    this.values.delete(name);
    this.notify({ name, value: undefined, previous });
  }

  /** Flips a boolean, treating an unset variable as false. */
  toggle(name: string): void {
    this.set(name, !this.truthy(name));
  }

  /** Adds to a numeric variable, treating an unset variable as zero. */
  increment(name: string, by = 1): void {
    const current = this.values.get(name);
    const base = typeof current === 'number' ? current : Number(current ?? 0);
    this.set(name, (Number.isFinite(base) ? base : 0) + by);
  }

  /** Truthiness as a profile author would expect: "false" and "0" are false. */
  truthy(name: string): boolean {
    return isTruthy(this.values.get(name));
  }

  snapshot(): Record<string, VariableValue> {
    return Object.fromEntries(this.values);
  }

  /** Subscribes to changes. Returns an unsubscribe function. */
  onChange(listener: (change: VariableChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(change: VariableChange): void {
    // Copy first: a listener may unsubscribe (or subscribe) while notifying.
    for (const listener of [...this.listeners]) listener(change);
  }
}

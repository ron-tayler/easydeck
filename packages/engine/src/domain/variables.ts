export type VariableValue = string | number | boolean;

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
    const value = this.values.get(name);
    if (value === undefined) return false;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    return value !== '' && value !== 'false' && value !== '0';
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

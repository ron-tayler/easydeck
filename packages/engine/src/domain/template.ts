import type { VariableValue } from './variables.js';

/**
 * `{{name}}` placeholders in button text.
 *
 * Published as its own entry point (`@easydeck/engine/template`) because a
 * configurator has to substitute exactly as the engine does when previewing a
 * label. Reimplementing it there would put two subtly different templating
 * rules in one product; this module has no Node dependencies, so a browser
 * bundle can import it directly.
 *
 * Deliberately not an expression language: profile documents are edited in a
 * GUI by people who are not programmers, and a template that cannot fail is
 * worth more here than one that can compute. Anything richer belongs in an
 * action that writes a variable.
 */
/*
 * Anything but a brace or a line break, and not only whitespace.
 *
 * It used to be Latin letters, digits and dots, which was fine while every
 * variable was named by whoever wrote the profile. A plugin's keys carry the
 * user's own words — `obs.mute(Игровой звук)` — and those have spaces,
 * brackets and Cyrillic in them. Still not an expression language: there is
 * nothing to evaluate here, only a name that may look like anything.
 */
const PLACEHOLDER = /\{\{\s*([^{}\s\r\n](?:[^{}\r\n]*[^{}\s\r\n])?)\s*\}\}/g;

/** Variable names a template depends on, in order of first appearance. */
export function referencedVariables(template: string): string[] {
  const names: string[] = [];
  for (const match of template.matchAll(PLACEHOLDER)) {
    const name = match[1]!;
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

export function hasPlaceholders(template: string): boolean {
  PLACEHOLDER.lastIndex = 0;
  return PLACEHOLDER.test(template);
}

/**
 * Substitutes variables into a template.
 *
 * An unset variable renders as an empty string rather than leaving the raw
 * placeholder on screen: variables are commonly still unset when a profile is
 * first loaded, and a key reading `{{viewers}}` looks like a bug to the user.
 */
export function renderTemplate(
  template: string,
  variables: Readonly<Record<string, VariableValue>>,
): string {
  return template.replace(PLACEHOLDER, (_match, name: string) => {
    const value = variables[name];
    return value === undefined ? '' : String(value);
  });
}

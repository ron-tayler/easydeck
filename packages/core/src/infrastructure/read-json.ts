/**
 * Parses JSON that a human may have saved from a text editor.
 *
 * Notepad on Windows writes UTF-8 with a byte order mark, and JSON.parse
 * rejects it outright — so a user who edits a profile in the most obvious
 * editor on the platform gets a file the daemon refuses to load. Stripping
 * the mark costs one line and removes a whole class of support questions.
 */
export function parseJsonText<T>(text: string): T {
  return JSON.parse(stripBom(text)) as T;
}

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

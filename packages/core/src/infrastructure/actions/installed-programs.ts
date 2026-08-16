import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, extname, join } from 'node:path';

import type { ParamOption } from '@easydeck/engine';

/**
 * The programs installed on this machine, as choices for a key.
 *
 * "Run program" used to be a box a path went into, and a path to an
 * executable is something almost nobody knows — people know their programs
 * by the names in the Start menu. So this reads the Start menu: every
 * shortcut in the machine-wide folder and the user's own, named exactly as
 * the person sees them named every day.
 *
 * The value offered is the path to the *shortcut*, on purpose. A shortcut is
 * where the vendor put the working directory and the arguments that make
 * their program start correctly, and resolving it to a bare .exe would throw
 * that away. `system.run-program` knows to hand a shortcut to the shell
 * rather than spawn it.
 *
 * Windows-only, answering nobody elsewhere: the deck's hardware story is
 * Windows-first, and an empty list leaves the field a box a path can still
 * be typed into.
 */

/**
 * Folders whose shortcuts nobody means when they say "a program".
 *
 * Named in both languages for the same reason the list below is: these are
 * Windows' own folders and Windows translates them.
 */
const SKIPPED_FOLDERS = new Set([
  'startup',
  'administrative tools',
  'accessibility',
  'accessories',
  'автозагрузка',
  'администрирование',
  'специальные возможности',
  'стандартные',
  'служебные',
  'служебные - windows',
]);

/**
 * Shortcuts that point at chores, not programs.
 *
 * In both languages, because a Start menu is in the language Windows was
 * installed in: measured against a Russian one, the English-only list left
 * "Деинсталлировать Lightshot" and "Документация AIDA64" sitting in the
 * picker among the programs. The words are matched anywhere in the name —
 * they turn up as often at the end ("Firebird — удаление") as at the start.
 */
const SKIPPED_NAMES =
  /uninstall|removal|deinstall|website|documentation|read ?me|help|licen[cs]e|деинсталл|удалить|удаление|документаци|справка|руководств|лиценз|веб-?сайт/i;

/**
 * Rescanning on every open of the editor is wasteful and noticing a freshly
 * installed program a half-minute late is invisible.
 */
const CACHE_MS = 30_000;

let cached: { at: number; programs: ParamOption[] } | undefined;

export async function listInstalledPrograms(
  roots: readonly string[] = startMenuRoots(),
): Promise<ParamOption[]> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.programs;

  const found = new Map<string, ParamOption>();

  for (const root of roots) {
    for (const shortcut of await shortcutsUnder(root)) {
      const name = basename(shortcut, extname(shortcut));
      if (SKIPPED_NAMES.test(name)) continue;

      // One entry per name, the user's own folder winning over the machine's:
      // roots are scanned in that order, and the first claim stands.
      const key = name.toLowerCase();
      if (!found.has(key)) found.set(key, { value: shortcut, label: { en: name } });
    }
  }

  const programs = [...found.values()].sort((one, other) =>
    one.label.en.localeCompare(other.label.en, undefined, { sensitivity: 'base' }),
  );

  cached = { at: Date.now(), programs };
  return programs;
}

/** Both Start menus: the user's first, so their shortcuts win the dedupe. */
export function startMenuRoots(): string[] {
  if (process.platform !== 'win32') return [];

  const appData = process.env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming');
  const programData = process.env['ProgramData'] ?? 'C:\\ProgramData';
  const tail = join('Microsoft', 'Windows', 'Start Menu', 'Programs');

  return [join(appData, tail), join(programData, tail)];
}

/** Every .lnk under a root, skipping the folders that hold chores. */
async function shortcutsUnder(root: string, depth = 0): Promise<string[]> {
  // Deep nesting in a Start menu is vendors filing things under themselves;
  // past a few levels it is junctions and mistakes.
  if (depth > 3) return [];

  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const shortcuts: string[] = [];

  for (const entry of entries) {
    const path = join(root, entry.name);

    if (entry.isDirectory()) {
      if (SKIPPED_FOLDERS.has(entry.name.toLowerCase())) continue;
      shortcuts.push(...(await shortcutsUnder(path, depth + 1)));
      continue;
    }

    if (extname(entry.name).toLowerCase() === '.lnk') shortcuts.push(path);
  }

  return shortcuts;
}

/** Only for tests, which cannot wait half a minute between scans. */
export function forgetProgramCache(): void {
  cached = undefined;
}

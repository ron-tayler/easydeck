import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

import { readIconPack } from '../icon-pack.js';
import { readLibrary } from '../icon-library.js';
import type { LibraryImage } from '../icon-library.js';

/**
 * What is installed in the plugins folder.
 *
 * A plugin is one thing that can carry several: pictures for keys, translated
 * text for the window, and — later — actions a button can run. That is how the
 * programs people are coming from work, and it is the right shape: a pack of
 * icons for a game, its names in three languages, and the macros that go with
 * them arrive together and leave together.
 *
 * Two kinds are recognised.
 *
 * A folder with `plugin.json` is EasyDeck's own: `icons/` beside it holds
 * pictures at whatever depth suits them, `locales/ru.json` holds text.
 *
 * A `.streamDeckIconPack` is read as a plugin that happens to contain only
 * icons. Reading other programs' formats in place — rather than asking people
 * to unpack and sort them by hand — is most of what makes a plugin folder
 * worth having.
 */

export interface InstalledPlugin {
  /** Stable across restarts: the folder or file name, or the manifest's id. */
  readonly id: string;
  readonly name: string;
  readonly version?: string;
  readonly description?: string;
  /** Where it came from, for a list that has to explain itself. */
  readonly kind: 'easydeck' | 'stream-deck-icons';
  readonly icons: readonly LibraryImage[];
  /** Translations by locale code, merged over the built-in text. */
  readonly messages: Readonly<Record<string, unknown>>;
}

/** A plugin that could not be read, kept so the user can be told which. */
export interface BrokenPlugin {
  readonly id: string;
  readonly problem: string;
}

export interface PluginLibrary {
  readonly plugins: readonly InstalledPlugin[];
  readonly broken: readonly BrokenPlugin[];
}

const MANIFEST = 'plugin.json';
/** Locale files are small; anything this large is not a translation. */
const MAX_MESSAGES_BYTES = 512 * 1024;
/** Icons a single plugin may contribute, so one pack cannot crowd out the rest. */
const MAX_PLUGIN_ICONS = 2000;

export async function readInstalledPlugins(directory: string): Promise<PluginLibrary> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch {
    // No folder yet is the normal state, and not an error: it is created the
    // first time someone asks to see it.
    return { plugins: [], broken: [] };
  }

  const plugins: InstalledPlugin[] = [];
  const broken: BrokenPlugin[] = [];

  for (const entry of entries.sort((a, b) => a.localeCompare(b))) {
    const path = join(directory, entry);

    try {
      const info = await stat(path);
      const plugin = info.isDirectory()
        ? await readFolderPlugin(path, entry)
        : await readPackedPlugin(path, entry);

      if (plugin) plugins.push(plugin);
    } catch (error) {
      // One unreadable plugin must not cost the user the others, and silence
      // would leave them wondering where their icons went.
      broken.push({ id: entry, problem: error instanceof Error ? error.message : String(error) });
    }
  }

  return { plugins, broken };
}

/** EasyDeck's own shape: a folder announcing itself with `plugin.json`. */
async function readFolderPlugin(path: string, entry: string): Promise<InstalledPlugin | undefined> {
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(await readFile(join(path, MANIFEST), 'utf8')) as Record<string, unknown>;
  } catch (error) {
    // A folder with no manifest is not a plugin — someone's notes, a leftover
    // download — and saying nothing about it is right. A manifest that will
    // not parse is a different matter, and is reported.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new Error(`${entry}: ${MANIFEST} is not valid JSON`);
  }

  const library = await readLibrary(join(path, 'icons'));
  const name = text(manifest['name']) ?? entry;

  return {
    id: text(manifest['id']) ?? entry,
    name,
    ...(text(manifest['version']) ? { version: text(manifest['version'])! } : {}),
    ...(text(manifest['description']) ? { description: text(manifest['description'])! } : {}),
    kind: 'easydeck',
    // Grouped under the plugin's name, so the picker's tree says where a
    // picture came from without the plugin having to arrange that itself.
    icons: under(name, library.images.slice(0, MAX_PLUGIN_ICONS)),
    messages: await readMessages(join(path, 'locales')),
  };
}

/** Another program's icon pack, read where it lies. */
async function readPackedPlugin(path: string, entry: string): Promise<InstalledPlugin | undefined> {
  const pack = await readIconPack(path, MAX_PLUGIN_ICONS);
  if (!pack) return undefined;

  return {
    id: basename(entry, extname(entry)),
    name: pack.name,
    kind: 'stream-deck-icons',
    icons: under(
      pack.name,
      pack.images.map((image) => ({ ...image, group: '' })),
    ),
    messages: {},
  };
}

/** Puts a plugin's pictures in a folder of its own, keeping any nesting. */
function under(name: string, images: readonly LibraryImage[]): LibraryImage[] {
  return images.map((image) => ({
    ...image,
    group: image.group === '' ? name : `${name}/${image.group}`,
  }));
}

/**
 * `locales/ru.json` and friends, read as message trees.
 *
 * Merged over the built-in text by whoever displays it, so a plugin can name
 * its own actions in three languages, and — deliberately — can also correct a
 * translation of ours it disagrees with.
 */
async function readMessages(directory: string): Promise<Record<string, unknown>> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch {
    return {};
  }

  const messages: Record<string, unknown> = {};

  for (const entry of entries) {
    if (extname(entry).toLowerCase() !== '.json') continue;

    const file = join(directory, entry);
    try {
      const info = await stat(file);
      if (!info.isFile() || info.size > MAX_MESSAGES_BYTES) continue;

      const parsed = JSON.parse(await readFile(file, 'utf8')) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        messages[basename(entry, extname(entry))] = parsed;
      }
    } catch {
      // One unreadable locale file costs that language and nothing else.
      continue;
    }
  }

  return messages;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

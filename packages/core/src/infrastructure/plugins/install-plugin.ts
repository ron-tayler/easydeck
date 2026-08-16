import { createHash } from 'node:crypto';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

import { PLUGIN_API_VERSION } from '@easydeck/engine';

import { ZipArchive } from '../zip.js';
import { pluginsDir } from '../config-paths.js';

/**
 * Putting a downloaded plugin on disk.
 *
 * The archive is a zip of what `plugins/<id>/` should contain — a
 * `plugin.json`, a `main.mjs`, and whatever pictures and translations came
 * with them. Installing is unpacking it under that name, and everything here
 * is about the checks either side of that.
 *
 * The extension is `.easydeck`, the same one a profile uses. That is not a
 * collision to work around: both are a zip somebody drops on the window, and
 * asking a person to keep two extensions straight is asking them to do the
 * program's filing. What is inside says which it is, and `looksLikePlugin`
 * is that question.
 */

/** Bigger than any plugin has cause to be, and small enough to refuse quickly. */
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_FILE_BYTES = 32 * 1024 * 1024;

export interface InstalledPlugin {
  readonly id: string;
  readonly version: string;
  readonly folder: string;
  /** True when this replaced a plugin that was already there. */
  readonly replaced: boolean;
}

export interface InstallOptions {
  /** Refuse unless the archive hashes to this. From the registry index. */
  readonly sha256?: string;
  /** Where plugins live; overridden by tests. */
  readonly directory?: string;
  /**
   * Allow replacing a plugin that is already installed.
   *
   * Off by default, because two plugins claiming one id is the case the
   * store has to *ask* about rather than resolve: they may be one plugin
   * updated, or two authors' plugins that happen to share a name, and only
   * the person can say which.
   */
  readonly replace?: boolean;
}

/**
 * Whether an archive holds a plugin, as opposed to a profile.
 *
 * The one question that tells the two `.easydeck` files apart, and it is
 * asked of the contents rather than of the name.
 */
export function looksLikePlugin(bytes: Uint8Array): boolean {
  try {
    return new ZipArchive(Buffer.from(bytes)).has('plugin.json');
  } catch {
    return false;
  }
}

export async function installPluginArchive(
  bytes: Uint8Array,
  options: InstallOptions = {},
): Promise<InstalledPlugin> {
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) throw new Error('That archive is too large to be a plugin');

  if (options.sha256) {
    const actual = createHash('sha256').update(bytes).digest('hex');
    // Checked before anything is read, not after it is written: the point of
    // a hash is to decide whether to trust the contents at all.
    if (actual !== options.sha256) {
      throw new Error('The download does not match what the registry expected');
    }
  }

  const archive = new ZipArchive(Buffer.from(bytes));
  const manifest = readManifest(archive);

  if (manifest.apiVersion !== PLUGIN_API_VERSION) {
    throw new Error(
      `${manifest.id} is built for plugin API ${manifest.apiVersion}; this build speaks ${PLUGIN_API_VERSION}`,
    );
  }

  const directory = options.directory ?? pluginsDir();
  const folder = join(directory, manifest.id);
  const replaced = await exists(folder);

  if (replaced && options.replace !== true) {
    throw new Error(`${manifest.id} is already installed`);
  }

  /*
   * Unpacked beside the final name and moved in one step.
   *
   * A folder half-written when the power goes is a plugin the loader will
   * try to import and fail on, for ever, with no way for the user to tell
   * that is what happened.
   */
  const staging = `${folder}.installing`;
  await rm(staging, { recursive: true, force: true });

  try {
    await unpack(archive, staging);
    await rm(folder, { recursive: true, force: true });
    await rename(staging, folder);
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }

  return { id: manifest.id, version: manifest.version, folder, replaced };
}

/** What the archive says it is, checked enough to be worth acting on. */
function readManifest(archive: ZipArchive): { id: string; version: string; apiVersion: number } {
  const raw = archive.read('plugin.json');
  if (!raw) throw new Error('That archive has no plugin.json — it may be a profile rather than a plugin');

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new Error('The plugin.json inside is not valid JSON');
  }

  const id = parsed['id'];
  const main = parsed['main'];
  const apiVersion = parsed['apiVersion'];

  // The id becomes a folder name, so it is checked the way a folder name has
  // to be: a plugin called `../../etc` would otherwise unpack wherever it liked.
  if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) || id.includes('..')) {
    throw new Error('That plugin has no usable id');
  }
  if (typeof main !== 'string' || main.length === 0) {
    throw new Error(`${id} carries no code — a plugin needs a main`);
  }

  return {
    id,
    version: typeof parsed['version'] === 'string' ? parsed['version'] : '0.0.0',
    apiVersion: typeof apiVersion === 'number' ? apiVersion : 0,
  };
}

/**
 * Writes every entry, and nothing outside the folder.
 *
 * `ZipArchive` reads by name and never touches a path, so this is the one
 * place a name from an archive becomes a place on disk — and therefore the
 * one place `../` has to be refused. Directory entries are skipped: the
 * folders that matter are made for the files that need them.
 */
async function unpack(archive: ZipArchive, folder: string): Promise<void> {
  const inside = resolve(folder) + sep;
  await mkdir(folder, { recursive: true });

  for (const name of archive.names()) {
    if (name.endsWith('/')) continue;

    const target = resolve(folder, name);
    if (!target.startsWith(inside)) {
      throw new Error(`That archive tries to write outside its folder: '${name}'`);
    }

    const bytes = archive.read(name);
    if (!bytes) continue;
    if (bytes.byteLength > MAX_FILE_BYTES) {
      throw new Error(`'${name}' is too large to be part of a plugin`);
    }

    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Removes an installed plugin, leaving its settings where they are. */
export async function uninstallPlugin(id: string, directory: string = pluginsDir()): Promise<void> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) || id.includes('..')) {
    throw new Error('That is not a plugin id');
  }

  // Settings and secrets stay: uninstalling is usually the first half of
  // reinstalling, and a password typed once should survive that.
  await rm(join(directory, id), { recursive: true, force: true });
}

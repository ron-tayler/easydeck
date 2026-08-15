import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PluginManifest } from '@easydeck/engine';

import { pluginsDir } from '../config-paths.js';

/**
 * Pictures that arrive with a plugin, and how a preset points at one.
 *
 * A preset is a finished key, and a finished key usually has a picture on it —
 * which left nowhere to put one. A built-in plugin is a TypeScript module with
 * no folder of its own, so the only way to give a preset an icon was to paste
 * a data URL into the source: bearable for a small SVG, absurd for a three
 * megabyte animation, and unreadable either way.
 *
 * So every plugin has a folder of pictures, and a preset refers to one the way
 * a profile refers to its own:
 *
 * ```ts
 * visual: { icon: { source: 'plugin:hardware/cpu-gauge.svg' } }
 * ```
 *
 * Built-in plugins keep theirs in this package, beside the code; installed
 * plugins already have `icons/` in their folder and it is read from there. One
 * resolver sees both, so a preset may point at another plugin's picture — a
 * pack of OBS keys built on somebody else's gauge needs no arrangement between
 * them.
 *
 * **What lands in a profile is the picture, not the reference.** The manifest
 * is expanded on its way to a window, so dropping a preset on the grid stores
 * an ordinary icon: it survives the plugin being uninstalled, travels in an
 * export, and is deduplicated by the profile's own asset store like any other.
 * A profile knows nothing about plugins, and this keeps it that way.
 */

const PREFIX = 'plugin:';

/**
 * `plugin:<id>/<path>`, with the id restricted so it cannot climb anywhere.
 *
 * Dots are in the set because an id carries its author — `ed.yandex` — and
 * they are safe there: escaping a folder takes a separator, and the first
 * character still has to be a letter or digit, so `..` alone can never match.
 */
const REFERENCE = /^plugin:([A-Za-z0-9][A-Za-z0-9._-]*)\/(.+)$/;

const TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

/** Sized like the icon library's own limit: an animation is routinely large. */
const MAX_BYTES = 12_000_000;

/**
 * Where this package keeps the pictures of the plugins built into it.
 *
 * Resolved from this module rather than from the working directory, and the
 * same path in `src` and in `dist` — three levels up from either lands on the
 * package root.
 */
export function builtInAssetsDir(): string {
  return fileURLToPath(new URL('../../../assets/', import.meta.url));
}

export function isPluginAsset(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

export class PluginAssets {
  constructor(
    private readonly builtIn: string = builtInAssetsDir(),
    private readonly installed: string = pluginsDir(),
  ) {}

  /**
   * The picture behind a reference, as a data URL, or nothing.
   *
   * Nothing rather than an error: a preset naming a picture that is not there
   * should be a preset with no picture, not a plugin that fails to list.
   */
  async read(reference: string): Promise<string | undefined> {
    const found = REFERENCE.exec(reference);
    if (!found) return undefined;

    const [, pluginId, path] = found as unknown as [string, string, string];

    const type = TYPES[extname(path).toLowerCase()];
    if (!type) return undefined;

    for (const root of [join(this.builtIn, pluginId), join(this.installed, pluginId, 'icons')]) {
      const bytes = await readWithin(root, path);
      if (bytes) return `data:${type};base64,${bytes.toString('base64')}`;
    }

    return undefined;
  }

  /**
   * A manifest with its pictures in place of its references.
   *
   * Walks by key name — `source` is what a picture is called wherever one
   * appears — so a later version that puts an icon somewhere new is covered
   * without this being taught about it.
   */
  async expand(manifest: PluginManifest): Promise<PluginManifest> {
    const references = new Map<string, string>();

    for (const reference of collect(manifest)) {
      if (references.has(reference)) continue;
      const picture = await this.read(reference);
      if (picture) references.set(reference, picture);
    }

    if (references.size === 0) return manifest;

    return rewrite(manifest, (source) => references.get(source) ?? source);
  }

  async expandAll(manifests: readonly PluginManifest[]): Promise<PluginManifest[]> {
    return Promise.all(manifests.map((manifest) => this.expand(manifest)));
  }
}

/**
 * Reads a file, refusing anything that is not plainly inside the folder.
 *
 * `plugin:hardware/../../../settings.json` is the reason: a reference is
 * ordinary data, it may arrive from a plugin somebody installed, and a path
 * that climbs must not be followed.
 *
 * `..` is refused outright rather than resolved and checked. A path that goes
 * up and comes back — `hardware/../hardware/gauge.svg` — lands somewhere
 * allowed, so a containment check alone accepts it; refusing the segment
 * altogether costs nothing, since no honest reference contains one, and leaves
 * one rule to hold in the head instead of two.
 */
async function readWithin(root: string, path: string): Promise<Buffer | undefined> {
  const segments = normalize(path).split(/[\\/]/);
  if (segments.some((segment) => segment === '..')) return undefined;

  const target = resolve(root, ...segments);
  const inside = resolve(root) + sep;
  if (!target.startsWith(inside)) return undefined;

  try {
    const bytes = await readFile(target);
    return bytes.byteLength > MAX_BYTES ? undefined : bytes;
  } catch {
    return undefined;
  }
}

/** Every `plugin:` reference a manifest holds. */
function collect(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collect(item, into);
    return into;
  }
  if (typeof value !== 'object' || value === null) return into;

  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'source' && isPluginAsset(item)) into.add(item);
    else collect(item, into);
  }

  return into;
}

function rewrite<T>(value: T, map: (source: string) => string): T {
  if (Array.isArray(value)) return value.map((item) => rewrite(item, map)) as unknown as T;
  if (typeof value !== 'object' || value === null) return value;

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = key === 'source' && typeof item === 'string' ? map(item) : rewrite(item, map);
  }

  return out as T;
}

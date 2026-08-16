import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';

import { ArchivePluginSource } from './archive-plugin-source.js';

/**
 * The plugins repository as a folder on this machine.
 *
 * What a developer's store reads: `pnpm build` in the plugins repository
 * leaves the window and the archives in `build/`, and this serves them
 * without any of it having to be pushed, released or downloaded.
 * The remote source is what a user gets; this is what somebody writing a
 * plugin gets, and the two answer the same questions.
 */

/** Where a checkout of the plugins repository is expected to sit. */
export const DEFAULT_PLUGIN_SOURCE = 'easydeck-plugins';

export class FolderPluginSource extends ArchivePluginSource {
  readonly name = 'local';

  constructor(private readonly root: string = defaultSourceRoot()) {
    super();
  }

  /**
   * Reads a file the build left, and only from inside the source.
   *
   * Everything published lives in `build/` — the window and one archive per
   * plugin — so this is one folder rather than the two it was. The path is
   * still checked for being inside the source: a name is exactly the thing
   * that should never be able to say `../../../.ssh/id_rsa`, even when it
   * comes from a file this machine wrote a moment ago.
   */
  protected async fetch(name: string): Promise<Uint8Array | undefined> {
    if (isAbsolute(name)) return undefined;

    const inside = resolve(this.root) + sep;
    const path = resolve(this.root, 'build', name);
    if (!path.startsWith(inside)) return undefined;

    try {
      return await readFile(path);
    } catch {
      return undefined;
    }
  }
}

/**
 * Where a checkout of the plugins repository might be, best guess first.
 *
 * Every folder from the working directory up to the root gets a candidate
 * beside it, rather than just the one place — because "beside the checkout"
 * depends on where the program was started from, and it is started from
 * different places: `packages/app` in development, the install folder in
 * production. The first version of this looked one level up from the working
 * directory, which found `D:\dev\easydeck-plugins` when run from the repo
 * root and `D:\dev\EasyDeck\packages\easydeck-plugins` — nothing — when the
 * app started itself the way it actually does.
 *
 * `EASYDECK_PLUGIN_SOURCE` short-circuits all of it, and is the answer for
 * anybody whose plugins repository is somewhere else entirely.
 */
export function pluginSourceCandidates(from: string = process.cwd()): string[] {
  const named = process.env['EASYDECK_PLUGIN_SOURCE'];
  if (named && named.length > 0) return [named];

  const candidates: string[] = [];
  let directory = resolve(from);

  for (;;) {
    candidates.push(join(directory, DEFAULT_PLUGIN_SOURCE));

    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }

  return candidates;
}

/** The first candidate, for a caller that wants one path rather than a list. */
export function defaultSourceRoot(): string {
  return pluginSourceCandidates()[0] ?? DEFAULT_PLUGIN_SOURCE;
}

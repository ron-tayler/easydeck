import { access } from 'node:fs/promises';
import { join } from 'node:path';

import type { PluginSource } from '../../application/ports/plugin-source.js';
import { FolderPluginSource, pluginSourceCandidates } from './folder-plugin-source.js';
import { GitHubPluginSource } from './github-plugin-source.js';

/**
 * Which shelf this build reads from.
 *
 * A user gets GitHub. Somebody writing a plugin gets the folder beside their
 * checkout, because the whole point of `pnpm build` in the plugins repository
 * is to try a plugin without pushing it, tagging it or waiting for a release.
 * The rule is written down here rather than decided at every call site.
 *
 * In order:
 *
 * 1. `EASYDECK_PLUGIN_SOURCE=github` — the published store, whatever else is
 *    on this machine. For testing what a user will actually see.
 * 2. `EASYDECK_PLUGIN_SOURCE=<path>` — that folder, said plainly.
 * 3. A built plugins repository beside any folder on the way up from the
 *    working directory — a development checkout, and nothing else looks like
 *    one. Every level is tried because the program is started from different
 *    places: the repository root by hand, `packages/app` by its own dev
 *    script, the install folder in production.
 * 4. GitHub.
 *
 * Deliberately *not* a fallback chain at run time: a store that silently
 * changed shelves when a build went stale would answer a different question
 * every time it was opened, and "why is my plugin not in the list" would
 * have two possible causes instead of one.
 */
export async function choosePluginSource(): Promise<PluginSource> {
  const named = process.env['EASYDECK_PLUGIN_SOURCE'];
  if (named === 'github') return new GitHubPluginSource();

  /*
   * A folder named outright is used whether or not anything is built in it.
   *
   * Falling through to GitHub because the checkout has not been built yet
   * would be the very thing the comment above warns against: somebody who
   * said which shelf to read would get a different one, silently, and an
   * empty store would mean "you have not run the build" one minute and
   * "there is no release" the next.
   */
  if (named && named.length > 0) return new FolderPluginSource(named);

  for (const candidate of pluginSourceCandidates()) {
    if (await built(candidate)) return new FolderPluginSource(candidate);
  }

  return new GitHubPluginSource();
}

/**
 * Whether a folder is a plugins repository somebody has built.
 *
 * The index rather than the folder: a fresh clone has the sources and no
 * `registry/index.json`, and reading from it would be an empty store with no
 * explanation. Unbuilt means "not a source", and the store goes to GitHub.
 */
async function built(root: string): Promise<boolean> {
  try {
    await access(join(root, 'registry', 'index.json'));
    return true;
  } catch {
    return false;
  }
}

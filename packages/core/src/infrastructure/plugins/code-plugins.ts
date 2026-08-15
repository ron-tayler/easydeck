import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { PLUGIN_API_VERSION } from '@easydeck/engine';
import type { ActionRegistry, PluginModule } from '@easydeck/engine';

import type { PluginRuntime } from '../../application/plugin-runtime.js';

/**
 * Loads the plugins that arrived as code.
 *
 * The same folder `readInstalledPlugins` reads for icons and translations,
 * one step further: a `plugin.json` naming a `main` is a plugin with a life,
 * and its module is imported and wired exactly the way a built-in wires
 * itself — manifest and handlers into the registry, the life into the
 * runtime, commands beside it. See `docs/plugin-distribution.md`.
 *
 * Every failure is contained. One plugin that will not load costs the user
 * that plugin and a line in the log, never the daemon — the folder is, by
 * design, full of code the build did not see.
 */

/** A plugin that could not be loaded, and the reason it could not. */
export interface CodePluginProblem {
  readonly id: string;
  readonly problem: string;
}

export interface LoadedCodePlugins {
  /** Manifest ids, in the order they were installed. */
  readonly loaded: readonly string[];
  readonly problems: readonly CodePluginProblem[];
}

const MANIFEST = 'plugin.json';

export async function loadCodePlugins(
  directory: string,
  registry: ActionRegistry,
  runtime: PluginRuntime,
): Promise<LoadedCodePlugins> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch {
    // No folder yet is the normal state on a fresh machine.
    return { loaded: [], problems: [] };
  }

  const loaded: string[] = [];
  const problems: CodePluginProblem[] = [];

  for (const entry of entries.sort((a, b) => a.localeCompare(b))) {
    const folder = join(directory, entry);

    try {
      const info = await stat(folder);
      if (!info.isDirectory()) continue;

      const declared = await readDeclaration(folder);
      if (!declared) continue; // icons-only, or not a plugin at all

      await loadOne(folder, entry, declared, registry, runtime);
      loaded.push(declared.id);
    } catch (error) {
      problems.push({
        id: entry,
        problem: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { loaded, problems };
}

/** What `plugin.json` says, where it says enough to be code. */
interface Declaration {
  readonly id: string;
  readonly main: string;
}

async function readDeclaration(folder: string): Promise<Declaration | undefined> {
  let raw: string;
  try {
    raw = await readFile(join(folder, MANIFEST), 'utf8');
  } catch {
    return undefined;
  }

  // A manifest that will not parse is reported by readInstalledPlugins
  // already; saying it twice would be the same line in the log twice.
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return undefined;
  }

  const main = json['main'];
  if (typeof main !== 'string' || main.trim() === '') return undefined;

  const id = json['id'];
  return { id: typeof id === 'string' ? id : '', main };
}

async function loadOne(
  folder: string,
  entry: string,
  declared: Declaration,
  registry: ActionRegistry,
  runtime: PluginRuntime,
): Promise<void> {
  /*
   * The entry point must be inside the plugin's own folder.
   *
   * `main` comes from a file somebody downloaded, and `../../anything.mjs`
   * would make installing one plugin a way to run another's files — or the
   * user's. Resolved and then checked, so `./dist/../main.mjs` still passes
   * and `..` in any form that escapes does not.
   */
  const main = resolve(folder, declared.main);
  if (!main.startsWith(resolve(folder) + sep)) {
    throw new Error(`${entry}: main '${declared.main}' points outside the plugin's folder`);
  }

  const imported = (await import(pathToFileURL(main).href)) as { default?: PluginModule };
  const module = imported.default;

  if (!module || typeof module !== 'object' || !module.manifest || typeof module.activate !== 'function') {
    throw new Error(`${entry}: main must default-export a PluginModule — see definePlugin`);
  }

  /*
   * Exact match, not "at most", unlike the registry's own check.
   *
   * The registry tolerates older plugins because for built-ins older cannot
   * happen. Here it can, and during alpha the contract moves — a plugin
   * built against version 1 may reference variables or fields version 2
   * renamed, and half-working is worse than refused with a reason.
   */
  if (module.manifest.apiVersion !== PLUGIN_API_VERSION) {
    throw new Error(
      `${entry}: built for plugin API ${module.manifest.apiVersion}, this build speaks ${PLUGIN_API_VERSION} — update the plugin`,
    );
  }

  /*
   * plugin.json is the storefront's copy and the module is the truth; if the
   * two disagree the build that produced the folder is broken, and trusting
   * either half of a broken build is guessing.
   */
  if (declared.id !== '' && declared.id !== module.manifest.id) {
    throw new Error(`${entry}: plugin.json says '${declared.id}' but the code says '${module.manifest.id}'`);
  }

  // Nothing from outside the box may claim to be from the box: builtIn is
  // what exempts a plugin from being uninstallable.
  const manifest = { ...module.manifest, builtIn: false };

  const activation = module.activate();

  registry.installPlugin(manifest, activation.handlers ?? {});
  await runtime.install(manifest, activation.plugin ?? {});
  if (activation.commands) runtime.registerCommands(manifest.id, activation.commands);
}

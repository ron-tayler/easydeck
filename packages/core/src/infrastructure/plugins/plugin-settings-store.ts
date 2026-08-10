import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { ParamDefinition, VariableValue } from '@easydeck/engine';

import type { SecretVault } from '../../application/ports/secret-vault.js';
import { plainSecretVault } from '../../application/ports/secret-vault.js';
import { pluginSettingsDir, secretsDir } from '../config-paths.js';
import { parseJsonText } from '../read-json.js';

/**
 * What each plugin has been told, split across two files on purpose.
 *
 * The ordinary settings — a port, a polling interval, a client id — live in a
 * file anybody can open, paste into an issue or edit by hand while the daemon
 * is off. The tokens live somewhere else entirely, so that "send me your
 * settings" never means "send me your Twitch account".
 *
 * The split is by declaration, not by guesswork: a parameter marked `secret`
 * goes one way, everything else the other. A plugin that later marks an
 * existing field as secret will find the old value still in the open file
 * until it is saved again — which is why `load` reads both and prefers the
 * sealed one.
 */
export class PluginSettingsStore {
  constructor(
    private readonly vault: SecretVault = plainSecretVault,
    private readonly openDir: string = pluginSettingsDir(),
    private readonly sealedDir: string = secretsDir(),
  ) {}

  /** Everything the plugin needs, secrets in the clear, ready to be used. */
  async load(pluginId: string): Promise<Record<string, VariableValue>> {
    const open = await readDocument(join(this.openDir, `${pluginId}.json`));
    const sealed = await readDocument(join(this.sealedDir, `${pluginId}.json`));

    const secrets: Record<string, VariableValue> = {};
    for (const [name, value] of Object.entries(sealed)) {
      if (typeof value !== 'string') continue;
      try {
        secrets[name] = this.vault.open(value);
      } catch {
        // A secret sealed by another user account, or on another machine.
        // Dropping it makes the plugin ask again, which is the only thing it
        // could usefully do; failing to load would take the daemon down over
        // a copied folder.
      }
    }

    return { ...open, ...secrets };
  }

  /**
   * Writes what changed, leaving untouched what was not sent.
   *
   * Partial on purpose: the configurator never receives a secret, so it
   * cannot send one back, and a save that replaced the whole document would
   * erase every token the moment somebody changed a port.
   */
  async save(
    pluginId: string,
    values: Readonly<Record<string, VariableValue>>,
    declarations: readonly ParamDefinition[],
  ): Promise<void> {
    const secret = new Set(declarations.filter((param) => param.secret).map((param) => param.name));
    const declared = new Set(declarations.map((param) => param.name));

    const openFile = join(this.openDir, `${pluginId}.json`);
    const sealedFile = join(this.sealedDir, `${pluginId}.json`);
    const open = await readDocument(openFile);
    const sealed = await readDocument(sealedFile);

    for (const [name, value] of Object.entries(values)) {
      // Anything the manifest does not declare is dropped rather than kept:
      // settings files outlive the plugins that wrote them, and a field that
      // no longer exists is a puzzle for whoever reads the file next.
      if (!declared.has(name)) continue;

      if (secret.has(name)) {
        delete open[name];
        if (value === '' || value === undefined) delete sealed[name];
        else sealed[name] = this.vault.seal(String(value));
      } else {
        open[name] = value;
      }
    }

    await writeDocument(openFile, open);
    await writeDocument(sealedFile, sealed, this.vault.sealed ? undefined : PLAIN_WARNING);
  }

  /** Which secrets are filled in — never their values. */
  async filledSecrets(pluginId: string): Promise<string[]> {
    const sealed = await readDocument(join(this.sealedDir, `${pluginId}.json`));
    return Object.keys(sealed).filter((name) => !name.startsWith('//'));
  }
}

/**
 * Said in the file rather than in a manual nobody opens.
 *
 * Whoever finds this file deserves to know what it is before they copy it
 * into a backup or a screenshot.
 */
const PLAIN_WARNING =
  'Tokens below are stored as they are: this build has no platform key store. ' +
  'Treat this file like a password file — do not share or back it up publicly.';

async function readDocument(file: string): Promise<Record<string, VariableValue>> {
  try {
    const parsed = parseJsonText(await readFile(file, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};

    const values: Record<string, VariableValue> = {};
    for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (name.startsWith('//')) continue;
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        values[name] = value;
      }
    }
    return values;
  } catch {
    // Missing is ordinary — most plugins are never configured. Corrupt is
    // rarer and treated the same: the plugin reports that it is not set up,
    // which is both true and fixable, rather than the daemon refusing to run.
    return {};
  }
}

async function writeDocument(
  file: string,
  values: Readonly<Record<string, VariableValue>>,
  note?: string,
): Promise<void> {
  const document = note ? { '//': note, ...values } : { ...values };

  if (Object.keys(values).length === 0) {
    // An empty file says a plugin was configured and then emptied, which is
    // not what happened. Removing it leaves the folder readable.
    await unlink(file).catch(() => undefined);
    return;
  }

  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  await rename(temporary, file);
}

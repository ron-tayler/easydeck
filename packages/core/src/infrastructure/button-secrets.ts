import { randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { SecretVault } from '../application/ports/secret-vault.js';
import { plainSecretVault } from '../application/ports/secret-vault.js';
import { profilesDir, secretsDir } from './config-paths.js';
import { parseJsonText } from './read-json.js';

/**
 * Passwords a button types, kept out of the profile that types them.
 *
 * The first thing a button holds that does not belong in its profile. A
 * profile is meant to be copied to another machine, exported as an archive,
 * pasted into an issue when something is wrong — and everything in it is
 * readable by anyone who receives it. A password put in there is a password
 * sent to whoever asked for the profile, usually without either party
 * noticing.
 *
 * So the document holds a reference — `secret:9f8b…` — and the password lives
 * here, in the machine's sealed store, beside the plugins' tokens. Exporting a
 * profile carries the reference and nothing else; the archive is the same
 * whether or not a password was ever set.
 *
 * Sealed through the same vault as everything else: DPAPI where Electron
 * offers it, so a copied file decrypts to nothing, and plainly with a warning
 * in the file where it does not.
 */

const FILE = 'buttons.json';

/** Written into the profile where a password would otherwise sit. */
const PREFIX = 'secret:';

/** Ids are found by scanning stored profiles; the shape has to be recognisable. */
const REFERENCE = /"secret:([0-9a-f]{16})"/g;

export function isSecretReference(value: unknown): value is string {
  return typeof value === 'string' && new RegExp(`^${PREFIX}[0-9a-f]{16}$`).test(value);
}

export function secretReference(id: string): string {
  return `${PREFIX}${id}`;
}

export function secretId(reference: string): string {
  return reference.startsWith(PREFIX) ? reference.slice(PREFIX.length) : reference;
}

export class ButtonSecretStore {
  constructor(
    private readonly vault: SecretVault = plainSecretVault,
    private readonly directory: string = secretsDir(),
  ) {}

  private get file(): string {
    return join(this.directory, FILE);
  }

  /**
   * The password behind a reference, or nothing.
   *
   * Only ever called by the action that types it. Nothing else in the daemon
   * asks, and no API answers with it.
   */
  async read(reference: string): Promise<string | undefined> {
    const stored = (await this.document())[secretId(reference)];
    if (typeof stored !== 'string') return undefined;

    try {
      return this.vault.open(stored);
    } catch {
      // Sealed by another user account, or on another machine. The button says
      // no password is set, which is true here and fixable.
      return undefined;
    }
  }

  /**
   * Stores a password and answers with the reference to put in the profile.
   *
   * An id is passed back in when a button's password is being changed, so the
   * profile does not have to be rewritten for an edit that changes nothing
   * about the button.
   */
  async save(value: string, id?: string): Promise<string> {
    const document = await this.document();
    const at = id && /^[0-9a-f]{16}$/.test(id) ? id : randomBytes(8).toString('hex');

    document[at] = this.vault.seal(value);
    await this.write(document);

    return secretReference(at);
  }

  async clear(reference: string): Promise<void> {
    const document = await this.document();
    if (!(secretId(reference) in document)) return;

    delete document[secretId(reference)];
    await this.write(document);
  }

  /** Which references have a password behind them — never the passwords. */
  async filled(): Promise<string[]> {
    return Object.keys(await this.document()).map(secretReference);
  }

  /**
   * Forgets passwords no profile refers to any more.
   *
   * A button deleted, or its action removed, would otherwise leave its
   * password on disk for good — which is the sort of thing a person is
   * entitled to assume did not happen.
   *
   * The profiles are read as text rather than loaded: this runs after every
   * save, and loading a profile means decoding every picture in it.
   */
  async sweep(directory: string = profilesDir()): Promise<number> {
    const document = await this.document();
    if (Object.keys(document).length === 0) return 0;

    const { ids, complete } = await referencedSecrets(directory);
    // One profile that could not be read is not evidence that its passwords
    // are unused. Deleting on a partial answer would lose somebody's password
    // because a file was briefly locked.
    if (!complete) return 0;

    const orphans = Object.keys(document).filter((id) => !ids.has(id));
    if (orphans.length === 0) return 0;

    for (const id of orphans) delete document[id];
    await this.write(document);

    return orphans.length;
  }

  private async document(): Promise<Record<string, string>> {
    try {
      const parsed = parseJsonText(await readFile(this.file, 'utf8'));
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};

      const document: Record<string, string> = {};
      for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (id.startsWith('//')) continue;
        if (typeof value === 'string') document[id] = value;
      }
      return document;
    } catch {
      return {};
    }
  }

  private async write(document: Readonly<Record<string, string>>): Promise<void> {
    if (Object.keys(document).length === 0) {
      await unlink(this.file).catch(() => undefined);
      return;
    }

    const withNote = this.vault.sealed ? { ...document } : { '//': PLAIN_WARNING, ...document };

    await mkdir(this.directory, { recursive: true });
    const temporary = `${this.file}.tmp`;
    await writeFile(temporary, `${JSON.stringify(withNote, null, 2)}\n`, 'utf8');
    await rename(temporary, this.file);
  }
}

/** Said in the file, because whoever finds it deserves to know what it holds. */
const PLAIN_WARNING =
  'Passwords below are stored as they are: this build has no platform key store. ' +
  'Treat this file like a password file — do not share or back it up publicly.';

/**
 * Every secret id any stored profile mentions, and whether all of them were read.
 *
 * By reading the documents as text: a reference is a string in JSON, and the
 * alternative — loading each profile properly — would decode every picture in
 * every profile to find a few sixteen-character ids.
 *
 * `complete` is false when a folder held something that was not a readable
 * profile. It is not an error — the folder is the user's and may hold
 * anything — but it does mean the answer is a floor rather than the truth,
 * which is the difference between sweeping and losing a password.
 */
export async function referencedSecrets(
  directory: string,
): Promise<{ ids: Set<string>; complete: boolean }> {
  const ids = new Set<string>();

  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch {
    // No profile directory at all: nothing refers to anything, and that is a
    // complete answer rather than a missing one.
    return { ids, complete: true };
  }

  let complete = true;

  for (const entry of entries) {
    const file = entry.endsWith('.json') ? join(directory, entry) : join(directory, entry, 'profile.json');

    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch {
      complete = false;
      continue;
    }

    for (const match of text.matchAll(REFERENCE)) {
      if (match[1]) ids.add(match[1]);
    }
  }

  return { ids, complete };
}

import { readFile, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { validateProfile } from '@easydeck/engine';
import type { ProfileDefinition } from '@easydeck/engine';

import { InvalidProfileIdError, ProfileNotFoundError } from '../domain/errors.js';
import type { ProfileRepository, ProfileSummary } from '../application/ports/repositories.js';
import { profilesDir } from './config-paths.js';
import { migrateProfile } from './migrate-profile.js';
import { readProfileFolder, writeProfileFolder } from './profile-assets.js';
import { parseJsonText } from './read-json.js';

/**
 * Profile ids double as folder names, so they are restricted rather than
 * escaped: a profile arriving over the API must not be able to name itself
 * `../../autostart` and have the daemon write there.
 */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export function assertSafeProfileId(id: string): void {
  if (!SAFE_ID.test(id) || id.length > 64) throw new InvalidProfileIdError(id);
}

/**
 * A profile per folder: the document, and its pictures beside it.
 *
 * It used to be one JSON file with every picture inside it as a data URL,
 * which is how a deck with two animations became nine megabytes of base64 —
 * unreadable by eye, and rewritten in full on every edit. Now the document is
 * forty kilobytes anybody can open, pictures are files named after their own
 * contents, and the same icon on twenty keys is one file.
 *
 * The old shape is still read. A `<id>.json` sitting in the folder loads as it
 * always did and becomes a folder the next time it is saved, so nobody has to
 * do anything about it — and nobody loses a profile by upgrading.
 */
export class FileProfileRepository implements ProfileRepository {
  constructor(private readonly directory: string = profilesDir()) {}

  get path(): string {
    return this.directory;
  }

  async list(): Promise<ProfileSummary[]> {
    let names: string[];
    try {
      names = await readdir(this.directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }

    const summaries = new Map<string, ProfileSummary>();

    for (const name of names) {
      const id = name.endsWith('.json') ? name.slice(0, -'.json'.length) : name;
      if (!SAFE_ID.test(id)) continue;
      // A folder wins over a file of the same name: it is the newer of the
      // two, written the last time that profile was saved.
      if (summaries.has(id)) continue;

      try {
        const profile = await this.read(id);
        summaries.set(id, { id: profile.id, name: profile.name });
      } catch {
        // One unreadable profile must not hide every other. The daemon
        // reports it when that one is actually asked for.
      }
    }

    return [...summaries.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  async has(id: string): Promise<boolean> {
    assertSafeProfileId(id);
    try {
      await this.read(id);
      return true;
    } catch {
      return false;
    }
  }

  async load(id: string): Promise<ProfileDefinition> {
    assertSafeProfileId(id);
    try {
      return await this.read(id);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new ProfileNotFoundError(id);
      throw error;
    }
  }

  async save(profile: ProfileDefinition): Promise<void> {
    assertSafeProfileId(profile.id);
    validateProfile(profile);

    await writeProfileFolder(this.folderFor(profile.id), profile);

    // The old file goes once the folder is written, not before: a crash
    // between the two would otherwise take the profile with it.
    await rm(this.fileFor(profile.id), { force: true });
  }

  async remove(id: string): Promise<void> {
    assertSafeProfileId(id);
    await rm(this.folderFor(id), { recursive: true, force: true });
    await rm(this.fileFor(id), { force: true });
  }

  private folderFor(id: string): string {
    return join(this.directory, id);
  }

  private fileFor(id: string): string {
    return join(this.directory, `${id}.json`);
  }

  /**
   * Reads whichever shape is there, preferring the folder.
   *
   * Migrated before validation: an older document is valid for its own
   * version, and refusing it would punish somebody for upgrading.
   */
  private async read(id: string): Promise<ProfileDefinition> {
    const folder = this.folderFor(id);
    const isFolder = await stat(folder)
      .then((entry) => entry.isDirectory())
      .catch(() => false);

    const document = isFolder
      ? await readProfileFolder(folder)
      : parseJsonText(await readFile(this.fileFor(id), 'utf8'));

    const profile = migrateProfile(document);
    validateProfile(profile);
    return profile;
  }
}

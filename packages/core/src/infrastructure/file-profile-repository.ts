import { readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { validateProfile } from '@easydeck/engine';
import type { ProfileDefinition } from '@easydeck/engine';

import { InvalidProfileIdError, ProfileNotFoundError } from '../domain/errors.js';
import type { ProfileRepository, ProfileSummary } from '../application/ports/repositories.js';
import { profilesDir } from './config-paths.js';
import { migrateProfile } from './migrate-profile.js';
import { readProfileFolder, writeProfileFolder } from './profile-assets.js';
import { freeName } from './profile-slug.js';
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

/** Where a profile of this id already is, if it is anywhere. */
type Filed = 'folder' | 'file' | undefined;

/**
 * A profile per folder: the document, and its pictures beside it.
 *
 * It used to be one JSON file with every picture inside it as a data URL,
 * which is how a deck with two animations became nine megabytes of base64 —
 * unreadable by eye, and rewritten in full on every edit. Now the document is
 * forty kilobytes anybody can open, pictures are files named after their own
 * contents, and the same icon on twenty keys is one file.
 *
 * **The folder's name is the profile's identity.** The document holds a `name`
 * a person reads and no id at all, so there is one answer to "which profile is
 * this" rather than three that can drift apart. Renaming the profile renames
 * the folder, transliterated, when that name is free.
 *
 * Saving writes where the profile came from, never where its name says it
 * should go. That is the whole of the safety here: two profiles may be called
 * "Stream", and the second must not land on top of the first.
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
        summaries.set(id, { id, name: profile.name });
      } catch {
        // One unreadable profile must not hide every other. The daemon
        // reports it when that one is actually asked for.
      }
    }

    return [...summaries.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  /**
   * Whether anything is filed under this id.
   *
   * Answered from the directory entry rather than by reading the profile: this
   * is asked on every save to find a free name, and reading a profile means
   * reading every picture in it.
   */
  async has(id: string): Promise<boolean> {
    if (!SAFE_ID.test(id) || id.length > 64) return false;
    return (await this.filed(id)) !== undefined;
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

  /**
   * Writes a profile and reports which folder it now lives in.
   *
   * The id it arrives with is a claim about where it came from, and it is only
   * honoured if something is actually there. A profile that is not on disk yet
   * — new, or imported — is filed under its name, so nothing outside this
   * class ever has to invent an id.
   *
   * A rename moves the folder rather than copying it: the pictures are the
   * bulk of a profile, and a rename that rewrote six megabytes to change a
   * word would be felt.
   */
  async save(profile: ProfileDefinition): Promise<string> {
    validateProfile(profile);

    const from = await this.filed(profile.id);
    const target = await freeName(
      profile.name,
      (candidate) => this.has(candidate),
      from ? profile.id : undefined,
    );
    assertSafeProfileId(target);

    if (from === 'folder' && target !== profile.id) {
      await rename(this.folderFor(profile.id), this.folderFor(target));
    }

    await writeProfileFolder(this.folderFor(target), profile);

    // The old file goes once the folder is written, not before: a crash
    // between the two would otherwise take the profile with it.
    if (from === 'file') await rm(this.fileFor(profile.id), { force: true });

    return target;
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

  /** Which shape this id is stored in, preferring the folder. */
  private async filed(id: string): Promise<Filed> {
    if (!SAFE_ID.test(id)) return undefined;

    const folder = await stat(this.folderFor(id))
      .then((entry) => entry.isDirectory())
      .catch(() => false);
    if (folder) return 'folder';

    const file = await stat(this.fileFor(id))
      .then((entry) => entry.isFile())
      .catch(() => false);
    return file ? 'file' : undefined;
  }

  /**
   * Reads whichever shape is there, and stamps the folder's name onto it.
   *
   * The id comes from where the profile is, never from what is written in it:
   * a copied file used to keep the original's id and answer to a name nobody
   * could see. Migrated before validation, because an older document is valid
   * for its own version and refusing it would punish somebody for upgrading.
   */
  private async read(id: string): Promise<ProfileDefinition> {
    const document =
      (await this.filed(id)) === 'folder'
        ? await readProfileFolder(this.folderFor(id))
        : parseJsonText(await readFile(this.fileFor(id), 'utf8'));

    const profile = { ...migrateProfile(document), id };
    validateProfile(profile);
    return profile;
  }
}

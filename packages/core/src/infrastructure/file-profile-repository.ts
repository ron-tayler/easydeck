import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { validateProfile } from '@easydeck/engine';
import type { ProfileDefinition } from '@easydeck/engine';

import { InvalidProfileIdError, ProfileNotFoundError } from '../domain/errors.js';
import type { ProfileRepository, ProfileSummary } from '../application/ports/repositories.js';
import { profilesDir } from './config-paths.js';
import { migrateProfile } from './migrate-profile.js';
import { parseJsonText } from './read-json.js';

/**
 * Profile ids double as file names, so they are restricted rather than
 * escaped: a profile arriving over the future WebSocket API must not be able
 * to name itself `../../autostart` and have the daemon write there.
 */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export function assertSafeProfileId(id: string): void {
  if (!SAFE_ID.test(id) || id.length > 64) throw new InvalidProfileIdError(id);
}

/** Profiles stored as one JSON document per file. */
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

    const summaries: ProfileSummary[] = [];
    for (const name of names.filter((candidate) => candidate.endsWith('.json'))) {
      try {
        const profile = await this.read(join(this.directory, name));
        summaries.push({ id: profile.id, name: profile.name });
      } catch {
        // One unreadable file must not hide every other profile. The daemon
        // reports it when that profile is actually asked for.
      }
    }

    return summaries.sort((a, b) => a.id.localeCompare(b.id));
  }

  async has(id: string): Promise<boolean> {
    assertSafeProfileId(id);
    try {
      await this.read(this.fileFor(id));
      return true;
    } catch {
      return false;
    }
  }

  async load(id: string): Promise<ProfileDefinition> {
    assertSafeProfileId(id);
    try {
      return await this.read(this.fileFor(id));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new ProfileNotFoundError(id);
      throw error;
    }
  }

  async save(profile: ProfileDefinition): Promise<void> {
    assertSafeProfileId(profile.id);
    validateProfile(profile);

    await mkdir(this.directory, { recursive: true });

    // Write beside the target and rename over it: a crash mid-write must not
    // leave a half-written profile that fails to load on next start.
    const target = this.fileFor(profile.id);
    const temporary = `${target}.tmp`;
    await writeFile(temporary, `${JSON.stringify(profile, null, 2)}\n`, 'utf8');
    await rename(temporary, target);
  }

  async remove(id: string): Promise<void> {
    assertSafeProfileId(id);
    await rm(this.fileFor(id), { force: true });
  }

  private fileFor(id: string): string {
    return join(this.directory, `${id}.json`);
  }

  private async read(file: string): Promise<ProfileDefinition> {
    // Migrated before validation: an older document is valid for its own
    // version, and refusing it would punish a user for upgrading.
    const profile = migrateProfile(parseJsonText(await readFile(file, 'utf8')));
    validateProfile(profile);
    return profile;
  }
}

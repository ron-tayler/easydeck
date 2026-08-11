import type { ProfileDefinition } from '@easydeck/engine';

import type { DaemonSettings } from '../../domain/settings.js';

export interface ProfileSummary {
  /** Where it is filed. Derived from the name; never inside the document. */
  readonly id: string;
  readonly name: string;
}

/**
 * Outbound port for stored profiles.
 *
 * A port rather than direct file access so the configurator can later serve
 * profiles from somewhere else — a database, a synced folder, a test double —
 * without the daemon caring.
 */
export interface ProfileRepository {
  list(): Promise<ProfileSummary[]>;
  load(id: string): Promise<ProfileDefinition>;
  /**
   * Stores a profile and answers with the id it is filed under.
   *
   * Which need not be the one it arrived with: a profile that is not stored
   * yet is filed under its name, and renaming one moves it. Callers holding an
   * id — a deck, the settings — have to take the answer rather than assume.
   */
  save(profile: ProfileDefinition): Promise<string>;
  remove(id: string): Promise<void>;
  has(id: string): Promise<boolean>;
}

export interface SettingsRepository {
  load(): Promise<DaemonSettings>;
  save(settings: DaemonSettings): Promise<void>;
}

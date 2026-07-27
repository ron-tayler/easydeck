import type { ProfileDefinition } from '@easydeck/engine';

import type { DaemonSettings } from '../../domain/settings.js';

export interface ProfileSummary {
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
  save(profile: ProfileDefinition): Promise<void>;
  remove(id: string): Promise<void>;
  has(id: string): Promise<boolean>;
}

export interface SettingsRepository {
  load(): Promise<DaemonSettings>;
  save(settings: DaemonSettings): Promise<void>;
}

/** Daemon-wide settings, persisted next to the profiles. */
export interface DaemonSettings {
  /** Profile to run at startup. Falls back to the first one found. */
  readonly activeProfileId?: string;
  /** Panel backlight, 0..100. */
  readonly brightness: number;
}

export const DEFAULT_SETTINGS: DaemonSettings = { brightness: 60 };

/** Coerces an untrusted settings document into something safe to use. */
export function normalizeSettings(raw: unknown): DaemonSettings {
  const value = (raw ?? {}) as Partial<Record<keyof DaemonSettings, unknown>>;
  const brightness = Number(value.brightness);

  return {
    activeProfileId: typeof value.activeProfileId === 'string' ? value.activeProfileId : undefined,
    brightness: Number.isFinite(brightness)
      ? Math.min(100, Math.max(0, Math.round(brightness)))
      : DEFAULT_SETTINGS.brightness,
  };
}

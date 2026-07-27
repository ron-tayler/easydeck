/** Base class for every error raised by the daemon zone. */
export class DaemonError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class ProfileNotFoundError extends DaemonError {
  constructor(readonly profileId: string) {
    super(`No profile '${profileId}' in the profile directory`);
  }
}

export class InvalidProfileIdError extends DaemonError {
  constructor(readonly profileId: string) {
    super(
      `Invalid profile id '${profileId}': use letters, digits, '-' and '_' only. ` +
        'Profile ids become file names, so anything else risks escaping the profile directory.',
    );
  }
}

export class NoProfilesError extends DaemonError {
  constructor(readonly directory: string) {
    super(`No profiles found in ${directory}`);
  }
}

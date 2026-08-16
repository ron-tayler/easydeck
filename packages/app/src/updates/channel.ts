/**
 * What an installed copy is allowed to do about a newer one.
 *
 * All of it is decided from plain values rather than read off the running
 * process, so the awkward cases — an unsigned Mac, a deb installed by apt —
 * can be reasoned about here and tested without an Electron around.
 */

/** Which builds this installation is offered. */
export type UpdateChannel = 'stable' | 'prerelease';

/**
 * The manifest an updater reads for a channel.
 *
 * These names are the ones the release workflow writes. Every release carries
 * `beta.yml`; a stable one carries `latest.yml` as well, which is what lets
 * somebody on pre-releases be offered a stable build that came out later.
 */
export function manifestChannel(channel: UpdateChannel): 'latest' | 'beta' {
  return channel === 'stable' ? 'latest' : 'beta';
}

/** Why an installation cannot replace itself, when it cannot. */
export type NoSelfUpdate =
  /** Running from source: there is no installation to replace. */
  | 'development'
  /** macOS refuses to swap in a build nobody signed. */
  | 'unsigned-macos'
  /** Installed by a package manager, which owns the files. */
  | 'linux-package';

export type UpdateAbility = { readonly self: true } | { readonly self: false; readonly reason: NoSelfUpdate };

/**
 * Whether macOS builds are signed with a Developer ID yet.
 *
 * Squirrel — what Electron updates through on macOS — verifies the signature
 * of whatever it is about to swap in, and refuses a build that has none. That
 * is not a check to work around: it is the one thing standing between an
 * update feed and an arbitrary application replacing this one.
 *
 * So until there is a certificate, macOS is offered the release page instead
 * of a download it could not install. Flip this when the certificate exists
 * and the whole path here opens up.
 */
const MACOS_BUILDS_ARE_SIGNED = false;

/**
 * What this installation can do about an update.
 *
 * Everything it needs is passed in: the platform, whether Electron is running
 * a packaged app, and whether the process came out of an AppImage. Linux is
 * the interesting one — an AppImage is a single file this program may replace,
 * while a deb belongs to the package manager, and rewriting files apt believes
 * it owns is how a system ends up in a state nobody can explain.
 */
export function updateAbility(where: {
  readonly platform: NodeJS.Platform;
  readonly packaged: boolean;
  readonly appImage: boolean;
}): UpdateAbility {
  if (!where.packaged) return { self: false, reason: 'development' };
  if (where.platform === 'darwin' && !MACOS_BUILDS_ARE_SIGNED) {
    return { self: false, reason: 'unsigned-macos' };
  }
  if (where.platform === 'linux' && !where.appImage) {
    return { self: false, reason: 'linux-package' };
  }
  return { self: true };
}

/**
 * Where somebody is sent when the program cannot install the update itself.
 *
 * The tag, not the releases index: whoever is reading this was told a specific
 * version exists, and landing them on a list to find it again is a small
 * unkindness the program can spare them.
 */
export function releasePageUrl(version: string): string {
  return `https://github.com/ron-tayler/easydeck/releases/tag/v${version}`;
}

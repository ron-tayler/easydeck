/**
 * Sealing a secret so that a file on disk is not a token in plain sight.
 *
 * A port rather than an implementation because the only sealing worth having
 * is the platform's own: on Windows, DPAPI ties the ciphertext to the user
 * account, so copying the file to another machine yields nothing. Electron
 * exposes it as `safeStorage`, and Electron is exactly what the engine and
 * the daemon must not depend on — hence this interface, implemented in the
 * desktop app and defaulted to below.
 *
 * Storing a key next to the ciphertext would be theatre, so the fallback does
 * not pretend: it leaves the text as it is and says so.
 */
export interface SecretVault {
  readonly seal: (text: string) => string;
  readonly open: (sealed: string) => string;
  /**
   * Whether sealing actually protects anything here.
   *
   * Surfaced so the daemon can say it once, in the file and in the log, and
   * so the configurator can tell the user what they are looking at instead of
   * implying a safety that is not there.
   */
  readonly sealed: boolean;
}

/**
 * The vault used when the platform offers nothing: keeps the text as it is.
 *
 * Deliberately not obfuscation. Base64 or a constant key would make the file
 * harder to read at a glance and no harder to read at all, while inviting
 * everybody involved to believe the secret is protected.
 */
export const plainSecretVault: SecretVault = {
  seal: (text) => text,
  open: (sealed) => sealed,
  sealed: false,
};

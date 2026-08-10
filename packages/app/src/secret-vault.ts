import { safeStorage } from 'electron';

import { plainSecretVault } from '@easydeck/core';
import type { SecretVault } from '@easydeck/core';

/**
 * Sealing tokens with the key store the operating system already keeps.
 *
 * The only implementation worth having, and the reason the daemon defines
 * this as a port: on Windows this is DPAPI, which ties the ciphertext to the
 * signed-in account, so a secrets file lifted onto another machine — or read
 * by another user of this one — decrypts to nothing. macOS uses the Keychain
 * and Linux whichever secret service is present.
 *
 * Lives in the desktop app because `safeStorage` is Electron's, and the
 * daemon must keep running for people who start it without Electron. They
 * get the plain vault instead, and a line in the file saying as much.
 */
export function electronSecretVault(): SecretVault {
  // False on a Linux box with no secret service, and briefly false before the
  // app is ready. Asked once, here, rather than at every save: a vault that
  // changed its mind halfway would leave a file half sealed.
  if (!safeStorage.isEncryptionAvailable()) return plainSecretVault;

  return {
    sealed: true,
    seal: (text) => safeStorage.encryptString(text).toString('base64'),
    open: (sealed) => safeStorage.decryptString(Buffer.from(sealed, 'base64')),
  };
}

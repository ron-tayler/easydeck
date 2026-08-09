import { createHash } from 'node:crypto';

import type { DiscoveredDevice } from '@easydeck/device';

/**
 * A name for a physical deck that survives a restart.
 *
 * Needed the moment there is more than one, because a profile is bound to a
 * deck and the binding has to still mean something tomorrow.
 *
 * The serial number is the right answer and the D6 does not have one — the
 * vendor's own driver hardcodes a constant where the serial should be. So the
 * fallback is the USB path, which names the port rather than the device: two
 * identical D6s are told apart by which socket they are in, and swapping the
 * cables swaps their profiles. There is no way around that short of hardware
 * that identifies itself, and pretending otherwise would be worse than saying
 * it plainly.
 */
export function deckIdFor(device: DiscoveredDevice): string {
  const serial = device.hid.serialNumber?.trim();
  if (serial) return `${device.model.id}-${serial}`;

  const path = device.hid.path ?? '';
  const port = createHash('sha1').update(path).digest('base64url').slice(0, 8);
  return `${device.model.id}-port-${port}`;
}

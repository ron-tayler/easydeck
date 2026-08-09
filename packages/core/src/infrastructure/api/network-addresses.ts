import { networkInterfaces } from 'node:os';

/**
 * Addresses this machine can be reached at, for someone typing one into a
 * tablet.
 *
 * The daemon binds to a wildcard, which tells nobody anything: "listening on
 * 0.0.0.0" is not an address you can open on a phone. So the useful answer is
 * assembled here — every real IPv4 the machine has, in the order a person
 * would try them.
 */

export interface NetworkAddress {
  readonly address: string;
  /** The adapter it belongs to, so a VPN or a virtual switch is recognisable. */
  readonly label: string;
  readonly loopback: boolean;
}

export function localAddresses(): NetworkAddress[] {
  const found: NetworkAddress[] = [];

  for (const [label, entries] of Object.entries(networkInterfaces())) {
    for (const entry of entries ?? []) {
      // IPv6 is left out on purpose: a bracketed address typed by hand on a
      // phone is a worse experience than no suggestion at all.
      if (entry.family !== 'IPv4') continue;

      found.push({ address: entry.address, label, loopback: entry.internal });
    }
  }

  // Real addresses first: loopback works only for the machine itself, and is
  // the one thing a person setting up a tablet does not want.
  return found.sort((a, b) => Number(a.loopback) - Number(b.loopback));
}

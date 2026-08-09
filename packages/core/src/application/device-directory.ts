import { EventEmitter } from 'node:events';

import { KnownDevices } from '../infrastructure/api/known-devices.js';
import type { KnownDevice } from '../infrastructure/api/known-devices.js';
import { PendingDevices } from '../infrastructure/api/pending-devices.js';
import type { PendingDevice } from '../infrastructure/api/pending-devices.js';

/**
 * Devices allowed in, and devices asking to be.
 *
 * This lives above the transport on purpose. It used to sit inside the
 * WebSocket server, which meant the desktop window — which talks to the core
 * over IPC, not over a socket — could neither see a request nor answer one:
 * approving was handled before the shared request handler ever saw it, and the
 * "devices changed" event never left the socket. A queue only one transport
 * can reach is not a queue, so it belongs here, where both can.
 */

export interface DeviceSummary {
  readonly id: string;
  readonly name: string;
  readonly approvedAt?: string;
  /** Whether it is connected right now. Offline entries are safe to remove. */
  readonly online: boolean;
}

export interface DeviceDirectoryEvents {
  /** The list of known or waiting devices changed. */
  changed: [];
  /** A device was let in and must be told its token, on its own connection. */
  approved: [device: KnownDevice];
}

export class DeviceDirectory extends EventEmitter<DeviceDirectoryEvents> {
  private readonly known: KnownDevices;
  private readonly pending = new PendingDevices();
  /** Identities with a live connection, so a list can say who is here. */
  private readonly online = new Set<string>();

  constructor(configDirectory: string) {
    super();
    this.known = new KnownDevices(configDirectory);
  }

  /** The device this token belongs to, if it is still allowed in. */
  byToken(token: string | undefined): Promise<KnownDevice | undefined> {
    return this.known.byToken(token);
  }

  /**
   * Records a device asking to be let in, or returns the request it already
   * has. Announced, so every open configurator learns about it at once.
   *
   * A device that had gone away and came back is announced too: its request
   * left the list when the connection dropped, so it has to reappear — with
   * the same code it was showing before, which is why it was kept.
   */
  request(id: string, name: string, address?: string): PendingDevice {
    const listed = this.pending.get(id);
    const request = this.pending.add(id, name, address);

    if (!listed || listed.gone) this.emit('changed');
    return request;
  }

  waiting(): readonly PendingDevice[] {
    return this.pending.list();
  }

  async devices(): Promise<readonly DeviceSummary[]> {
    // The token never leaves this object: everything above it works with names.
    return (await this.known.all()).map(({ token: _token, ...rest }) => ({
      ...rest,
      online: this.online.has(rest.id),
    }));
  }

  /**
   * Whether this identity is already spoken for.
   *
   * A device that lost its token — cleared storage, a private tab — would
   * otherwise come back claiming an identity that already has one, and there
   * is no way to tell that apart from someone else claiming it. Neither gets
   * in: the honest client simply picks a new identity and asks again.
   */
  async isTaken(id: string): Promise<boolean> {
    return (await this.known.all()).some((device) => device.id === id);
  }

  /** Records that an identity is connected, or is no longer. */
  setOnline(id: string, online: boolean): void {
    const changed = online ? !this.online.has(id) : this.online.delete(id);
    if (online) this.online.add(id);
    if (changed) this.emit('changed');
  }

  /**
   * Lets a device in, whether or not it is still connected.
   *
   * Approving something that has gone away is allowed on purpose: a request
   * that can only be answered while the other end is watching is a request
   * that gets stuck on screen. The device simply never receives its token —
   * it lands in the list as offline, where it can be removed in one click.
   */
  async approve(id: string): Promise<KnownDevice | undefined> {
    const request = this.pending.get(id);
    if (!request) return undefined;

    const device = await this.known.approve(id, request.name);
    this.pending.remove(id);

    // Delivered only if someone is listening; the caller knows whether that
    // worked, and the list shows the result either way.
    this.emit('approved', device);
    this.emit('changed');
    return device;
  }

  /**
   * Takes a request off the list because the device stopped waiting.
   *
   * A device that closed its page is not asking any more, and a request nobody
   * can answer usefully is clutter: approving it would mint a token with
   * nowhere to go. It will ask again when it comes back.
   */
  withdraw(id: string): void {
    if (this.pending.markGone(id)) this.emit('changed');
  }

  /** Refuses a waiting device, or takes back a device already let in. */
  async revoke(id: string): Promise<void> {
    this.pending.remove(id);
    await this.known.revoke(id);
    this.emit('changed');
  }
}

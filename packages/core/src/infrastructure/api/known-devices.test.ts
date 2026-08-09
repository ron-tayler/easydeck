import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { KnownDevices } from './known-devices.js';
import { PendingDevices } from './pending-devices.js';

async function store() {
  const directory = await mkdtemp(join(tmpdir(), 'easydeck-devices-'));
  return { directory, devices: new KnownDevices(directory) };
}

describe('devices the user has let in', () => {
  it('mints a token per device, not one shared secret', async () => {
    // Revoking one device must not disturb the others, which is exactly what
    // a shared password could never manage.
    const { directory, devices } = await store();

    const tablet = await devices.approve('t1', 'Tablet');
    const phone = await devices.approve('p1', 'Phone');

    assert.notEqual(tablet.token, phone.token);
    assert.ok(tablet.token.length >= 32);

    await rm(directory, { recursive: true, force: true });
  });

  it('recognises a device by its token, and forgets it when revoked', async () => {
    const { directory, devices } = await store();
    const tablet = await devices.approve('t1', 'Tablet');

    assert.equal((await devices.byToken(tablet.token))?.id, 't1');

    await devices.revoke('t1');
    assert.equal(await devices.byToken(tablet.token), undefined);

    await rm(directory, { recursive: true, force: true });
  });

  it('refuses an empty or unknown token', async () => {
    const { directory, devices } = await store();
    await devices.approve('t1', 'Tablet');

    assert.equal(await devices.byToken(undefined), undefined);
    assert.equal(await devices.byToken(''), undefined);
    assert.equal(await devices.byToken('not-a-token'), undefined);

    await rm(directory, { recursive: true, force: true });
  });

  it('survives a restart', async () => {
    const { directory, devices } = await store();
    const tablet = await devices.approve('t1', 'Tablet');

    const reopened = new KnownDevices(directory);
    assert.equal((await reopened.byToken(tablet.token))?.name, 'Tablet');

    await rm(directory, { recursive: true, force: true });
  });

  it('treats an unreadable list as an empty one', async () => {
    // A fresh install has no file at all, and that is not an error.
    const devices = new KnownDevices(join(tmpdir(), 'easydeck-nowhere-at-all'));

    assert.deepEqual(await devices.all(), []);
  });
});

describe('devices waiting to be let in', () => {
  it('gives each request a six-digit code', () => {
    const waiting = new PendingDevices();
    const request = waiting.add('t1', 'Tablet');

    assert.match(request.code, /^\d{6}$/);
  });

  it('keeps the code across a reconnect', () => {
    // The number on screen must not change while the user walks over to look
    // at it — a dropped Wi-Fi link is not a new request.
    const waiting = new PendingDevices();

    const first = waiting.add('t1', 'Tablet');
    const again = waiting.add('t1', 'Tablet');

    assert.equal(again.code, first.code);
  });

  it('forgets a request nobody answered', () => {
    let now = 1_000;
    const waiting = new PendingDevices({ expiryMs: 100, now: () => now });

    waiting.add('t1', 'Tablet');
    now += 101;

    assert.deepEqual(waiting.list(), []);
  });

  it('remembers where the request came from', () => {
    // An unexpected address is the one thing that tells the user this is not
    // the device in their hand.
    const waiting = new PendingDevices();
    const request = waiting.add('t1', 'Tablet', '192.168.1.20');

    assert.equal(request.address, '192.168.1.20');
  });

  it('a device that comes straight back keeps its code', () => {
    // The number is the whole point: someone is walking to the computer with
    // it in their head while the tablet quietly reconnects.
    const waiting = new PendingDevices();
    const first = waiting.add('t1', 'Tablet');

    waiting.markGone('t1');
    assert.deepEqual(waiting.list(), [], 'a departed request must not be offered');

    const back = waiting.add('t1', 'Tablet');
    assert.equal(back.code, first.code);
    assert.equal(waiting.list().length, 1);
  });

  it('a device that never comes back is forgotten quickly', () => {
    let now = 1_000;
    const waiting = new PendingDevices({ goneMs: 100, now: () => now });

    waiting.add('t1', 'Tablet');
    waiting.markGone('t1');
    now += 101;

    assert.equal(waiting.get('t1'), undefined);
  });

  it('drops a request once it is answered', () => {
    const waiting = new PendingDevices();
    waiting.add('t1', 'Tablet');

    waiting.remove('t1');

    assert.equal(waiting.get('t1'), undefined);
  });
});

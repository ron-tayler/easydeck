import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { DeviceDirectory } from './device-directory.js';

async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'easydeck-directory-'));
  return { path, devices: new DeviceDirectory(path) };
}

describe('the device queue', () => {
  it('a device that reconnects keeps its request', async () => {
    // Reloading the page is not a new device asking. Without this, every
    // refresh left another request nobody could answer.
    const { path, devices } = await directory();

    const first = devices.request('t1', 'Tablet');
    const again = devices.request('t1', 'Tablet');

    assert.equal(again.code, first.code);
    assert.equal(devices.waiting().length, 1);

    await rm(path, { recursive: true, force: true });
  });

  it('announces a new request, and stays quiet about a repeat', async () => {
    const { path, devices } = await directory();
    let changes = 0;
    devices.on('changed', () => changes++);

    devices.request('t1', 'Tablet');
    devices.request('t1', 'Tablet');

    assert.equal(changes, 1);
    await rm(path, { recursive: true, force: true });
  });

  it('an identity already approved cannot be claimed again', async () => {
    // The claim may be an honest device that lost its token, or someone else
    // entirely — and there is no way to tell. Neither gets in.
    const { path, devices } = await directory();

    devices.request('t1', 'Tablet');
    await devices.approve('t1');

    assert.equal(await devices.isTaken('t1'), true);
    assert.equal(await devices.isTaken('t2'), false);

    await rm(path, { recursive: true, force: true });
  });

  it('approving works even for a device that has gone away', async () => {
    // A request answerable only while the other end is watching is a request
    // that gets stuck on screen forever.
    const { path, devices } = await directory();
    devices.request('t1', 'Tablet');

    const approved = await devices.approve('t1');

    assert.equal(approved?.id, 't1');
    assert.deepEqual(devices.waiting(), []);
    assert.equal((await devices.devices())[0]?.online, false, 'nothing is connected');

    await rm(path, { recursive: true, force: true });
  });

  it('rejecting works whether the device is there or not', async () => {
    const { path, devices } = await directory();
    devices.request('t1', 'Tablet');

    await devices.revoke('t1');

    assert.deepEqual(devices.waiting(), []);
    assert.deepEqual(await devices.devices(), []);

    await rm(path, { recursive: true, force: true });
  });

  it('an approved device that leaves is listed as offline, and can be removed', async () => {
    const { path, devices } = await directory();
    devices.request('t1', 'Tablet');
    await devices.approve('t1');
    devices.setOnline('t1', true);

    assert.equal((await devices.devices())[0]?.online, true);

    devices.setOnline('t1', false);
    assert.equal((await devices.devices())[0]?.online, false);

    await devices.revoke('t1');
    assert.deepEqual(await devices.devices(), []);

    await rm(path, { recursive: true, force: true });
  });

  it('presence changes are announced, so a list can follow', async () => {
    const { path, devices } = await directory();
    devices.request('t1', 'Tablet');
    await devices.approve('t1');

    let changes = 0;
    devices.on('changed', () => changes++);

    devices.setOnline('t1', true);
    devices.setOnline('t1', true); // already known to be here
    devices.setOnline('t1', false);

    assert.equal(changes, 2);
    await rm(path, { recursive: true, force: true });
  });

  it('a request goes away when the device stops waiting', async () => {
    // Approving it would mint a token with nowhere to go, and leaving it on
    // screen gives the user buttons that cannot reach anybody.
    const { path, devices } = await directory();
    devices.request('t1', 'Tablet');

    devices.withdraw('t1');

    assert.deepEqual(devices.waiting(), []);
    await rm(path, { recursive: true, force: true });
  });

  it('a device that comes back is announced again, with the same code', async () => {
    // Reloading the page takes the request off the list and puts it back. The
    // list has to hear about both, and the number must not change underneath
    // someone who is walking over to read it.
    const { path, devices } = await directory();
    const first = devices.request('t1', 'Tablet');
    devices.withdraw('t1');

    let changes = 0;
    devices.on('changed', () => changes++);
    const back = devices.request('t1', 'Tablet');

    assert.equal(changes, 1);
    assert.equal(back.code, first.code);
    assert.equal(devices.waiting().length, 1);

    await rm(path, { recursive: true, force: true });
  });

  it('withdrawing something that is not there changes nothing', async () => {
    const { path, devices } = await directory();
    let changes = 0;
    devices.on('changed', () => changes++);

    devices.withdraw('nobody');

    assert.equal(changes, 0);
    await rm(path, { recursive: true, force: true });
  });

  it('rejecting an approved device that is offline still removes it', async () => {
    const { path, devices } = await directory();
    devices.request('t1', 'Tablet');
    await devices.approve('t1');
    // Never connected since: exactly the entry a user wants gone.

    await devices.revoke('t1');

    assert.deepEqual(await devices.devices(), []);
    await rm(path, { recursive: true, force: true });
  });

  it('an approved device is recognised by its token, and only by it', async () => {
    const { path, devices } = await directory();
    devices.request('t1', 'Tablet');
    const approved = await devices.approve('t1');

    assert.equal((await devices.byToken(approved!.token))?.id, 't1');
    assert.equal(await devices.byToken('t1'), undefined, 'the id is not a credential');

    await rm(path, { recursive: true, force: true });
  });
});

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { WebSocket } from 'ws';

import { DeviceDirectory } from '../../application/device-directory.js';
import { startApiServer } from './websocket-server.js';
import type { RunningApiServer } from './websocket-server.js';

/**
 * What happens to a deck when its connection goes away.
 *
 * The daemon drops a network deck the moment its socket closes, so a page that
 * reconnects owns nothing: every press it sends has no deck to reach. Answered
 * with "ok" — as it used to be — the page looks alive and does nothing, which
 * is indistinguishable from having frozen.
 */

const GESTURES: string[] = [];

function fakeService() {
  return {
    state: async () => ({ decks: [], activeDeckId: undefined, brightness: 60 }),
    pageView: async () => [],
    attachNetworkDeck: async () => ({ deckId: 'net-1' }),
    detachDeck: async () => undefined,
    reportGesture: (deckId: string, key: number, gesture: string) =>
      GESTURES.push(`${deckId}:${key}:${gesture}`),
    reportPressed: () => undefined,
    onDeckEvent: () => () => undefined,
  };
}

async function serve(): Promise<{
  server: RunningApiServer;
  token: string;
  directory: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), 'easydeck-session-'));
  const devices = new DeviceDirectory(directory);

  devices.request('t1', 'Tablet');
  const approved = await devices.approve('t1');

  const server = await startApiServer({
    // The fake stands in for the whole facade; only what a device may call is
    // exercised here.
    service: fakeService() as never,
    configDirectory: directory,
    devices,
    host: '127.0.0.1',
    port: 0,
    permissions: async () => ({ networkDecks: true, extensionsApi: false }),
  });

  return { server, token: approved!.token, directory };
}

/** One request, one answer. */
function ask(
  socket: WebSocket,
  method: string,
  params: Record<string, unknown> = {},
): Promise<{ ok: boolean; error?: { message: string }; result?: unknown }> {
  return new Promise((resolve) => {
    const id = `q${Math.floor(performance.now() * 1000)}`;
    const listen = (raw: unknown) => {
      const message = JSON.parse(String(raw)) as {
        type: string;
        id?: string;
        ok?: boolean;
        error?: { message: string };
        result?: unknown;
      };
      if (message.type !== 'response' || message.id !== id) return;

      socket.off('message', listen);
      resolve({ ok: message.ok === true, ...message });
    };

    socket.on('message', listen);
    socket.send(JSON.stringify({ type: 'request', id, method, params }));
  });
}

function open(port: number, token: string): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/?token=${token}`);
  return new Promise((resolve) => socket.on('open', () => resolve(socket)));
}

describe('a deck and the connection it lives on', () => {
  const started: RunningApiServer[] = [];
  const directories: string[] = [];

  after(async () => {
    for (const server of started) await server.close();
    for (const path of directories) await rm(path, { recursive: true, force: true });
  });

  it('refuses a gesture from a device that has not attached a deck', async () => {
    const { server, token, directory } = await serve();
    started.push(server);
    directories.push(directory);

    const socket = await open(server.port, token);
    const answer = await ask(socket, 'deckGesture', { key: 0, gesture: 'press' });

    assert.equal(answer.ok, false);
    assert.equal(answer.error?.message, 'deckDetached');
    socket.close();
  });

  it('accepts gestures once a deck is attached, and again after reconnecting', async () => {
    const { server, token, directory } = await serve();
    started.push(server);
    directories.push(directory);

    const first = await open(server.port, token);
    await ask(first, 'attachDeck', { rows: 3, cols: 5, name: 'Tablet' });
    assert.equal((await ask(first, 'deckGesture', { key: 2, gesture: 'press' })).ok, true);

    // The socket dies; the deck goes with it. What a reconnecting page must do
    // is attach again — and until it does, it is told so rather than humoured.
    first.close();
    const second = await open(server.port, token);

    assert.equal((await ask(second, 'deckGesture', { key: 2, gesture: 'press' })).ok, false);
    await ask(second, 'attachDeck', { rows: 3, cols: 5, name: 'Tablet' });
    assert.equal((await ask(second, 'deckGesture', { key: 2, gesture: 'press' })).ok, true);

    assert.equal(GESTURES.filter((entry) => entry === 'net-1:2:press').length, 2);
    second.close();
  });
});

/**
 * A minimal client for the daemon API — and the shortest possible
 * documentation of the protocol.
 *
 * Run with:  pnpm --filter @easydeck/daemon api-client
 * (the daemon must already be running)
 *
 * Connects, asks for the state, lists the profiles, then streams events until
 * Ctrl+C. Press keys on the deck and watch them arrive.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import WebSocket from 'ws';

import { configDir } from '../infrastructure/config-paths.js';
import type { RequestMessage, ServerMessage } from '../domain/api-messages.js';

const PORT = Number(process.env['EASYDECK_PORT'] ?? 8317);

async function main(): Promise<void> {
  const token = (await readFile(join(configDir(), 'api-token'), 'utf8')).trim();
  const socket = new WebSocket(`ws://127.0.0.1:${PORT}/?token=${token}`);

  /** Resolvers for in-flight requests, keyed by the id we sent. */
  const pending = new Map<string, (message: ServerMessage) => void>();
  let nextId = 1;

  const call = (method: string, params?: Record<string, unknown>): Promise<ServerMessage> => {
    const request: RequestMessage = { type: 'request', id: String(nextId++), method, params };
    return new Promise((resolve) => {
      pending.set(request.id, resolve);
      socket.send(JSON.stringify(request));
    });
  };

  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString()) as ServerMessage;

    if (message.type === 'response') {
      pending.get(message.id)?.(message);
      pending.delete(message.id);
      return;
    }

    // Events arrive unsolicited; 'state' also lands right after connecting.
    if (message.event === 'state') {
      console.log('event state:', JSON.stringify(message.payload));
    } else {
      console.log(`event ${message.event}:`, JSON.stringify(message.payload ?? {}));
    }
  });

  socket.on('error', (error) => {
    console.error('socket error:', error.message);
    process.exitCode = 1;
  });

  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  console.log(`connected to ws://127.0.0.1:${PORT}\n`);

  const state = await call('getState');
  console.log('getState ->', JSON.stringify(state.type === 'response' ? state.result : state, null, 2));

  const profiles = await call('listProfiles');
  console.log('listProfiles ->', JSON.stringify(profiles.type === 'response' ? profiles.result : profiles));

  console.log('\nStreaming events. Press keys on the deck. Ctrl+C to exit.\n');

  process.on('SIGINT', () => {
    socket.close();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

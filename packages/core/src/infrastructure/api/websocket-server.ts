import { createServer } from 'node:http';
import type { IncomingMessage, Server } from 'node:http';

import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';

import { ApiHandler } from '../../application/api-handler.js';
import type { ApiSource } from '../../application/ports/deck-facade.js';
import type { EventMessage, ServerMessage } from '../../domain/api-messages.js';
import { API_PROTOCOL_VERSION } from '../../domain/api-messages.js';
import { loadOrCreateToken, originAllowed, tokenMatches } from './auth-token.js';

export interface ApiServerOptions {
  /** The deck, or a host that owns one and outlives it across lock cycles. */
  readonly service: ApiSource;
  /** Directory the token is stored in. */
  readonly configDirectory: string;
  readonly port?: number;
  /** Bind address. Loopback by default, and changing it is a deliberate act. */
  readonly host?: string;
}

export interface RunningApiServer {
  readonly url: string;
  readonly token: string;
  readonly port: number;
  close(): Promise<void>;
}

const DEFAULT_PORT = 8317;

/**
 * Serves the daemon API over a WebSocket.
 *
 * Bound to loopback and gated by a token: the API can write profiles, and a
 * profile can launch programs, so an open socket here is an open shell.
 */
export async function startApiServer(options: ApiServerOptions): Promise<RunningApiServer> {
  const port = options.port ?? DEFAULT_PORT;
  const host = options.host ?? '127.0.0.1';
  const token = await loadOrCreateToken(options.configDirectory);

  const handler = new ApiHandler(options.service);
  const clients = new Set<WebSocket>();

  const http = createServer((request, response) => {
    // A liveness probe that leaks nothing: no token, no state.
    if (request.url === '/health') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true, protocolVersion: API_PROTOCOL_VERSION }));
      return;
    }
    response.writeHead(404).end();
  });

  const wss = new WebSocketServer({ noServer: true });

  http.on('upgrade', (request, socket, head) => {
    if (!authorize(request, port, token)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
  });

  wss.on('connection', (ws: WebSocket) => {
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));

    ws.on('message', (raw) => {
      void (async () => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw.toString());
        } catch {
          send(ws, {
            type: 'response',
            id: '',
            ok: false,
            error: { message: 'Message is not valid JSON' },
          });
          return;
        }

        send(ws, await handler.handle(parsed));
      })();
    });

    // A fresh client should not have to ask what it is looking at.
    void options.service.state().then((state) => send(ws, { type: 'event', event: 'state', payload: state }));
  });

  const broadcast = (message: EventMessage) => {
    for (const ws of clients) send(ws, message);
  };

  const service = options.service;
  service.onDeckEvent('state', (state) => broadcast({ type: 'event', event: 'state', payload: state }));
  service.onDeckEvent('pageChanged', (pageId) =>
    broadcast({ type: 'event', event: 'pageChanged', payload: { pageId } }),
  );
  service.onDeckEvent('variablesChanged', (variables) =>
    broadcast({ type: 'event', event: 'variablesChanged', payload: { variables } }),
  );
  service.onDeckEvent('keyDown', (key) => broadcast({ type: 'event', event: 'keyDown', payload: { key } }));
  service.onDeckEvent('keyUp', (key) => broadcast({ type: 'event', event: 'keyUp', payload: { key } }));
  service.onDeckEvent('profilesChanged', () => broadcast({ type: 'event', event: 'profilesChanged' }));
  service.onDeckEvent('actionError', (message) =>
    broadcast({ type: 'event', event: 'actionError', payload: { message } }),
  );

  await listen(http, port, host);

  return {
    url: `ws://${host}:${port}`,
    token,
    port,
    async close() {
      for (const ws of clients) ws.close();
      clients.clear();
      wss.close();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}

function authorize(request: IncomingMessage, port: number, token: string): boolean {
  if (!originAllowed(request.headers.origin, port)) return false;

  const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);
  return tokenMatches(token, url.searchParams.get('token') ?? undefined);
}

function send(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify(message));
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
}

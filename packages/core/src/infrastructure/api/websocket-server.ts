import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, Server } from 'node:http';

import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';

import { ApiHandler } from '../../application/api-handler.js';
import { AssetStore } from './asset-store.js';
import type { ApiSource } from '../../application/ports/deck-facade.js';
import type { EventMessage, ServerMessage } from '../../domain/api-messages.js';
import { API_PROTOCOL_VERSION, isRequestMessage } from '../../domain/api-messages.js';
import { loadOrCreateToken, originAllowed, tokenMatches } from './auth-token.js';
import type { DeviceDirectory } from '../../application/device-directory.js';
import type { KnownDevice } from './known-devices.js';
import type { PendingDevice } from './pending-devices.js';
import { serveDirectory } from './static-files.js';

export interface ApiServerOptions {
  /**
   * Whether an approved device may claim a deck of its own, and whether it may
   * drive the whole API.
   *
   * Passed in rather than read here, because these are user settings and this
   * file has no business loading them. Checked per request, so switching them
   * takes effect without a restart.
   */
  readonly permissions?: () => Promise<{ networkDecks: boolean; extensionsApi: boolean }>;
  /**
   * Devices allowed in, and devices asking to be.
   *
   * Owned above the transport, because the desktop window reaches the core
   * over IPC rather than over this socket: a queue only one of them can see is
   * no use to anybody. Without it the server accepts nothing but the daemon's
   * own token.
   */
  readonly devices?: DeviceDirectory;
  /** The deck, or a host that owns one and outlives it across lock cycles. */
  readonly service: ApiSource;
  /** Directory the token is stored in. */
  readonly configDirectory: string;
  readonly port?: number;
  /** Bind address. Loopback by default, and changing it is a deliberate act. */
  readonly host?: string;
  /**
   * Directory of the built configurator, served from the same origin as the
   * API.
   *
   * Omit and the daemon serves nothing but `/health` — which is right for a
   * headless run, and for the desktop app, whose window loads the interface
   * from disk.
   */
  readonly uiDirectory?: string;
}

export interface RunningApiServer {
  readonly url: string;
  readonly token: string;
  readonly port: number;
  close(): Promise<void>;
}

export const DEFAULT_PORT = 8317;

/** A cause, not a sentence: the page decides what to do about it. */
const DETACHED = 'deckDetached';

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

  // Pictures go out as links rather than as bytes in every key's description;
  // this is where the bytes stay behind.
  const assets = new AssetStore();
  const handler = new ApiHandler(options.service, { assets });
  const clients = new Set<WebSocket>();

  const files = options.uiDirectory ? serveDirectory(options.uiDirectory) : undefined;
  const permissions =
    options.permissions ?? (async () => ({ networkDecks: true, extensionsApi: false }));
  const directory = options.devices;

  const http = createServer((request, response) => {
    // A liveness probe that leaks nothing: no token, no state.
    if (request.url === '/health') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true, protocolVersion: API_PROTOCOL_VERSION }));
      return;
    }

    /*
     * What the served page is allowed to be, decided here rather than by the
     * page itself: a mode taken from the query string is a mode anyone can
     * choose, and the configurator edits profiles and launches programs.
     * Over the network it is always a deck.
     */
    if (request.url?.startsWith('/app-mode')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ mode: 'deck' }));
      return;
    }

    /*
     * A picture, fetched once for however many keys it covers.
     *
     * No token: the id is the digest of the content, so it cannot be guessed,
     * and it is only ever handed to a page that has already been let in. The
     * long cache is safe for the same reason — a different picture is a
     * different link.
     */
    const asset = /^\/asset\/([A-Za-z0-9_-]+)$/.exec(request.url ?? '');
    if (asset) {
      const stored = assets.get(asset[1]!);
      if (!stored) {
        response.writeHead(404).end();
        return;
      }

      response.writeHead(200, {
        'content-type': stored.contentType,
        'content-length': stored.bytes.length,
        'cache-control': 'public, max-age=31536000, immutable',
      });
      response.end(request.method === 'HEAD' ? undefined : stored.bytes);
      return;
    }

    /*
     * The page itself is served without a token, and deliberately: it is a
     * static bundle that knows nothing until it opens a socket, and that
     * socket is where the token is demanded. Gating the page would only mean
     * putting a secret in a URL people paste around.
     */
    if (files) {
      void files
        .serve(request, response)
        .then((served) => {
          if (!served) response.writeHead(404).end();
        })
        .catch(() => {
          if (!response.headersSent) response.writeHead(500).end();
        });
      return;
    }

    response.writeHead(404).end();
  });

  const wss = new WebSocketServer({ noServer: true });

  http.on('upgrade', (request, socket, head) => {
    /*
     * Only the origin is checked here. Who the caller is — the configurator,
     * an approved device, or a stranger that has to wait — is decided once the
     * socket is up, because an unknown device is not rejected: it is put in a
     * queue for a human to look at.
     */
    if (!originAllowed(request.headers.origin, port, request.headers.host)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
  });

  wss.on('connection', (ws: WebSocket, request: IncomingMessage) => {
    clients.add(ws);

    void (async () => {
      const session = await identify(request);
      sessions.set(ws, session);

      if (session.level === 'device') directory?.setOnline(session.device.id, true);

      if (session.level === 'rejected') {
        // Said plainly rather than left to time out: a device showing a code
        // nobody ever received is worse than a device saying what is wrong.
        send(ws, {
          type: 'event',
          event: 'deviceRejected',
          payload: { reason: session.reason },
        });
        return;
      }

      if (session.level === 'pending') {
        // Nothing is served until a human says so. The device is shown its
        // code and waits; the configurator shows the same code beside its name.
        send(ws, {
          type: 'event',
          event: 'devicePending',
          payload: { code: session.request.code, name: session.request.name },
        });
        return;
      }

      // A fresh client should not have to ask what it is looking at. If no deck
      // is attached yet the snapshot simply is not available — the client will
      // get one from the 'state' event as soon as there is something to send.
      await options.service
        .state()
        .then((state) => send(ws, { type: 'event', event: 'state', payload: state }))
        .catch(() => undefined);
    })();

    ws.on('close', () => {
      const session = sessions.get(ws);
      if (session?.level === 'device') directory?.setOnline(session.device.id, false);
      // Gone before anyone answered: the request goes with it, rather than
      // sitting on screen with buttons that can no longer reach anybody.
      if (session?.level === 'pending') directory?.withdraw(session.request.id);

      void releaseDeck(ws).finally(() => {
        clients.delete(ws);
        sessions.delete(ws);
      });
    });
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

        // Anything a connection may not ask for is answered here, so the deck
        // API never sees a request from a device that is not allowed to make it.
        if (await answerForSession(ws, sessions.get(ws), parsed)) return;

        send(ws, await handler.handle(parsed));
      })();
    });
  });

  /**
   * What a connection is allowed to do.
   *
   * Three answers, and the difference matters: the configurator holds the
   * daemon's own token and may do anything; an approved device may drive its
   * own deck and read what to draw, but not rewrite profiles; an unknown
   * device may do nothing at all until a human says otherwise.
   */
  type Session =
    | { readonly level: 'trusted' }
    | { readonly level: 'device'; readonly device: KnownDevice; deckId?: string }
    | { readonly level: 'pending'; readonly request: PendingDevice }
    /** Connected, but not entertained: told why, and left to close. */
    | { readonly level: 'rejected'; readonly reason: string };

  const sessions = new Map<WebSocket, Session>();

  async function identify(request: IncomingMessage): Promise<Session> {
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);
    const offered = url.searchParams.get('token') ?? undefined;

    if (tokenMatches(token, offered)) return { level: 'trusted' };

    // A code rather than a sentence: the device shows this to a person, and
    // the daemon has no idea what language they read.
    if (!directory) return { level: 'rejected', reason: 'notAccepted' };

    const device = await directory.byToken(offered);
    if (device) return { level: 'device', device };

    const claimed = url.searchParams.get('device') ?? '';
    if (claimed && (await directory.isTaken(claimed))) {
      // The identity exists but this connection cannot prove it owns it. Said
      // plainly so an honest client can start over as somebody new, rather
      // than queueing forever behind a request it can never complete.
      return { level: 'rejected', reason: 'idTaken' };
    }

    // Asking to be let in is only meaningful if decks over the network are
    // switched on; otherwise the device is told so instead of being shown a
    // code that leads nowhere.
    if (!(await permissions()).networkDecks) {
      return { level: 'rejected', reason: 'networkDecksOff' };
    }

    const name = url.searchParams.get('name') ?? 'Device';
    return {
      level: 'pending',
      request: directory.request(
        claimed || randomUUID(),
        name,
        request.socket.remoteAddress ?? undefined,
      ),
    };
  }

  /*
   * A device is told its token on its own connection, and nowhere else: the
   * token is the one thing that must never be broadcast. Approval itself
   * happens in the service, so this only delivers the news.
   */
  directory?.on('approved', (device) => {
    for (const [socket, other] of sessions) {
      if (other.level !== 'pending' || other.request.id !== device.id) continue;

      send(socket, {
        type: 'event',
        event: 'deviceApproved',
        payload: { token: device.token, deviceId: device.id },
      });
      sessions.set(socket, { level: 'device', device });
      directory.setOnline(device.id, true);
    }
  });

  /** Drops the deck a departing device was driving. */
  async function releaseDeck(ws: WebSocket): Promise<void> {
    const session = sessions.get(ws);
    if (session?.level !== 'device' || !session.deckId) return;

    await options.service.detachDeck(session.deckId).catch(() => undefined);
  }

  /**
   * Handles what belongs to this connection rather than to the deck API.
   *
   * Returns true once it has answered, so the ordinary handler never sees a
   * request from a connection that is not allowed to make it.
   */
  async function answerForSession(
    ws: WebSocket,
    session: Session | undefined,
    parsed: unknown,
  ): Promise<boolean> {
    if (!isRequestMessage(parsed)) return false;
    const params = parsed.params ?? {};

    if (!session || session.level === 'pending' || session.level === 'rejected') {
      send(ws, {
        type: 'response',
        id: parsed.id,
        ok: false,
        error: {
          message:
            session?.level === 'rejected'
              ? session.reason
              : 'This device is waiting to be approved',
        },
      });
      return true;
    }

    if (session.level === 'trusted') return false;

    // From here on the connection is an approved device.
    switch (parsed.method) {
      case 'attachDeck': {
        const allowed = await permissions();
        if (!allowed.networkDecks) {
          send(ws, {
            type: 'response',
            id: parsed.id,
            ok: false,
            error: { message: 'networkDecksOff' },
          });
          return true;
        }

        const { deckId } = await options.service.attachNetworkDeck({
          deviceId: session.device.id,
          name: String(params['name'] ?? session.device.name),
          rows: Number(params['rows'] ?? 3),
          cols: Number(params['cols'] ?? 5),
          send: (scene, doublePressKeys) =>
            send(ws, { type: 'event', event: 'scene', payload: { scene, doublePressKeys } }),
        });

        session.deckId = deckId;
        send(ws, { type: 'response', id: parsed.id, ok: true, result: { deckId } });
        return true;
      }

      /*
       * A press with no deck behind it is an error, not a success.
       *
       * Answering "ok" and dropping it is how a page can look alive and do
       * nothing: the deck is released when its socket closes, and a client
       * that reconnected without attaching again would go on sending presses
       * into a deck that no longer exists. Saying so lets it rebuild.
       */
      case 'deckGesture': {
        if (!session.deckId) {
          send(ws, { type: 'response', id: parsed.id, ok: false, error: { message: DETACHED } });
          return true;
        }

        options.service.reportGesture(
          session.deckId,
          Number(params['key'] ?? -1),
          String(params['gesture'] ?? 'press'),
        );
        send(ws, { type: 'response', id: parsed.id, ok: true, result: { ok: true } });
        return true;
      }

      case 'deckPressed': {
        if (!session.deckId) {
          send(ws, { type: 'response', id: parsed.id, ok: false, error: { message: DETACHED } });
          return true;
        }

        options.service.reportPressed(
          session.deckId,
          Number(params['key'] ?? -1),
          params['pressed'] === true,
        );
        send(ws, { type: 'response', id: parsed.id, ok: true, result: { ok: true } });
        return true;
      }

      case 'getPageView':
      case 'getState':
        // Readable by a device so it can draw itself; everything else depends
        // on whether extensions are allowed.
        return false;

      case 'openAppFolder':
        /*
         * Never, not even with the extensions API on.
         *
         * This opens a window on the machine running the daemon, in front of
         * whoever is sitting at it. A tablet across the room has no business
         * doing that, and no reason to: it cannot see the result.
         */
        send(ws, {
          type: 'response',
          id: parsed.id,
          ok: false,
          error: { message: 'A device may not open folders on this machine' },
        });
        return true;

      case 'getPluginSettings':
      case 'savePluginSettings':
      case 'runPluginCommand':
        /*
         * Also never, for the same reason and a worse one.
         *
         * Saving settings writes the tokens a plugin signs in with, and a
         * command can open a browser window on the machine the daemon runs
         * on. Neither is anything a deck does, and the extensions API is for
         * driving a deck — not for configuring the accounts behind it.
         */
        send(ws, {
          type: 'response',
          id: parsed.id,
          ok: false,
          error: { message: `A device may not call '${parsed.method}'` },
        });
        return true;

      default: {
        /*
         * A deck needs none of the rest of the API, so a device gets it only
         * where the user has said other programs may drive this machine —
         * scripts, integrations, whatever they wrote themselves.
         */
        if ((await permissions()).extensionsApi) return false;

        send(ws, {
          type: 'response',
          id: parsed.id,
          ok: false,
          error: { message: `A device may not call '${parsed.method}'` },
        });
        return true;
      }
    }
  }

  const broadcast = (message: EventMessage) => {
    for (const ws of clients) send(ws, message);
  };

  const service = options.service;
  service.onDeckEvent('state', (state) => broadcast({ type: 'event', event: 'state', payload: state }));
  service.onDeckEvent('locationChanged', (event) =>
    broadcast({ type: 'event', event: 'locationChanged', payload: event }),
  );
  service.onDeckEvent('viewChanged', (event) =>
    broadcast({ type: 'event', event: 'viewChanged', payload: event }),
  );
  service.onDeckEvent('variablesChanged', (variables) =>
    broadcast({ type: 'event', event: 'variablesChanged', payload: { variables } }),
  );
  service.onDeckEvent('keyDown', (event) => broadcast({ type: 'event', event: 'keyDown', payload: event }));
  service.onDeckEvent('keyUp', (event) => broadcast({ type: 'event', event: 'keyUp', payload: event }));
  service.onDeckEvent('profilesChanged', () => broadcast({ type: 'event', event: 'profilesChanged' }));
  service.onDeckEvent('devicesChanged', () => broadcast({ type: 'event', event: 'devicesChanged' }));
  service.onDeckEvent('pluginStatusChanged', (event) =>
    // To everyone: a configurator on a second screen shows the same lamp, and
    // a deck ignores what it does not understand.
    broadcast({ type: 'event', event: 'pluginStatusChanged', payload: event }),
  );
  service.onDeckEvent('actionError', (message) =>
    broadcast({ type: 'event', event: 'actionError', payload: { message } }),
  );

  await listen(http, port, host);

  /*
   * The port actually bound, which is not always the one asked for: port 0
   * means "any free one", and reporting the request back would hand out an
   * address nothing is listening on.
   */
  const address = http.address();
  const bound = typeof address === 'object' && address ? address.port : port;

  return {
    url: `ws://${host}:${bound}`,
    token,
    port: bound,
    async close() {
      for (const ws of clients) ws.close();
      clients.clear();
      wss.close();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
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

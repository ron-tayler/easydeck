import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Serves the deck page from disk.
 *
 * The daemon has to host it itself, and not merely as a convenience: the API
 * only accepts connections whose origin is the daemon's own, so a page served
 * from anywhere else — a dev server, a file:// path — is turned away at the
 * handshake.
 *
 * What is served is the *deck*, never the configurator. Editing profiles,
 * reading the icon folder, launching programs: none of that belongs on a page
 * anyone on the network can open. The configurator lives in the desktop
 * window, which reaches the core over IPC and needs no port at all.
 */

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

export interface StaticFiles {
  /** Answers the request if it names something we serve; false if not ours. */
  serve(request: IncomingMessage, response: ServerResponse): Promise<boolean>;
}

export function serveDirectory(directory: string): StaticFiles {
  const root = resolve(directory);

  return {
    async serve(request, response) {
      if (request.method !== 'GET' && request.method !== 'HEAD') return false;

      const file = resolveWithin(root, request.url ?? '/');
      // Anything unrecognised falls back to the page itself: it is a single
      // document, and a reload on any of its routes must land on it rather
      // than on a 404.
      const target = (await isFile(file)) ? file : join(root, 'index.html');
      if (!(await isFile(target))) return false;

      response.writeHead(200, {
        'content-type': TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream',
        // The page is the daemon's own and has no business framing anyone, nor
        // being framed: this is a control surface for the machine it runs on.
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'SAMEORIGIN',
      });

      // The bundle decides what it is from the URL, so the page it serves is
      // always the deck: arriving at the root must not open the configurator.
      if (request.method === 'HEAD') {
        response.end();
        return true;
      }

      await new Promise<void>((done, fail) => {
        const stream = createReadStream(target);
        stream.on('error', fail);
        stream.on('end', () => done());
        stream.pipe(response);
      });

      return true;
    },
  };
}

/**
 * The file a URL names, provided it is inside the directory we serve.
 *
 * Normalised before it is joined, so `..` segments — however they are encoded
 * — cannot walk out of the root and read the rest of the disk.
 */
function resolveWithin(root: string, url: string): string {
  const path = decodeURIComponent(url.split('?')[0]?.split('#')[0] ?? '/');
  const target = resolve(join(root, normalize(path)));

  return target === root || target.startsWith(root + sep) ? target : join(root, 'index.html');
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

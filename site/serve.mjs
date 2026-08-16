import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The built site, served the way GitHub Pages serves it.
 *
 * Only for looking at what was built: a folder means its `index.html`, and
 * anything missing gets `404.html` with the right status. Build with
 * `SITE_BASE=/` first, or every link will point at a folder that is not there.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), 'dist');
const port = Number(process.env['PORT'] ?? 4173);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.json': 'application/json; charset=utf-8',
};

createServer(async (request, response) => {
  const path = decodeURIComponent((request.url ?? '/').split('?')[0]);
  // Normalised and checked, because this serves a folder to a browser and a
  // path with `..` in it is the oldest trick there is.
  let file = normalize(join(root, path));
  if (!file.startsWith(root)) {
    response.writeHead(403).end();
    return;
  }

  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
  } catch {
    file = join(root, '404.html');
    response.statusCode = 404;
  }

  try {
    await stat(file);
  } catch {
    response.writeHead(404).end('not found');
    return;
  }

  response.setHeader('content-type', TYPES[extname(file)] ?? 'application/octet-stream');
  createReadStream(file).pipe(response);
}).listen(port, () => console.log(`site: http://localhost:${port}`));

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const TOKEN_FILE = 'api-token';
const TOKEN_BYTES = 32;

/**
 * Reads the API token, creating one on first run.
 *
 * The API can save profiles, and a profile can launch programs — so an
 * unauthenticated local socket would be a remote code execution hole. It has
 * to be a real secret rather than a fixed string, because anything running on
 * the machine, including a web page, can reach 127.0.0.1.
 */
export async function loadOrCreateToken(directory: string): Promise<string> {
  const file = join(directory, TOKEN_FILE);

  try {
    const existing = (await readFile(file, 'utf8')).trim();
    if (existing.length >= 32) return existing;
  } catch {
    // Missing or unreadable: fall through and mint a new one.
  }

  const token = randomBytes(TOKEN_BYTES).toString('hex');
  await mkdir(directory, { recursive: true });
  await writeFile(file, `${token}\n`, 'utf8', );
  return token;
}

/** Constant-time comparison, so a wrong token cannot be guessed by timing. */
export function tokenMatches(expected: string, received: string | undefined): boolean {
  if (typeof received !== 'string') return false;

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(received, 'utf8');
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}

/**
 * Whether a browser Origin may talk to the daemon.
 *
 * Browsers do not apply CORS to WebSocket handshakes — only the Origin header
 * is sent — so any web page could otherwise open a socket to the daemon. A
 * missing Origin means a non-browser client (a script, a native app), which
 * the token alone gates.
 */
export function originAllowed(origin: string | undefined, port: number): boolean {
  if (origin === undefined || origin === 'null') return true;

  const allowed = [
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    `http://[::1]:${port}`,
  ];
  return allowed.includes(origin.toLowerCase());
}

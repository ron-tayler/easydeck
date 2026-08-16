import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { app } from 'electron';

import type { UpdateChannel } from './channel.js';

/**
 * Which builds this machine is offered, remembered between runs.
 *
 * Kept beside the application's own data rather than with the profiles: a
 * profile is meant to travel — exported, imported, carried to the second
 * machine that has no panel at all — and the update channel is a property of
 * this installation, not of the deck it drives.
 */
function file(): string {
  return join(app.getPath('userData'), 'updates.json');
}

export async function loadChannel(): Promise<UpdateChannel> {
  try {
    const raw: unknown = JSON.parse(await readFile(file(), 'utf8'));
    const channel = (raw as { channel?: unknown } | null)?.channel;
    return channel === 'prerelease' ? 'prerelease' : 'stable';
  } catch {
    // No file yet, or one somebody edited into nonsense. Stable is the answer
    // to both: it is what an installation that never chose should be on.
    return 'stable';
  }
}

export async function saveChannel(channel: UpdateChannel): Promise<void> {
  await writeFile(file(), `${JSON.stringify({ channel }, null, 2)}\n`, 'utf8');
}

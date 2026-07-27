import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { SettingsRepository } from '../application/ports/repositories.js';
import { DEFAULT_SETTINGS, normalizeSettings } from '../domain/settings.js';
import type { DaemonSettings } from '../domain/settings.js';
import { settingsFile } from './config-paths.js';
import { parseJsonText } from './read-json.js';

/** Settings as a single JSON document, hand-editable on purpose. */
export class FileSettingsRepository implements SettingsRepository {
  constructor(private readonly file: string = settingsFile()) {}

  get path(): string {
    return this.file;
  }

  async load(): Promise<DaemonSettings> {
    try {
      return normalizeSettings(parseJsonText(await readFile(this.file, 'utf8')));
    } catch {
      // Missing or corrupt settings are not worth refusing to start over:
      // defaults keep the deck usable, and the file is rewritten on save.
      return DEFAULT_SETTINGS;
    }
  }

  async save(settings: DaemonSettings): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });

    const temporary = `${this.file}.tmp`;
    await writeFile(temporary, `${JSON.stringify(normalizeSettings(settings), null, 2)}\n`, 'utf8');
    await rename(temporary, this.file);
  }
}

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Runs the desktop app from source, without packaging it.
 *
 * By default it uses the same folder a release would, so what you test is
 * what a user has. Set `EASYDECK_CONFIG_DIR` to work against a separate set —
 * profiles, icons, plugins and settings move together — and the program is
 * none the wiser: one environment variable, absent from a release, which is
 * why the same code needs no development branch.
 */

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, '..');

const configDir = process.env['EASYDECK_CONFIG_DIR'];

/*
 * `pnpm dev --trace` rather than an environment variable.
 *
 * Setting one differs between PowerShell, cmd and a shell, and getting it
 * wrong fails silently — the program starts, writes nothing, and looks like
 * the tracing is broken. A flag reads the same everywhere.
 */
const tracing = process.argv.includes('--trace');

if (!existsSync(join(app, 'dist', 'main.js'))) {
  console.error('Собери приложение сначала: pnpm --filter @easydeck/app build');
  process.exit(1);
}

console.log(configDir ? `Данные: ${configDir}` : 'Данные: как у собранной программы');
if (tracing) console.log('Трассировка панели включена');

const electron = spawn('electron', ['.'], {
  cwd: app,
  env: {
    ...process.env,
    ...(configDir ? { EASYDECK_CONFIG_DIR: configDir } : {}),
    ...(tracing ? { EASYDECK_TRACE: '1' } : {}),
  },
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

electron.on('exit', (code) => process.exit(code ?? 0));

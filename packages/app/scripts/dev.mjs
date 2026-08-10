import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Runs the desktop app against a working set of data next to the repository.
 *
 * A release keeps profiles, icons and plugins under `%APPDATA%\EasyDeck` (or
 * its equivalent), which is right for someone using the program and wrong for
 * someone building it: the files you are testing against end up far from the
 * code, and "open the icons folder" leads somewhere you never look.
 *
 * `EASYDECK_CONFIG_DIR` moves the whole set — profiles, icons, plugins,
 * settings — to `EasyDeck-data` beside the checkout. Nothing in the program
 * knows about this: it is one environment variable, set here and absent from
 * a release, which is why the same code needs no development branch.
 */

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, '..');
const repo = resolve(app, '..', '..');

const configDir = process.env['EASYDECK_CONFIG_DIR'] ?? resolve(repo, '..', 'EasyDeck-data');

if (!existsSync(join(app, 'dist', 'main.js'))) {
  console.error('Собери приложение сначала: pnpm --filter @easydeck/app build');
  process.exit(1);
}

console.log(`Данные: ${configDir}`);

const electron = spawn('electron', ['.'], {
  cwd: app,
  env: { ...process.env, EASYDECK_CONFIG_DIR: configDir },
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

electron.on('exit', (code) => process.exit(code ?? 0));

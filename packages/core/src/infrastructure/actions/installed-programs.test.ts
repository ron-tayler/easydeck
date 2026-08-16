import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { forgetProgramCache, listInstalledPrograms } from './installed-programs.js';

const roots: string[] = [];

after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true }).catch(() => undefined);
});

/** A Start menu on disk, laid out the way vendors actually lay one out. */
async function startMenu(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'easydeck-menu-'));
  roots.push(root);

  const write = async (...parts: string[]) => {
    const path = join(root, ...parts);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, '', 'utf8');
  };

  await write('Steam.lnk');
  await write('OBS Studio', 'OBS Studio (64-bit).lnk');
  await write('OBS Studio', 'Uninstall OBS Studio.lnk');
  await write('Blender', 'Blender.lnk');
  await write('Blender', 'Blender Website.lnk');
  await write('Startup', 'Something That Autostarts.lnk');
  await write('Accessories', 'Notepad.lnk');
  await write('readme.txt');

  // A Start menu is in the language Windows was installed in, and the first
  // machine this ran on was Russian: the English-only list left every one of
  // these sitting in the picker among the programs.
  await write('Lightshot', 'Lightshot.lnk');
  await write('Lightshot', 'Деинсталлировать Lightshot.lnk');
  await write('AIDA64', 'AIDA64.lnk');
  await write('AIDA64', 'Документация AIDA64 Extreme.lnk');
  await write('Firebird', 'Деинсталляция Firebird 2.5.2.lnk');
  await write('Автозагрузка', 'Что-то из автозагрузки.lnk');

  return root;
}

describe('the programs a key can be pointed at', () => {
  it('reads the Start menu and offers what a person would recognise', async () => {
    forgetProgramCache();
    const programs = await listInstalledPrograms([await startMenu()]);
    const names = programs.map((program) => program.label.en);

    assert.deepEqual(names, ['AIDA64', 'Blender', 'Lightshot', 'OBS Studio (64-bit)', 'Steam']);
    // The value is the shortcut, not a resolved .exe: the shortcut carries
    // the working folder and arguments the vendor decided their program needs.
    assert.match(programs[4]!.value, /Steam\.lnk$/);
  });

  it('leaves out the chores nobody puts on a key', async () => {
    forgetProgramCache();
    const programs = await listInstalledPrograms([await startMenu()]);
    const names = programs.map((program) => program.label.en).join(' ');

    assert.doesNotMatch(names, /Uninstall/);
    assert.doesNotMatch(names, /Website/);
    // Autostart entries and Windows' own accessories are not what somebody
    // means when they say "my programs".
    assert.doesNotMatch(names, /Autostarts/);
    assert.doesNotMatch(names, /Notepad/);
    // And a file that is not a shortcut is not a program.
    assert.doesNotMatch(names, /readme/);

    // The same rules in Russian, because a Start menu is in Windows' language.
    assert.doesNotMatch(names, /Деинсталл/);
    assert.doesNotMatch(names, /Документация/);
    assert.doesNotMatch(names, /автозагрузки/);
  });

  it('keeps one entry per name, the first root winning', async () => {
    forgetProgramCache();
    const mine = await startMenu();
    const everyones = await startMenu();

    const programs = await listInstalledPrograms([mine, everyones]);
    const steam = programs.filter((program) => program.label.en === 'Steam');

    assert.equal(steam.length, 1);
    // The user's own menu is scanned first, so their shortcut is the one kept.
    assert.ok(steam[0]!.value.startsWith(mine));
  });

  it('answers with nothing when there is no Start menu to read', async () => {
    forgetProgramCache();
    assert.deepEqual(await listInstalledPrograms(['/nowhere/at/all']), []);
  });
});

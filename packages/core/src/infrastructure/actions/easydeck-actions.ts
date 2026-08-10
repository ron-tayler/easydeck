import { mkdir } from 'node:fs/promises';

import type { ActionDefinition, ActionRegistry } from '@easydeck/engine';

import { configDir, iconsDir, pluginsDir, profilesDir } from '../config-paths.js';
import { openTarget } from './system-actions.js';

/**
 * Opening EasyDeck's own folders, contributed to the system plugin.
 *
 * They live with "run a program" and "open a link" because that is what they
 * are — the only difference is that the path is one the program knows and the
 * user should not have to.
 *
 * They exist because "open the folder my profiles are in" is something people
 * want constantly and should never have to answer with a path. A generic
 * open-a-folder action cannot know where those folders are.
 */
const folderActions: readonly ActionDefinition[] = [
  {
    type: 'system.open-config-folder',
    icon: 'folder-open',
    label: { en: 'Open config folder', ru: 'Открыть папку настроек' },
    group: { en: 'Folders', ru: 'Папки' },
  },
  {
    type: 'system.open-profiles-folder',
    icon: 'folder-open',
    label: { en: 'Open profiles folder', ru: 'Открыть папку профилей' },
    group: { en: 'Folders', ru: 'Папки' },
  },
  {
    type: 'system.open-plugins-folder',
    icon: 'folder-open',
    label: { en: 'Open plugins folder', ru: 'Открыть папку плагинов' },
    group: { en: 'Folders', ru: 'Папки' },
  },
  {
    type: 'system.open-icons-folder',
    icon: 'folder-open',
    label: { en: 'Open icons folder', ru: 'Открыть папку иконок' },
    group: { en: 'Folders', ru: 'Папки' },
  },
];

export function registerEasyDeckFolderActions(registry: ActionRegistry): ActionRegistry {
  const openDirectory = async (directory: string) => {
    // Created on demand: the plugins folder in particular may not exist yet,
    // and opening a missing folder is a confusing way to learn that.
    await mkdir(directory, { recursive: true });
    openTarget(directory);
  };

  return registry.extendPlugin('system', folderActions, {
    'system.open-config-folder': () => openDirectory(configDir()),
    'system.open-profiles-folder': () => openDirectory(profilesDir()),
    'system.open-plugins-folder': () => openDirectory(pluginsDir()),
    'system.open-icons-folder': () => openDirectory(iconsDir()),
  });
}

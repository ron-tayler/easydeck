import { mkdir } from 'node:fs/promises';

import { EASYDECK_PLUGIN_ID } from '@easydeck/engine';
import type { ActionDefinition, ActionRegistry } from '@easydeck/engine';

import { configDir, iconsDir, pluginsDir, profilesDir } from '../config-paths.js';
import { openTarget } from './system-actions.js';

/**
 * The parts of the EasyDeck plugin that need the filesystem.
 *
 * The rest of the plugin — navigation, variables, button state — is pure and
 * lives in the engine. These are contributed by the host instead, because
 * only the host knows where EasyDeck keeps its files.
 *
 * They exist because "open the folder my profiles are in" is something people
 * want constantly and should never have to answer with a path. A generic
 * open-a-folder action cannot know where those folders are.
 */
const folderActions: readonly ActionDefinition[] = [
  {
    type: 'easydeck.open-config-folder',
    icon: 'folder-open',
    label: { en: 'Open config folder', ru: 'Открыть папку настроек' },
    group: { en: 'Folders', ru: 'Папки' },
  },
  {
    type: 'easydeck.open-profiles-folder',
    icon: 'folder-open',
    label: { en: 'Open profiles folder', ru: 'Открыть папку профилей' },
    group: { en: 'Folders', ru: 'Папки' },
  },
  {
    type: 'easydeck.open-plugins-folder',
    icon: 'folder-open',
    label: { en: 'Open plugins folder', ru: 'Открыть папку плагинов' },
    group: { en: 'Folders', ru: 'Папки' },
  },
  {
    type: 'easydeck.open-icons-folder',
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

  return registry.extendPlugin(EASYDECK_PLUGIN_ID, folderActions, {
    'easydeck.open-config-folder': () => openDirectory(configDir()),
    'easydeck.open-profiles-folder': () => openDirectory(profilesDir()),
    'easydeck.open-plugins-folder': () => openDirectory(pluginsDir()),
    'easydeck.open-icons-folder': () => openDirectory(iconsDir()),
  });
}

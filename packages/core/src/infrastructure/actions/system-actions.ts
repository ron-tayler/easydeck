import { spawn } from 'node:child_process';
import { extname } from 'node:path';

import { PLUGIN_API_VERSION, numberParam, stringParam } from '@easydeck/engine';
import type { ActionRegistry, PluginManifest } from '@easydeck/engine';

import type { PluginRuntime } from '../../application/plugin-runtime.js';
import { listInstalledPrograms } from './installed-programs.js';

/**
 * Actions that reach outside the process.
 *
 * These live in the daemon rather than the engine so the logic zone stays
 * testable without mocking an operating system — and so that the blast
 * radius of "a profile can run programs" is one file.
 *
 * A word on trust: a profile that launches programs is the entire point of a
 * macro deck, so this is not a vulnerability in itself. It does mean a
 * profile is executable content — importing one from a stranger is as
 * consequential as running their script, and the configurator should say so.
 * Commands are spawned without a shell, so at least a parameter cannot smuggle
 * in extra commands of its own.
 */

const DEFAULT_HTTP_TIMEOUT_MS = 10_000;

/**
 * There used to be a whitelist here — http, https, mailto, file — and it is a
 * blacklist now, which is the opposite trade and the right one.
 *
 * Half of what anybody puts on a launcher key is `steam://rungameid/…` or
 * `com.epicgames.launcher://…`, and a whitelist of schemes is a list of the
 * launchers somebody happened to have installed the day it was written: every
 * new one is a bug report. Turned around, the list is short, stable and about
 * something real — these are not protocols any launcher uses, they are ways of
 * saying "run this code", and a key that wants to run code has
 * `system.run-program` two lines up in the same manifest.
 */
const REFUSED_SCHEMES = new Set(['javascript:', 'data:', 'vbscript:']);

/**
 * The shape of a scheme, which is checked as well as the name.
 *
 * Keeps what reaches the shell a URL rather than a sentence — and it is the
 * *shape* that is enforced rather than membership of a list, so a launcher
 * nobody here has heard of works on the day it is installed.
 */
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:$/i;

/** What a shortcut is, to the two places that must not `spawn` one. */
const SHELL_HANDLED = new Set(['.lnk', '.url']);

export const systemManifest: PluginManifest = {
  id: 'system',
  name: { en: 'System', ru: 'Система' },
  description: {
    en: 'Programs, files and links, the keyboard, and waiting',
    ru: 'Программы, файлы и ссылки, клавиатура и паузы',
  },
  version: '1.0.0',
  apiVersion: PLUGIN_API_VERSION,
  builtIn: true,
  actions: [
    {
      type: 'system.run-program',
      icon: 'app',
      label: { en: 'Run program', ru: 'Запустить программу' },
      params: [
        {
          name: 'command',
          type: 'file',
          label: { en: 'Program', ru: 'Программа' },
          // The Start menu, offered by name. The field stays a field: a path
          // to any executable may still be typed or pasted into it.
          optionsFrom: 'programs',
          description: {
            en: 'Pick an installed program, or give a path to any executable',
            ru: 'Выберите установленную программу или укажите путь к любому исполняемому файлу',
          },
        },
        {
          name: 'args',
          type: 'text',
          label: { en: 'Arguments', ru: 'Аргументы' },
          placeholder: { en: 'One per line', ru: 'По одному в строке' },
          required: false,
        },
        {
          name: 'cwd',
          type: 'directory',
          label: { en: 'Working folder', ru: 'Рабочая папка' },
          required: false,
        },
      ],
    },
    {
      type: 'system.open',
      icon: 'link',
      label: { en: 'Open file, folder or link', ru: 'Открыть файл, папку или ссылку' },
      params: [
        {
          name: 'target',
          type: 'string',
          label: { en: 'Target', ru: 'Что открыть' },
          placeholder: { en: 'https://…, steam://…, or a path', ru: 'https://…, steam://… или путь' },
          description: {
            en: 'Any link Windows knows how to open, launcher deep links included',
            ru: 'Любая ссылка, которую умеет открывать Windows, включая ссылки лаунчеров',
          },
        },
      ],
    },
  ],
};

export const httpManifest: PluginManifest = {
  id: 'http',
  name: { en: 'HTTP', ru: 'HTTP' },
  description: {
    en: 'Calls web endpoints and webhooks',
    ru: 'Запросы к веб-адресам и вебхукам',
  },
  version: '1.0.0',
  apiVersion: PLUGIN_API_VERSION,
  builtIn: true,
  actions: [
    {
      type: 'http.request',
      icon: 'globe',
      label: { en: 'HTTP request', ru: 'HTTP-запрос' },
      params: [
        { name: 'url', type: 'string', label: { en: 'URL', ru: 'Адрес' } },
        {
          name: 'method',
          type: 'select',
          label: { en: 'Method', ru: 'Метод' },
          required: false,
          default: 'GET',
          options: [
            { value: 'GET', label: { en: 'GET' } },
            { value: 'POST', label: { en: 'POST' } },
            { value: 'PUT', label: { en: 'PUT' } },
            { value: 'PATCH', label: { en: 'PATCH' } },
            { value: 'DELETE', label: { en: 'DELETE' } },
          ],
        },
        { name: 'body', type: 'text', label: { en: 'Body', ru: 'Тело' }, required: false },
        {
          name: 'timeoutMs',
          type: 'number',
          label: { en: 'Timeout, ms', ru: 'Таймаут, мс' },
          required: false,
          default: DEFAULT_HTTP_TIMEOUT_MS,
          min: 100,
        },
      ],
    },
  ],
};

/*
 * Waiting used to live here, as `system.delay`.
 *
 * It is `core.delay` now, and part of a script rather than an action: every
 * script wants it, it is punctuation between steps rather than an errand, and
 * a machine where the system plugin failed to load should still be able to
 * put a pause between two presses. Profiles are migrated at version 6.
 */

export function registerSystemActions(registry: ActionRegistry): ActionRegistry {
  registry.installPlugin(systemManifest, {
    'system.run-program': (params) => {
      const command = stringParam(params, 'command');
      const args = toStringArray(params['args']);
      const cwd = typeof params['cwd'] === 'string' && params['cwd'].length > 0 ? params['cwd'] : undefined;

      /*
       * A shortcut is not a program, and `spawn` cannot start one.
       *
       * The list of installed programs offers `.lnk` files because that is
       * what the Start menu is made of — and because the shortcut carries the
       * working folder and the arguments the vendor decided their program
       * needs. Handing it to the shell honours all of that; spawning it fails
       * with a message about a bad executable format.
       */
      if (SHELL_HANDLED.has(extname(command).toLowerCase())) {
        openTarget(command, cwd, args);
        return;
      }

      // Detached and unref'd: the deck must not hold the program open, nor die
      // with it. shell:false keeps parameters from being reinterpreted.
      const child = spawn(command, args, { cwd, detached: true, stdio: 'ignore', shell: false });
      child.unref();
    },

    'system.open': (params) => {
      const target = stringParam(params, 'target');
      assertOpenable(target);
      openTarget(target);
    },
  });

  registry.installPlugin(httpManifest, {
    'http.request': async (params) => {
      const url = stringParam(params, 'url');
      assertHttp(url);

      const method = typeof params['method'] === 'string' ? params['method'].toUpperCase() : 'GET';
      const headers = toStringRecord(params['headers']);
      const body = typeof params['body'] === 'string' ? params['body'] : undefined;
      const timeout = numberParam(params, 'timeoutMs', DEFAULT_HTTP_TIMEOUT_MS);

      const response = await fetch(url, {
        method,
        headers,
        body: method === 'GET' || method === 'HEAD' ? undefined : body,
        signal: AbortSignal.timeout(timeout),
      });

      // Surfaced as a failed action so the host logs it instead of failing
      // silently — a webhook that quietly 500s is worse than a noisy one.
      if (!response.ok) {
        throw new Error(`${method} ${url} responded ${response.status} ${response.statusText}`);
      }
    },
  });

  return registry;
}

/**
 * Gives the system plugin a life, which it needs for exactly one thing.
 *
 * Its actions are registered without a runtime — they hold nothing open and
 * never did. But "which programs are installed" is a list that only exists at
 * run time, and `optionsFrom` is answered by the runtime, so the plugin has
 * to be known to it. There is no `stop`: nothing was started.
 *
 * Called separately from `registerSystemActions` because the runtime does not
 * exist yet when the actions are registered.
 */
export async function registerSystemPlugin(runtime: PluginRuntime): Promise<void> {
  await runtime.install(systemManifest, {
    start(host) {
      host.provideOptions('programs', async () => listInstalledPrograms());
      // Nothing to connect to, and a plugin that says nothing shows a lamp
      // that means nothing. Ready is the truth: its actions work.
      host.setStatus('ready');
    },
  });
}

/** Hands a URL or path to whatever the platform uses to open it. */
export function openTarget(target: string, cwd?: string, args: readonly string[] = []): void {
  const [command, spawnArgs] = openCommand(target, parseScheme(target) !== undefined, args);
  const child = spawn(command, spawnArgs, { cwd, detached: true, stdio: 'ignore', shell: false });
  child.unref();
}

export function assertOpenable(target: string): void {
  if (target.trim().length === 0) throw new Error("Parameter 'target' is empty");

  const scheme = parseScheme(target);
  if (scheme === undefined) return; // a filesystem path

  if (REFUSED_SCHEMES.has(scheme.toLowerCase())) {
    throw new Error(`Refusing to open '${scheme}' targets`);
  }

  // Anything else that is shaped like a scheme goes through. One nothing is
  // registered for is Windows' to complain about, and it names the scheme —
  // a better message than any list here could produce.
  if (!URL_SCHEME.test(scheme)) throw new Error(`'${target}' is not a link this can open`);
}

function assertHttp(url: string): void {
  const scheme = parseScheme(url);
  if (scheme !== 'http:' && scheme !== 'https:') {
    throw new Error(`'url' must be http or https, got '${url}'`);
  }
}

/** A Windows drive path, which the URL parser mistakes for a scheme. */
const WINDOWS_PATH = /^[A-Za-z]:[\\/]/;
/** A UNC share, likewise not a URL. */
const UNC_PATH = /^\\\\/;

/**
 * The URL scheme of a target, or undefined when it is a filesystem path.
 *
 * The filesystem cases are checked first and deliberately: `new URL()` parses
 * `C:\Users\me` as the scheme `c:`, so a naive scheme check rejects every
 * absolute Windows path — a whitelist meant to block dangerous schemes ends up
 * blocking the most ordinary target there is.
 */
export function parseScheme(value: string): string | undefined {
  if (WINDOWS_PATH.test(value) || UNC_PATH.test(value)) return undefined;

  try {
    return new URL(value).protocol;
  } catch {
    return undefined; // a relative or POSIX path
  }
}

/**
 * The platform's "open this with whatever handles it" incantation.
 *
 * Windows needs two of them, and which two has been wrong twice.
 *
 * URLs went through `cmd /c start` first, and cmd parses what it is handed
 * however it was quoted. A launcher deep link is full of the characters cmd
 * reserves, and `&` is the one that matters:
 *
 * ```
 * com.epicgames.launcher://apps/x?action=launch&silent=true
 * ```
 *
 * reaches `start` as `…?action=launch`, and `silent=true` is run as a second
 * command — measured, not feared.
 *
 * Everything then went to `explorer.exe`, which was right for the ampersand
 * and wrong for links: it opens files and folders reliably and quietly
 * declines URLs, which is how a plugin's sign-in stopped opening a browser.
 *
 * So: `rundll32 url.dll,FileProtocolHandler` for links, which is the
 * documented way to hand a URL to whatever handles it, and `explorer.exe`
 * for paths, which is what it is good at. Neither involves a shell, so
 * nothing reinterprets an argument on the way.
 *
 * Arguments are only for a shortcut being launched as a program; a link has
 * its own inside it.
 */
export function openCommand(
  target: string,
  isUrl: boolean,
  args: readonly string[] = [],
): [string, string[]] {
  if (process.platform === 'win32') {
    return isUrl
      ? ['rundll32.exe', ['url.dll,FileProtocolHandler', target]]
      : ['explorer.exe', [target, ...args]];
  }

  if (process.platform === 'darwin') {
    return args.length > 0 ? ['open', [target, '--args', ...args]] : ['open', [target]];
  }
  return ['xdg-open', [target]];
}

function toStringArray(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError("Parameter 'args' must be an array of strings");
  return value.map((item) => String(item));
}

function toStringRecord(value: unknown): Record<string, string> {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object') throw new TypeError("Parameter 'headers' must be an object");
  return Object.fromEntries(Object.entries(value as object).map(([k, v]) => [k, String(v)]));
}

import { spawn } from 'node:child_process';

import { PLUGIN_API_VERSION, numberParam, stringParam } from '@easydeck/engine';
import type { ActionRegistry, PluginManifest } from '@easydeck/engine';

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

const OPENABLE_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'file:']);
const DEFAULT_HTTP_TIMEOUT_MS = 10_000;

export const systemManifest: PluginManifest = {
  id: 'system',
  name: { en: 'System', ru: 'Система' },
  description: {
    en: 'Launches programs and opens files, folders and links',
    ru: 'Запуск программ и открытие файлов, папок и ссылок',
  },
  version: '1.0.0',
  apiVersion: PLUGIN_API_VERSION,
  builtIn: true,
  actions: [
    {
      type: 'system.run-program',
      label: { en: 'Run program', ru: 'Запустить программу' },
      params: [
        { name: 'command', type: 'file', label: { en: 'Program', ru: 'Программа' } },
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
      label: { en: 'Open file, folder or link', ru: 'Открыть файл, папку или ссылку' },
      params: [
        {
          name: 'target',
          type: 'string',
          label: { en: 'Target', ru: 'Что открыть' },
          placeholder: { en: 'https://… or a path', ru: 'https://… или путь' },
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

export const easydeckTimingActions = [
  {
    type: 'easydeck.delay',
    label: { en: 'Wait', ru: 'Подождать' },
    description: {
      en: 'Pauses before the next action of the same button',
      ru: 'Пауза перед следующим действием той же кнопки',
    },
    group: { en: 'Flow', ru: 'Поток' },
    params: [
      {
        name: 'ms',
        type: 'number' as const,
        label: { en: 'Milliseconds', ru: 'Миллисекунды' },
        default: 100,
        min: 0,
      },
    ],
  },
];

export function registerSystemActions(registry: ActionRegistry): ActionRegistry {
  registry.installPlugin(systemManifest, {
    'system.run-program': (params) => {
      const command = stringParam(params, 'command');
      const args = toStringArray(params['args']);
      const cwd = typeof params['cwd'] === 'string' && params['cwd'].length > 0 ? params['cwd'] : undefined;

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

  registry.extendPlugin('easydeck', easydeckTimingActions, {
    'easydeck.delay': async (params) => {
      const ms = numberParam(params, 'ms', 100);
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
    },
  });

  return registry;
}

/** Hands a URL or path to whatever the platform uses to open it. */
export function openTarget(target: string): void {
  const [command, args] = openCommand(target, parseScheme(target) !== undefined);
  const child = spawn(command, args, { detached: true, stdio: 'ignore', shell: false });
  child.unref();
}

export function assertOpenable(target: string): void {
  if (target.trim().length === 0) throw new Error("Parameter 'target' is empty");

  const scheme = parseScheme(target);
  if (scheme && !OPENABLE_SCHEMES.has(scheme)) {
    throw new Error(`Refusing to open '${scheme}' targets`);
  }
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
 * Windows needs two of them. `start` is a cmd built-in whose parsing depends
 * on quoting — its first quoted argument is the window title, and a bare
 * filesystem path reaches the shell handler in a form it reports as an
 * inaccessible *file*. `explorer.exe` opens files and folders reliably, so
 * paths go there and `start` is left to do what it is good at: URLs.
 */
export function openCommand(target: string, isUrl: boolean): [string, string[]] {
  if (process.platform === 'win32') {
    if (!isUrl) return ['explorer.exe', [target]];
    // The empty string is `start`'s title argument; without it a quoted
    // target would be taken as the window title instead of the thing to open.
    return ['cmd', ['/c', 'start', '', target]];
  }

  if (process.platform === 'darwin') return ['open', [target]];
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

# Плагин за десять минут

Плагин — это один файл `main.mjs` и описание рядом с ним. Он выполняется внутри
процесса программы, получает от неё объект хоста и через него делает всё
остальное: публикует переменные, регистрирует обработчики действий, рисует
картинки.

> Контракт плагинов ещё меняется. Пока идёт ранняя разработка, ломающие
> изменения — это нормально: у манифеста есть номер версии API, и программа
> откажется грузить плагин, собранный под другую, с внятным объяснением вместо
> непонятной ошибки при нажатии клавиши.

## Самый маленький плагин

```ts
import { PLUGIN_API_VERSION, definePlugin } from '@easydeck/plugin-sdk';
import type { Plugin, PluginHost } from '@easydeck/plugin-sdk';

class HelloPlugin implements Plugin {
  private host?: PluginHost;

  start(host: PluginHost): void {
    this.host = host;
    host.setStatus('ready');
    host.setVariable('demo.greeting', 'Привет');
  }

  stop(): void {
    this.host = undefined;
  }
}

export default definePlugin({
  manifest: {
    id: 'demo.hello',
    name: { en: 'Hello', ru: 'Привет' },
    author: { en: 'Somebody' },
    description: { en: 'The smallest plugin there is', ru: 'Самый маленький плагин' },
    version: '1.0.0',
    apiVersion: PLUGIN_API_VERSION,

    variables: [
      { name: 'demo.greeting', type: 'string', label: { en: 'Greeting', ru: 'Приветствие' } },
    ],

    actions: [
      {
        type: 'demo.hello.shout',
        label: { en: 'Shout', ru: 'Крикнуть' },
        params: [{ name: 'what', type: 'string', label: { en: 'What', ru: 'Что' } }],
      },
    ],
  },

  activate: () => {
    const plugin = new HelloPlugin();
    return {
      plugin,
      handlers: {
        'demo.hello.shout': async (params) => {
          console.log(String(params['what'] ?? '').toUpperCase());
        },
      },
    };
  },
});
```

## Идентификаторы

Идентификатор плагина — `<автор>.<имя>`: `ed.obs`, `ed.discord`. Автор в
идентификаторе нужен, чтобы два человека могли назвать плагин одинаково и не
столкнуться.

Всё, что плагин объявляет, начинается с его идентификатора:

- действия — `ed.discord.mute`;
- переменные — `ed.discord.muted`;
- поверхности — `ed.discord.speakers`.

Это не косметика. Программа считает переменную принадлежащей плагину по
префиксу, и переменная, названная иначе, не дойдёт до `onWatched` — плагин
никогда не узнает, что её кто-то читает.

## Из чего состоит проект

```
my-plugin/
  package.json      зависимость от @easydeck/plugin-sdk
  tsconfig.json
  src/
    index.ts        default export — definePlugin({ manifest, activate })
  assets/
    logo.webp       обложка для магазина
```

Сборка превращает это в `main.mjs` рядом с `plugin.json`, а затем в архив
`<id>.easydeck` — см. [Сборка и публикация](../publishing/).

## Правила, которые стоит знать заранее

**Никакого нативного кода, который нужно собирать.** Плагин ставится как файл, а
не как проект: `node-gyp` на машине пользователя не запустится. Загрузить
готовую библиотеку — можно.

**Секреты остаются на машине.** Поле настройки, помеченное секретным, хранится
отдельно и не попадает в экспортированный профиль.

**Плагин не приносит интерфейса.** Свои настройки он описывает данными, а рисует
их программа — тем же кодом, что рисует параметры действия. Поэтому плагин
одинаково выглядит в окне на компьютере и в браузере на планшете.

Дальше: [Манифест](../manifest/) — что можно объявить, и
[Что даёт хост](../host/) — что можно делать во время работы.

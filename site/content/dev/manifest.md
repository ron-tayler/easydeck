# Манифест

Манифест — это всё, что плагин рассказывает о себе до того, как что-либо
сделает. Программа строит по нему список действий, формы параметров, окно
настроек и палитру готовых клавиш.

```ts
{
  id: 'ed.discord',
  name: { en: 'Discord', ru: 'Discord' },
  author: { en: 'EasyDeck', ru: 'EasyDeck' },
  description: { en: '…', ru: '…' },
  version: '1.3.0',
  apiVersion: PLUGIN_API_VERSION,
  cover: 'plugin:ed.discord/assets/logo.webp',

  settings: [ … ],
  commands: [ … ],
  variables: [ … ],
  actions: [ … ],
  surfaces: [ … ],
  presets: [ … ],
}
```

Тексты — объекты с обязательным `en` и любыми другими языками. Английский
обязателен, чтобы плагин, ничего не знавший о русском, всё равно работал.

## Параметры

`settings` и параметры действия описываются одним и тем же типом, поэтому
конфигуратор рисует их одним и тем же кодом. Типы: `string`, `number`,
`boolean`, `select`, `color`, `text`, `list`, `file`, `directory`, `hotkey`,
`password` и другие.

Полезные поля:

- `secret: true` — хранить отдельно и не показывать;
- `internal: true` — не показывать в настройках вовсе (для токена, который
  плагин записывает себе сам);
- `default`, `min`, `max`, `required`;
- `optionsFrom: 'channels'` — список приходит из работающей программы, см.
  `provideOptions`;
- `emptyNote` — что написать, когда список пуст: «OBS не запущен, поэтому список
  сцен взять неоткуда» лучше, чем пустое поле;
- `dependsOn` — этот список зависит от другого параметра и перечитывается,
  когда тот меняется.

## Переменные

```ts
variables: [
  { name: 'ed.discord.muted', type: 'boolean', label: { … }, initial: false },
  {
    name: 'ed.discord.members',
    type: 'number',
    label: { … },
    initial: 0,
    argument: {
      label: { en: 'Channel', ru: 'Канал' },
      description: { en: 'Leave empty for the channel you are in', ru: '…' },
      optionsFrom: 'channels',
    },
  },
]
```

Переменная с `argument` — это **семейство**: у неё столько значений, сколько
объектов у пользователя в другой программе. Значение пишется через
`setFamily(name, argument, value)`, а пустой аргумент даёт короткое имя без
скобок — обычно это «тот, который сейчас».

Семейство обязано публиковаться по подписке: слушайте `onWatched` и отвечайте
только на то, что кто-то читает.

## Действия

```ts
actions: [
  {
    type: 'ed.discord.mute',
    icon: 'mute',
    label: { en: 'Microphone', ru: 'Микрофон' },
    description: { … },
    params: [ … ],
  },
]
```

Обработчик регистрируется отдельно, в `activate`, по тому же имени.

Иконка берётся из встроенного набора имён: `home`, `folder`, `page`, `variable`,
`toggle`, `clock`, `text`, `keyboard`, `mute`, `speaker`, `record`, `app`,
`link`, `globe` и ещё несколько. Имя не из набора тихо заменяется на запасное.

## Поверхности

Живая картинка объявляется как действие — с типом, названием, иконкой и
параметрами, потому что каждую из них нужно настраивать:

```ts
surfaces: [
  {
    type: 'ed.discord.speakers',
    label: { en: 'Who is talking', ru: 'Кто говорит' },
    description: { … },
    icon: 'speaker',
    params: [ … ],
  },
]
```

Рисование — в `provideSurface`, см. [Что даёт хост](../host/#живые-картинки).

## Команды

Кнопки внизу окна настроек: «Авторизовать», «Переподключиться», «Найти
колонки».

```ts
commands: [
  { name: 'authorise', label: { en: 'Authorise', ru: 'Авторизовать' }, icon: 'link' },
  { name: 'reset', label: { … }, confirm: { en: 'Forget every speaker?', ru: '…' } },
]
```

Команда с `confirm` сначала спрашивает. Реализация — в `activate`, в поле
`commands`.

## Готовые клавиши

Пресет — это клавиша целиком: оформление, состояния и макрос. Пользователь
перетаскивает её на сетку и получает работающую клавишу без настройки.

```ts
presets: [
  {
    name: 'mute',
    label: { en: 'Microphone', ru: 'Микрофон' },
    button: {
      stateFrom: 'ed.discord.muted',
      states: [
        {
          id: 'live',
          when: false,
          visual: { background: '#2f6f4f', label: { text: 'Микрофон', fontSize: 13, position: 'center' } },
          actions: { press: [{ type: 'ed.discord.mute', params: { mode: 'toggle' } }] },
        },
        {
          id: 'muted',
          when: true,
          visual: { background: '#6f3535', label: { text: 'Выключен', fontSize: 13, position: 'center' } },
          actions: { press: [{ type: 'ed.discord.mute', params: { mode: 'toggle' } }] },
        },
      ],
    },
  },
]
```

Картинка в пресете указывается как `plugin:<id>/<путь>` — файл берётся из папки
самого плагина.

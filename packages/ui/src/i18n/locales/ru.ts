export default {
  app: {
    title: 'EasyDeck',
  },
  status: {
    connecting: 'Подключение…',
    device: 'Устройство',
    profile: 'Профиль',
    noDeck: 'Дека не запущена',
    transportIpc: 'внутри приложения',
    transportWebsocket: 'через WebSocket',
  },
  folders: {
    title: 'Папки',
    none: 'Профиль не загружен',
  },
  deck: {
    title: 'Панель',
    hint: 'Щёлкните по клавише, чтобы выполнить её так же, как нажатие на устройстве.',
    pages: 'Страницы',
    editHint: 'Перетащите действие на клавишу, клавиши меняются местами перетаскиванием. Выделенную клавишу можно копировать, вставлять и удалять. Двойной щелчок выполняет её.',
  },
  plugins: {
    title: 'Действия',
    search: 'Поиск действий',
    builtIn: 'встроенный',
    nothing: 'Ничего не найдено',
  },
  profiles: {
    title: 'Профили',
    activate: 'Включить',
    active: 'Активный',
    none: 'Профилей пока нет',
  },
  variables: {
    title: 'Переменные',
    none: 'Переменных нет',
  },
  errors: {
    title: 'Что-то пошло не так',
    dismiss: 'Скрыть',
  },
  settings: {
    open: 'Настройки',
    close: 'Закрыть',
    soon: 'пока нет',
    system: {
      title: 'Система',
      language: 'Язык',
      theme: 'Тема',
      autostart: 'Запускать вместе с системой',
      languages: { en: 'English', ru: 'Русский' },
      themes: { system: 'Как в системе', light: 'Светлая', dark: 'Тёмная' },
    },
    plugins: {
      title: 'Плагины',
      summary: 'Доступно действий: {count}',
      openFolder: 'Открыть папку плагинов',
    },
    core: {
      title: 'Ядро',
      explanation:
        'EasyDeck отдаёт тот же протокол по локальному WebSocket, так что декой могут управлять сторонние инструменты и плагины.',
      transport: 'Это окно работает',
      protocol: 'Версия протокола',
    },
    deck: {
      title: 'Дека',
      layout: 'Раскладка',
      keySize: 'Кадр клавиши',
      brightness: 'Яркость',
    },
    about: {
      title: 'О программе',
      text: 'EasyDeck — открытое ПО для FIFINE AmpliGame D6 и других устройств семейства Stream Dock.',
      openConfig: 'Открыть папку настроек',
    },
  },
};

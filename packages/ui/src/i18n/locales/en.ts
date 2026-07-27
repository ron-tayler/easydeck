export default {
  app: {
    title: 'EasyDeck',
  },
  status: {
    connecting: 'Connecting…',
    device: 'Device',
    profile: 'Profile',
    noDeck: 'No deck is running',
    transportIpc: 'in-app',
    transportWebsocket: 'over WebSocket',
  },
  folders: {
    title: 'Folders',
    none: 'No profile loaded',
  },
  deck: {
    title: 'Panel',
    hint: 'Click a key to run it, exactly as pressing it on the device would.',
    pages: 'Pages',
    editHint: 'Drag an action onto a key, drag keys to swap them. Select a key to copy, paste or delete it. Double-click runs it.',
  },
  plugins: {
    title: 'Actions',
    search: 'Search actions',
    builtIn: 'built in',
    nothing: 'Nothing matches',
  },
  profiles: {
    title: 'Profiles',
    activate: 'Activate',
    active: 'Active',
    none: 'No profiles yet',
  },
  variables: {
    title: 'Variables',
    none: 'No variables',
  },
  errors: {
    title: 'Something went wrong',
    dismiss: 'Dismiss',
  },
  settings: {
    open: 'Settings',
    close: 'Close',
    soon: 'not yet',
    system: {
      title: 'System',
      language: 'Language',
      theme: 'Theme',
      autostart: 'Start with the system',
      languages: { en: 'English', ru: 'Русский' },
      themes: { system: 'Follow the system', light: 'Light', dark: 'Dark' },
    },
    plugins: {
      title: 'Plugins',
      summary: '{count} actions available',
      openFolder: 'Open plugins folder',
    },
    core: {
      title: 'Core',
      explanation:
        'EasyDeck serves the same protocol over a local WebSocket, so external tools and plugins can drive the deck.',
      transport: 'This window uses',
      protocol: 'Protocol version',
    },
    deck: {
      title: 'Deck',
      layout: 'Layout',
      keySize: 'Key image',
      brightness: 'Brightness',
    },
    about: {
      title: 'About',
      text: 'EasyDeck — open control software for the FIFINE AmpliGame D6 and other Stream Dock devices.',
      openConfig: 'Open config folder',
    },
  },
};

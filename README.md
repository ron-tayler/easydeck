# EasyDeck

Cross-platform (Windows / Linux / macOS), community-driven control software for the
**FIFINE AmpliGame D6** stream controller and other Stream Dock family devices
(Mirabox 293, Ajazz AKP153 and friends).

Why: the vendor software is Windows-only and limited to simple triggers. EasyDeck
aims for Macro Deck / Companion-level logic — profiles, pages, multi-state buttons,
reactive variables — on top of a clean, driver-free HID stack (`node-hid`, no
Zadig/WinUSB required).

## Status

Early development. The device and renderer zones work on real hardware: EasyDeck
drives a FIFINE D6 on Windows with no Zadig/WinUSB, rendering labeled buttons and
reacting to key presses. Next up is the engine zone.

See [docs/d6-protocol.md](docs/d6-protocol.md) for the reverse-engineered wire
protocol, verified against a USB capture of the vendor software — including the
key frame format (**112x112 at 4:2:0**, not the 100x100 every other driver
assumes) and a command the other drivers do not document.

## Packages

| Package | Zone |
|---|---|
| [`@easydeck/device`](packages/device) | HID transport + Stream Dock v1 protocol driver, device discovery |
| [`@easydeck/engine`](packages/engine) | Profiles, pages, button states, variables, actions (pure logic) |
| [`@easydeck/renderer`](packages/renderer) | Button visual state → device-ready JPEG |
| [`@easydeck/core`](packages/core) | Wiring, profile storage, machine-facing actions, the API |
| [`@easydeck/app`](packages/app) | Desktop app: Electron main process, tray, window, packaging |
| [`@easydeck/ui`](packages/ui) | Vue configurator, in the app window or a browser |
| [`@easydeck/plugin-sdk`](packages/plugin-sdk) | Out-of-process plugin authoring kit |

EasyDeck ships as a desktop app that lives in the tray: closing the window keeps
the deck running, and quitting is done from the tray menu. The core runs inside
Electron's main process
and talks to the window over IPC. The same protocol is also served over a
WebSocket, so external tools and plugins can drive the deck — one protocol,
two transports.

Each package is a self-contained zone with a DDD-flavoured layout
(`domain` / `application` / `infrastructure`); dependencies always point inward.

## Quick start

```bash
pnpm install
pnpm build
pnpm test

# design button visuals with no hardware attached -> docs/panel-preview.png
pnpm --filter @easydeck/renderer preview

# with a D6 plugged in (close the FIFINE software first — both can hold the
# device at once, and then they fight over the panel):
pnpm --filter @easydeck/core start         # headless: profiles from disk, no window
pnpm --filter @easydeck/device poc         # raw device zone: colors + key events
pnpm --filter @easydeck/renderer demo      # rendered buttons with labels and icons
pnpm --filter @easydeck/device key-monitor # what the firmware thinks is pressed
pnpm --filter @easydeck/renderer alignment # check a model's frame geometry
```

On first run EasyDeck writes a starter profile to the platform's config
directory (`%APPDATA%\EasyDeck` on Windows, `~/Library/Application Support/EasyDeck`
on macOS, `~/.config/easydeck` on Linux; override with `EASYDECK_CONFIG_DIR`).
Edit the JSON and restart to see changes — live reload comes with the API.

**Profiles are executable content.** A profile can launch programs, so importing
one from someone else is as consequential as running their script.

## Known issues

- **Keyboard emulation does not work yet.** The `hotkey` and `type-text` actions
  load their native backend, resolve key codes and run without error, but the
  keystrokes do not reach the target application on Windows. Timing has been
  ruled out; UI privilege isolation (a target running elevated while EasyDeck
  is not) is the next thing to check. Everything else works, and
  the starter profile avoids these two actions on purpose. Verify with
  `pnpm --filter @easydeck/core keyboard-check`, which exercises the backend
  with no deck involved.
- **Chords are impossible on the D6.** Its firmware tracks one pressed key at a
  time; see [docs/d6-protocol.md](docs/d6-protocol.md).

## Acknowledgements

Protocol knowledge builds on the work of
[mirajazz](https://github.com/4ndv/mirajazz),
[opendeck-ampgd6](https://github.com/ciscosweater/opendeck-ampgd6),
[companion-surface-mirabox-stream-dock](https://github.com/bitfocus/companion-surface-mirabox-stream-dock) and
[mirabox-streamdock-node](https://github.com/rigor789/mirabox-streamdock-node).

## License

MIT

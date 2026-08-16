# EasyDeck

[![CI](https://github.com/ron-tayler/easydeck/actions/workflows/ci.yml/badge.svg)](https://github.com/ron-tayler/easydeck/actions/workflows/ci.yml)
[![Pages](https://github.com/ron-tayler/easydeck/actions/workflows/pages.yml/badge.svg)](https://ron-tayler.github.io/easydeck/)

Free, cross-platform control software for macro panels — the little boxes of
screens that sit beside a keyboard and switch a scene, mute a microphone and
launch whatever else. No account, no cloud, and no vendor application.

**[Site and documentation](https://ron-tayler.github.io/easydeck/)** ·
**[Download](https://github.com/ron-tayler/easydeck/releases)** ·
**[Plugins](https://github.com/ron-tayler/easydeck-plugins)**

Why it exists: the vendor software is Windows-only and stops at simple triggers.
EasyDeck aims at Macro Deck / Companion-level logic — profiles, pages,
multi-state buttons, reactive variables, live pictures drawn by plugins — on a
driver-free HID stack (`node-hid`, no Zadig or WinUSB).

## Status

**Early development, and the first release candidate is out.** The deck runs,
the configurator edits it, plugins install from a store, and there is a website.
What is not settled is the plugin contract and the profile format: the first
still changes between versions, the second migrates forward on load.

## What it does

- **Keys with states.** One key, several appearances, bound to a variable — a
  microphone key follows the microphone even when something else muted it.
- **Profiles, folders, pages.** Folders open like on a phone; a picture can be
  stretched across several keys like a merged cell.
- **Macros, not one command.** A script with conditions, pauses and repeats;
  long press and double press have scripts of their own.
- **Variables everywhere.** `{{obs.scene}}` in a label, a value choosing a
  state, a needle on an icon following a number. Variables with an argument —
  "how many people in *that* channel" — are published only where something
  reads them.
- **Event handlers.** A key can watch for a condition becoming true and act,
  whether or not anybody is looking at its page.
- **Live pictures.** Album art, an OBS scene thumbnail, a level meter, the faces
  of whoever is talking — drawn by a plugin, only while on screen.
- **A deck in a browser.** A phone or tablet on the same network is another
  deck, sharing the same variables; a new device waits in a queue until somebody
  allows it.
- **Plugins.** Installed from a store inside the program or from a downloaded
  file, with settings the program draws from a description.

## Hardware

**FIFINE AmpliGame D6** — 15 keys, 3×5, 112×112 screens. A SINOWEALTH-based
Stream Dock clone; the wire protocol is documented in
[docs/d6-protocol.md](docs/d6-protocol.md), verified against a USB capture of the
vendor software rather than guessed — including the key frame format (**112×112
at 4:2:0**, not the 100×100 every other driver assumes) and a command the others
do not mention.

It is the only model declared today. The family shares the protocol, so adding
one is a table entry in `packages/device` plus somebody with the device to try
it on.

**No hardware is needed to run the program.** With nothing plugged in it starts
on a virtual deck: profiles can be built and buttons tried in the window, the
network can be switched on, and a phone or tablet can take the deck over the
wire. A panel plugged in later joins on its own — the virtual one steps aside,
and comes back if the panel is unplugged.

## Install

Download an installer from the [releases](https://github.com/ron-tayler/easydeck/releases),
or build from source:

```bash
pnpm install
pnpm build
pnpm --filter @easydeck/app start
```

Nothing is code-signed, so Windows SmartScreen and macOS Gatekeeper each have
something to say on first launch.

EasyDeck lives in the tray: closing the window keeps the deck running, and
quitting is done from the tray menu.

## Where things are kept

`%APPDATA%\EasyDeck` on Windows, `~/Library/Application Support/EasyDeck` on
macOS, `~/.config/easydeck` on Linux — overridable with `EASYDECK_CONFIG_DIR`.

| Folder | What is in it |
|---|---|
| `profiles` | one folder per profile: the document and its pictures |
| `plugins` | installed plugins and their settings |
| `icons` | your own pictures, offered in the icon picker |
| `logs` | `easydeck.log`, rotated on every start, five kept |

Secrets — plugin passwords and tokens — are sealed apart from the settings and
never travel in an exported profile.

> **Profiles are executable content.** A profile can launch programs, so
> importing one from somebody else is as consequential as running their script.
> A profile never installs a plugin on its own; it can only say which ones it
> wants.

## Packages

| Package | Zone |
|---|---|
| [`@easydeck/device`](packages/device) | HID transport, the Stream Dock v1 driver, device discovery |
| [`@easydeck/engine`](packages/engine) | Profiles, pages, states, variables, actions — pure logic |
| [`@easydeck/renderer`](packages/renderer) | A button's visual state → device-ready JPEG |
| [`@easydeck/compositor`](packages/compositor) | Scenes into tiles: regions, animation, what the panel is told |
| [`@easydeck/protocol`](packages/protocol) | What travels between the daemon and its clients |
| [`@easydeck/core`](packages/core) | Wiring, profile storage, machine-facing actions, the API, plugins |
| [`@easydeck/ui`](packages/ui) | The Vue configurator, in the app window or a browser |
| [`@easydeck/app`](packages/app) | The desktop app: Electron main process, tray, packaging |
| [`site`](site) | The public page and the documentation |

Each package is a zone with a DDD-flavoured layout (`domain` / `application` /
`infrastructure`), and dependencies point inward. The daemon runs inside
Electron's main process and talks to the window over IPC; the same protocol is
served over a WebSocket, so a tablet, a script or another program can drive the
deck — one protocol, two transports.

Plugins live in their own repository:
[ron-tayler/easydeck-plugins](https://github.com/ron-tayler/easydeck-plugins).

## Development

```bash
pnpm install
pnpm build          # every zone; `tsc` is the type check, so this is both
pnpm test

# no hardware required
pnpm --filter @easydeck/renderer preview   # button visuals -> docs/panel-preview.png
pnpm --filter @easydeck/core start         # headless daemon: profiles from disk
pnpm --filter @easydeck/site serve         # the website, after SITE_BASE=/ build

# with a D6 plugged in — close the vendor software first, or the two fight
# over the panel
pnpm --filter @easydeck/device poc         # raw device zone: colours and key events
pnpm --filter @easydeck/renderer demo      # rendered buttons with labels and icons
pnpm --filter @easydeck/device key-monitor # what the firmware thinks is pressed
pnpm --filter @easydeck/renderer alignment # a model's frame geometry
```

| Variable | What it does |
|---|---|
| `EASYDECK_CONFIG_DIR` | where profiles, plugins and logs are kept |
| `EASYDECK_PORT` | the port the API and the web deck are served on |
| `EASYDECK_PLUGIN_SOURCE` | a local folder to read the plugin store from, for developing plugins |
| `EASYDECK_TRACE`, `EASYDECK_TRACE_FILE` | verbose tracing, and where it goes |

Longer explanations live in [`docs/`](docs): the D6 protocol, parametric icons,
icon colours and placement, key backgrounds, live surfaces, the plugin host and
how plugins are distributed.

## Releases

The tag is the release. Push one and CI packages the app on Windows, Linux and
both Macs, then opens a GitHub release holding the installers and a
`SHA256SUMS.txt`:

```bash
git tag v0.2.0 && git push origin v0.2.0
```

A tag carrying a suffix — `v0.2.0-beta.1` — is published as a pre-release.
Nothing in the repository is edited to match the tag: the packager is told which
version to stamp, so a release cannot disagree with the commit it was cut from.
To rehearse, run the Release workflow by hand — it builds the same installers,
attaches them to the run and stops short of publishing.

Every platform builds its own installers on its own runner, because the native
zones install binaries chosen for the machine that installed them. Locally,
`pnpm --filter @easydeck/app package` does the same for the machine you are on,
and `package:dir` skips the installer when you only want the unpacked app.

The website is deployed by its own workflow, and only when something in `site/`
changed.

## Known limits

- **Chords are impossible on the D6.** Its firmware reports one pressed key at a
  time; see [docs/d6-protocol.md](docs/d6-protocol.md).
- **The plugin API version is exact.** A plugin built against another version is
  refused with an explanation rather than loaded and broken. During early
  development that version will keep moving.

## Acknowledgements

Protocol knowledge builds on the work of
[mirajazz](https://github.com/4ndv/mirajazz),
[opendeck-ampgd6](https://github.com/ciscosweater/opendeck-ampgd6),
[companion-surface-mirabox-stream-dock](https://github.com/bitfocus/companion-surface-mirabox-stream-dock) and
[mirabox-streamdock-node](https://github.com/rigor789/mirabox-streamdock-node).

## License

MIT

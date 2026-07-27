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
| [`@easydeck/daemon`](packages/daemon) | Headless service: wiring, persistence, WebSocket API |
| [`@easydeck/ui`](packages/ui) | Web configurator served by the daemon |
| [`@easydeck/plugin-sdk`](packages/plugin-sdk) | Out-of-process plugin authoring kit |

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
pnpm --filter @easydeck/device poc         # raw device zone: colors + key events
pnpm --filter @easydeck/renderer demo      # rendered buttons with labels and icons
pnpm --filter @easydeck/renderer alignment # check a model's frame geometry
```

## Acknowledgements

Protocol knowledge builds on the work of
[mirajazz](https://github.com/4ndv/mirajazz),
[opendeck-ampgd6](https://github.com/ciscosweater/opendeck-ampgd6),
[companion-surface-mirabox-stream-dock](https://github.com/bitfocus/companion-surface-mirabox-stream-dock) and
[mirabox-streamdock-node](https://github.com/rigor789/mirabox-streamdock-node).

## License

MIT

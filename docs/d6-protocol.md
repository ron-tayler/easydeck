# FIFINE AmpliGame D6 — wire protocol (Stream Dock v1)

The D6 is a SINOWEALTH-based clone of the Mirabox "Stream Dock" family
(Mirabox 293, Ajazz AKP153, …). It speaks the family's **v1** protocol over
plain **HID output/input reports** — no custom drivers, no WinUSB.

Sources (all verified against each other):

- [mirajazz](https://github.com/4ndv/mirajazz) `src/device.rs` — the Rust
  driver that demonstrably works with the D6 (used by
  [opendeck-ampgd6](https://github.com/ciscosweater/opendeck-ampgd6))
- [companion-surface-mirabox-stream-dock](https://github.com/bitfocus/companion-surface-mirabox-stream-dock) `src/streamdock.ts`
- [mirabox-streamdock-node](https://github.com/rigor789/mirabox-streamdock-node) `src/streamdock.ts`

## Identification

| Field | Value |
|---|---|
| USB VID:PID | `3142:0007` (FIFINE); also `3142:0060` (product string "HOTSPOTEKUSB HID DEMO", confirmed live); earlier revision reportedly `258a:0150` (SINOWEALTH) |
| Control interface HID usage | usage page `0xFFA0`, usage `0x01` (interface 0; interface 1 is a regular keyboard) |
| Keys | 15 (3 rows x 5 columns), each showing a **112x112** frame |
| Serial number | none/garbage — v1 firmware hardcodes `355499441494`; two identical units cannot be told apart |

Revision differences confirmed on real hardware (2026-07):

- `3142:0060` uses **1024-byte packets** (HID output report length 1025), i.e.
  v2-style framing, while keeping the v1 command set, image ids and input
  format described below. The Windows HID stack reveals the true report
  length via the write result — drivers should adapt instead of hardcoding.

The device is composite: it also exposes a normal keyboard interface. Always
select the vendor interface by usage page, never by index.

## Framing

Every host->device write is one HID **output report** of **513 bytes**:

```
byte 0        report id, always 0x00
bytes 1..N    payload, zero-padded to the packet size
```

Packet size is 512 for classic v1 devices and 1024 for the `3142:0060` D6
revision. Commands survive extra zero padding, but image chunks must match
the real packet size exactly — padding inside the JPEG stream corrupts it.

Commands start with the 5-byte prefix `43 52 54 00 00` ("CRT"), followed by an
ASCII opcode. Image data is sent as raw chunks without any prefix.

## Commands (payload after the CRT prefix)

| Opcode | Bytes | Meaning |
|---|---|---|
| `DIS` | `44 49 53` | Wake the screens. Also packet 1 of the init sequence |
| `LIG` | `4C 49 47 00 00 <v>` | Backlight brightness, v = 0..100 |
| `CLE` | `43 4C 45 00 00 00 <k>` | Clear key display `k` (1-based image id), `0xFF` = all |
| `CLE` (bye) | `43 4C 45 00 00 44 43` | "DC" — host is disconnecting |
| `BAT` | `42 41 54 <len:4 BE> <k>` | Begin image upload for key `k`; JPEG bytes follow as raw chunks |
| `STP` | `53 54 50` | Commit uploaded images to the displays |
| `HAN` | `48 41 4E` | Sleep |
| `CONNECT` | `43 4F 4E 4E 45 43 54` | Keep-alive; the vendor sends it every ~8 s |
| `QUCMD` | `51 55 43 4D 44 1F 11 00 11 00 11 00` | Sent once during vendor startup, purpose unknown. The device works without it |
| `MOD` | `4D 4F 44 00 00 <0x30+m>` | Set device mode (some family members only) |

Firmware version: HID **feature report**, report id `0x01`, ~20 bytes
(fails on Windows in async-hid; untested with node-hid).

## Init sequence ("activation")

The D6 ignores the host until it receives, once per connection:

```
00 CRT 'DIS'
00 CRT 'LIG' 00 00 00      (brightness 0)
```

then normal traffic (set real brightness, clear panel, images). This is what
the vendor software does on startup and why the device looks "dead" to naive
readers. If key input still does not arrive after this, capture the vendor
software's startup with USBPcap/Wireshark and compare.

## Key images

- Baseline JPEG, **122x122**, RGB, rendered **upside down** (rotate 180° before
  encoding); quality 90 works (mirajazz), Companion uses 4:2:2 subsampling and
  steps quality down from 90 until the payload fits.
- **Hard limit: 10240 bytes** per image.

### The frame is 112x112 at 4:2:0, and both halves of that matter

Taken from a USB capture of the vendor software (2026-07, `3142:0060`): every
frame it sends is **112x112**, three components, sampling factor `0x22` —
that is **4:2:0** chroma.

The two choices are linked. 4:2:0 encodes chroma in 16x16 MCUs, and
`112 = 7 x 16` exactly, so no partial block ever lands on a frame edge. A size
that is not MCU-aligned makes the edge blocks decode with washed-out colour —
which is exactly what a 100x100 or 122x122 frame shows on this hardware.

Other drivers for this family send 100x100. That is smaller than the frame the
firmware expects, and since the firmware **neither scales nor clears**, the
uncovered rim keeps whatever the previous frame left there — a stale-coloured
band along one or two edges. Oversized frames are worse: rows shear and the
overflow spills into the next key in framebuffer order.

Deducing this from the outside is deceptively hard, because the firmware's
refusal to clear means every probe is contaminated by the previous one. The
capture settled it in one shot.
- Upload: `BAT` header (length + image key id), then the JPEG split into
  512-byte zero-padded chunks (each with its own `00` report id byte), then
  `STP` to commit. Multiple images may be uploaded before a single `STP`.

### Image key numbering (1-based, bottom row first)

Logical layout (row-major from top-left) -> device image id:

```
logical:  0  1  2  3  4     image id: 11 12 13 14 15
          5  6  7  8  9               6  7  8  9 10
         10 11 12 13 14               1  2  3  4  5
```

## Input reports

Device->host input reports (512 bytes, may or may not carry a leading report
id depending on the HID stack):

```
bytes 0..2   41 43 4B  ("ACK")
byte 9       key id: 0 = firmware reset, 1..15 = key (row-major from top-left)
byte 10      state: 0 = released, non-zero = pressed
```

Note the asymmetry: **input** ids are row-major top-left (1..15), while
**image** ids count bottom row first — the two tables above are different.

Reset (`key id 0`) means the firmware restarted; treat all held keys as
released. Duplicate press reports mean a release was lost.

## Known quirks

- Windows does **not** hand out HID devices exclusively, so the vendor
  software and a third-party driver can hold the device at the same time.
  Nothing fails; they simply both write, and both react to key presses, so
  the panel flickers between two owners. Confirmed on real hardware. Detecting
  a competing owner is not possible from the HID layer — the practical answer
  is to tell the user to close the other application.
- v1 devices share one hardcoded serial; running two D6 units simultaneously
  is not supported.
- Boot logo upload (`LOG` command, 800x480 BGR) exists in
  mirabox-streamdock-node for the 293 but is untested on the D6.

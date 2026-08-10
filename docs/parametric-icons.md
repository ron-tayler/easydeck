# Icons that answer to a variable

A key can show a number. It should also be able to *point* at one — a needle
swinging with the processor, a bar filling with the disk, a ring closing as a
stream fills up. The picture is the same picture every time; one thing about
it moves.

This is a feature for whoever writes plugins and presets, not for whoever uses
them. Somebody dropping a preset on their deck never sees any of it.

## The shape of it

An icon declares what can be changed about it. A key says which variable feeds
each of those, and over what range. The host does the arithmetic. Nobody
writes an expression anywhere.

**In the icon**, as ordinary SVG that opens in a browser and works there:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
  <metadata id="easydeck">
    {"params":[
      {"name":"angle","label":{"en":"Needle","ru":"Стрелка"},"from":-120,"to":120},
      {"name":"needle","type":"color","default":"#e2483d"}
    ]}
  </metadata>
  <style>
    :root { --angle: -120deg; --needle: #e2483d; }
    .needle { fill: var(--needle); transform: rotate(var(--angle)); transform-origin: 48px 48px; }
  </style>
  <circle cx="48" cy="48" r="46" fill="#1c2430"/>
  <rect class="needle" x="46" y="14" width="4" height="36" rx="2"/>
</svg>
```

`<metadata>` is a standard element every rasterizer ignores, so the file stays
a plain SVG. The defaults in `:root` are not decoration — they are what the
icon looks like before it is wired to anything.

**In the key:**

```json
"icon": {
  "source": "…",
  "params": {
    "angle":  { "variable": "hw.cpu", "from": 0, "to": 100 },
    "needle": "#ff5555"
  }
}
```

A string or a number is a constant. An object is a binding: the host clamps
the variable to `from…to`, maps it onto the parameter's own range, and rounds
to something worth redrawing for.

The icon knows nothing about `hw.cpu`. It knows it wants an angle between
−120 and 120, which is why the same needle serves a processor, a volume and a
viewer count.

## How the value gets in

Substitution, both sides, over the same text. The deciding fact is that **no
native rasterizer supports `var()`** — measured, not assumed:

| Rasterizer | `<style>` class | `transform` in CSS | `var(--x)` | Per icon |
| --- | --- | --- | --- | --- |
| @napi-rs/canvas (was) | no | no | no | 0.66 ms |
| resvg-js | yes | no | no | ~100 ms |
| **librsvg (sharp)** | yes | yes | no | **1.46 ms** |

So the panel path expands the custom properties itself before handing the text
to librsvg — a small polyfill for the one thing it lacks, with everything else
(classes, transforms, gradients) left to the real implementation.

The browser could do `var()` natively, and deliberately is not asked to. A
client fetches the template once — it never changes, so it caches for good —
and then performs the *same* substitution the daemon does, showing the result
through `<img src="data:image/svg+xml,…">`.

That choice buys three things at the cost of one:

- **The cache stops being a problem.** The asset is immutable because the
  template is. Nothing is refetched when a needle moves.
- **The attack surface never opens.** An SVG inside `<img>` renders in secure
  static mode: no scripts, no external fetches. Inlining it into the document
  to let CSS variables reach it would have meant sanitising every icon out of
  every plugin and pack, properly, forever.
- **The two surfaces agree.** One operation over one text, rather than a
  browser resolving a cascade and librsvg resolving its own.

The cost is `transition`: the needle jumps rather than sweeps. On the panel it
was always going to jump — we draw a frame, not a timeline — and a deck whose
tablet glides while its panel steps looks like one of them is broken.

### Rejected, and why

- **Inline SVG plus CSS variables in the browser.** Smooth, native, and puts
  third-party SVG into the configurator's own document. Sanitising is
  possible; being able to skip it is better.
- **Values in the asset URL** (`/asset/<hash>?angle=35deg`). The daemon
  expands, the client stays stupid — genuinely attractive for clients we have
  not written, and the cache even works, since values are discrete. Costs a
  round trip the first time each value appears, which a needle over Wi-Fi
  feels. Worth keeping as an addition, never as the replacement.
- **Parametric widgets** — a closed list of arcs, bars and needles we draw
  ourselves. Simplest of all and gives up the point: that an author can open
  the file in an editor and draw whatever they like.

## What is supported

What librsvg understands. Classes, transforms, gradients, opacity: yes.
Filters, blend modes, web fonts: expect the browser to show one thing and the
panel another.

Animation is not supported, and cannot be: a frame is drawn when a variable
changes, so movement comes from the plugin publishing, not from a timeline.
An icon full of `@keyframes` shows its first frame forever.

Keep parametric icons small. The text is substituted on every change, on both
sides.

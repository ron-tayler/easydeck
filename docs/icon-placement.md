# Putting a picture where it goes

A picture fills the key edge to edge. That is right for a photograph and wrong
for a glyph — a mark meant to be read from a metre away, drawn corner to corner
— and there is no setting for it, deliberately: one that changed how a picture
met the key's edge was offered on every icon, where what people wanted was for
the picture to fill the key.

So placement is a **moment**, not a setting. The picture is put where it goes,
once, in a small editor, and what comes out is an ordinary SVG with the picture
inside it at that size and in that corner. Nothing after that point knows a
placement ever happened: the panel, the compositor and the browser each see a
picture and draw it.

## The file

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"
     preserveAspectRatio="xMidYMid slice">
  <metadata id="easydeck">
    {"layers":[{"id":"l1","x":20,"y":20,"width":60,"height":60}]}
  </metadata>
  <svg id="l1" x="20" y="20" width="60" height="60" viewBox="0 0 24 24"
       preserveAspectRatio="xMidYMid meet">
    <path fill="currentColor" d="…"/>
  </svg>
</svg>
```

The canvas is a hundred units square, so a placement reads as a percentage to
anyone opening the file. `slice` on the wrapper is what makes a composed
picture meet the key's edge the way every other picture does — filling it,
cropped if the region is not square.

`layers` is a third independent field of the same metadata block that carries
[`params`](parametric-icons.md) and [`palette`](icon-colours.md). Order in the
array is painter's order: later is nearer the front.

The placement is recorded so it can be taken apart again. Baking it and losing
it is what this program did once before, and undid.

## Vector layers are inlined; raster layers are not

A vector layer becomes a nested `<svg>` carrying the artwork's own markup. A
raster becomes an `<image>`.

This is not a stylistic choice. An `<image>` pointing at an SVG is a document
of its own: no `color` reaches it, so `currentColor` stops answering the colour
button, and no `var()` of ours is ever substituted into it, so a parametric
picture stops answering its variable. Inlining is what keeps both alive — and it
is why everything below is necessary.

## Why every layer's names are prefixed

Inlining one picture into another puts two of everything into one document, and
every one of them collides in silence. Measured on librsvg, which is what draws
SVG on the panel:

| Collision | What happens |
| --- | --- |
| Two `<metadata id="easydeck">` | The reader sees only the first. Two elements with one id is also invalid. |
| Two `id="ring"` | `url(#ring)` resolves to the first, so the second layer wears the first one's gradient. |
| Two `--angle` | One value is substituted into both, so both needles swing together. |
| Two `:root` blocks | The last one wins. |

So composition **renames rather than nests**. Each layer's custom properties,
element ids and the references to them are given a prefix of its own; its
`<metadata id="easydeck">` is consumed and its `params` and `palette` are lifted
into the wrapper's single block under prefixed names, with the layer's number
prepended to each label so two identical needles can be told apart.

`:root` is left exactly as written, and can be: once the properties under it are
named apart, two layers declaring defaults on the same root are no longer saying
anything about each other. Rewriting the selector would mean relying on how a
rasterizer resolves one, for no gain.

`transform-origin` is baked at composition time, against the layer's own
`viewBox`. Left for later it would be resolved against the wrapper's, which is a
different picture's idea of where the middle is.

### The prefix is an identity

A key's parameter bindings are stored under the parameter names. So prefixes are
assigned once and never renumbered or reused — not when a layer is reordered,
not when one is deleted. Otherwise dragging a layer upwards would quietly
repoint every binding made against it.

This is also why prefixing starts at the first layer, where nothing can collide:
a picture that grew a second layer later would otherwise have to rename the
first one's parameters, and every binding against them would point at nothing.

## What does not go through here

**Animations.** Which path draws a picture is decided by the source's magic
bytes, so a GIF inside a wrapper is no longer a GIF and arrives as its own first
frame, standing still. Animations are left as they were until they are worth
doing properly for both formats at once.

**A picture nobody moved.** Applying without changing anything gives the
original artwork back rather than a wrapper around it, so it stays the same
picture as the one on the other seven keys already wearing it — and one the
library can still offer back.

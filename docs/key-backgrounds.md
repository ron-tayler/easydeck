# What a key has behind everything else

A background was a colour, and most of them still are. A profile that says

```json
{ "visual": { "background": "#1f4e79" } }
```

means exactly what it always did, and every file written before gradients
existed is read without a migration. The object form is what a colour turns
into once somebody wants light on it.

```json
{
  "visual": {
    "background": {
      "base": "#0b1220",
      "linear": {
        "angle": 150,
        "stops": [
          { "color": "#1e3a8a", "at": 0 },
          { "color": "#0b1220", "at": 1 }
        ]
      },
      "spots": [
        { "color": "#38bdf866", "x": 0.75, "y": 0.2, "radius": 0.5 }
      ]
    }
  }
}
```

Three layers, always in this order: the flat `base`, the ramp over it, and the
spots over that.

## Why two kinds of gradient

A ramp and a spot are not the same idea wearing different settings.

A ramp runs **straight across the key**. It has a direction and colours along
it, and that is the whole of what can be said about it — which is why it is
edited on a bar, the way every program has drawn one for thirty years.

A spot is a **place**. It is light thrown at a point and fading out from there,
and nothing on a bar can express where it is. Two of them in opposite corners
is most of what a modern key looks like, and neither a flat fill nor a single
ramp can say it. So spots are edited on a picture of the key, where a click
puts one down and a drag moves it.

Both are optional and they compose. A background with neither is stored back as
a plain colour string.

## The fields

`angle` is degrees clockwise from straight up, **exactly as CSS counts them**:
`0` runs bottom to top, `90` left to right. The gradient's line runs through
the middle of the key and is long enough that its ends reach the corners —
again CSS's own definition, reproduced in `gradientLine`.

`at` on a stop is 0 at the start of that line and 1 at the end. Stops may be
stored in any order; both surfaces sort before drawing, so dragging one stop
past another needs no bookkeeping.

`x` and `y` on a spot are fractions of the key from its top-left corner.
`radius` is how far the light reaches, as a fraction of the key: `0.5` is half
of it, and values above `1` are allowed and useful — a wide, weak wash is a
common thing to want.

Colours are `#rrggbb` or `#rrggbbaa`. The alpha is what the opacity slider
writes.

## Why a spot is an ellipse

A spot is drawn as an ellipse sized as a fraction of the region's width and
height, not as a circle of a radius in pixels.

CSS can only size a radial gradient in percentages if it is an ellipse —
`circle` takes lengths only — and a key is square, so an ellipse sized this way
*is* a circle on every key anybody will ever see. What it costs is a spot that
stretches on a picture spread across a row of keys. What it buys is that the
browser and the renderer are drawing the same thing rather than two things that
usually look alike.

That is the rule the whole feature is arranged around, and it is why the
arithmetic lives in `packages/engine/src/domain/background.ts` rather than in
either surface: the configurator builds a CSS `background` from it, the
renderer paints onto a canvas from it, and a preview that is a shade off is
worse than no preview, because it is believed.

## Fading, and the grey ring

A spot fades to **its own colour at zero alpha**, never to `transparent`.

`transparent` is transparent *black*. A red spot fading to it fades through
grey and leaves a dirty ring where it thins out. Every stop `colorAt` produces
keeps the three colour channels and moves only the alpha, and the falloff
itself — most of the fall inside the first half of the radius — is shared by
both surfaces as `SPOT_FALLOFF`, so the rim is in the same place on the key as
it is in the preview.

## Downstream

The scene, the compositor and the renderer carry the value through without
looking inside it. Two places do look:

- `paintBackground` in the renderer, which is the only code that turns any of
  this into pixels for the device;
- the cache keys, where a background is folded into a string. The compositor
  writes its own, field by field in a fixed order rather than by
  `JSON.stringify`, whose output follows the order an object happened to be
  built in — two gradients that draw the same picture would otherwise take two
  cache entries.

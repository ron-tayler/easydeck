# Icons somebody can recolour

A key showing a microphone should be able to show a red one. Not a second
picture of a red microphone — the same picture, in red, chosen after the fact
and changed as often as anybody likes.

This is a different feature from [parametric icons](parametric-icons.md), and
deliberately so. A parameter exists so a picture can answer to a **variable**:
a needle that swings with the processor, a bar that fills with the disk, and
every part of its declaration — the ranges, the units, the bindings — is in
service of that. A colour is chosen once, by hand, because somebody wants the
mute key red. Running the two through one declaration would have meant
explaining ranges to whoever only wanted red.

Two layers. Most icons only ever need the first, and the first asks nothing of
whoever drew them.

## One colour: `currentColor`

Nothing here is ours. `currentColor` is how the web has coloured icons since
long before this program existed, and how every set worth downloading — Lucide,
Feather, Heroicons, Material Symbols — already ships. An icon drawn this way is
recolourable in EasyDeck with no metadata, no contract and no edit:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <path fill="currentColor" d="M12 3 3 11h2v9h6v-6h2v6h6v-9h2z"/>
</svg>
```

That is the whole of it. Drop it on a key, and a swatch appears beside the
picture button.

The keyword works anywhere a colour does — `fill`, `stroke`, `stop-color`, a
rule in a `<style>` block, a class on a group — and it is case-insensitive,
because CSS keywords are.

## Several colours: a palette

An icon drawn in more than one ink names them, and each becomes its own swatch:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <metadata id="easydeck">
    {"palette":[
      {"name":"body","label":{"en":"Body","ru":"Корпус"},"default":"#8899aa"},
      {"name":"grille","label":{"en":"Grille","ru":"Сетка"},"default":"currentColor"}
    ]}
  </metadata>
  <style>:root { --body: #8899aa; --grille: currentColor; }</style>
  <rect fill="var(--body)" width="24" height="24" rx="4"/>
  <circle fill="var(--grille)" cx="12" cy="12" r="5"/>
</svg>
```

Every field: `name` is the custom property without its dashes, `label` is what
the swatch is called in the editor, and `default` is the colour the picture was
drawn in.

`default` may be `currentColor`, and often should be. A slot that defaults to it
follows the icon's main ink, so a three-ink picture arrives looking like a
one-ink one and stays that way until somebody wants otherwise.

`palette` shares the `<metadata id="easydeck">` block with `params`, and that is
the only thing the two have in common. A palette entry has no `type`, no range
and no unit — if you are writing one of those, you are writing a parameter.

`currentColor` and a palette may both appear in one icon. The main ink is
listed first and the named ones after it.

## What is refused

Reading is forgiving, so an icon never fails to load over a typo. The reasons
are reported in the picture's own settings window instead, where an author will
see them:

- a `palette` that is not a list;
- an entry with no `name`;
- the same name twice;
- a name of `currentColor` — that is the icon's own ink, not a property;
- **a name claimed by both `palette` and `params`.** This is the one worth
  watching for. Both write into the same custom property, from two different
  controls in two different panels, and whichever ran last would win in silence.

## How the colour gets in

Differently for each layer, and for a measured reason.

`currentColor` is resolved by the cascade. The artwork is not touched at all —
it is handed a `color` to inherit, written onto the root `<svg>` as a style
attribute so it outranks anything the icon sets for itself. librsvg, which is
what draws SVG on the panel, does this correctly in every form it was tested
in: through a class, through nested groups, on a stroke, and in either case of
the keyword. An icon with no colour chosen draws black, which is wrong but is
still a picture.

Named slots are read with `var()`, and **no rasterizer in reach supports
`var()`** — see the measurements in [parametric-icons.md](parametric-icons.md).
So those are substituted into the text, exactly as parameters are, and in the
same single pass: two passes would rewrite `transform-origin` twice, and a slot
defaulting to `currentColor` would be at the mercy of which pass went first.

Both surfaces — the panel and the window — call the same function over the same
icon and get the same text back. That is the whole reason they agree about what
a key looks like. There was a fortnight when they did not.

## For whoever is drawing a pack

Draw in `currentColor` and stop there. It costs nothing, it is what the rest of
the world already does, and an icon that needs a second ink can grow a palette
later without the first one being redrawn.

The built-in set is exactly this: one path each, `fill="currentColor"`, stored
as the vector it is. It used to be rasterized to a key-sized PNG in whatever
colour was current at the moment of choosing, which made that colour permanent —
a PNG has no colour left to change.

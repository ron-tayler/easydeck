# A picture that comes from a plugin

Design, agreed in discussion and not yet built. `plugin-host.md` says what a
plugin may ask of the host today; this says what it will be able to ask once a
picture can come from one.

## What it is

A plugin contributes three kinds of thing to a key today, and this adds a
fourth:

| | what it is |
| --- | --- |
| `actions` | what a key *does* |
| `variables` | what a key *says*, in text |
| **`surfaces`** | **what a key *shows*, as a picture** |
| `presets` | whole keys, ready made |

A surface is deliberately shaped like an action rather than like a variable: it
has a type, a name, an icon for the palette, and `ParamDefinition[]` the host
draws. Which album art — this player or that one. Which scene. Which sensor,
over what period. All of that is a form, and the editor already draws forms,
including the lists that only exist while another program is running.

## Where it sits

**On a state, not on a button.** A state already owns its background, its
picture, its label and their colours; the live source takes the place of
`icon.source` and nothing else moves. "Album art while it plays, a plain icon
while it is paused" then falls out of the state machinery that already exists,
with no new rule.

**Orthogonal to what the key does.** A background from Spotify and a press that
starts a pomodoro is a sensible key, and nothing in the design should have an
opinion about it. The script lives in `actions`, the picture in `visual`, and
they have never known about each other.

That orthogonality is also what makes the failure mode gentle: when a plugin is
gone, only the picture is gone. The background, the label, the states and the
script are still exactly what the profile says.

## What the profile stores

A reference, not the picture. This is the one place where a live source differs
from every other picture we have: a preset naming `plugin:hardware/cpu.svg` is
expanded into real bytes on its way to the window, so the key survives the
plugin being uninstalled. A live source cannot be — the whole point is that it
changes.

So a profile may now carry two kinds of picture, and the difference is visible
in the document: baked bytes, or a named surface with its parameters.

## When the plugin is not there

Two situations that look alike and must not be treated alike.

**The plugin is missing** — the profile came from another machine, or it was
uninstalled. This is broken, and it is fixable, so it is marked: the key draws
everything the profile still has — background, label, colours — with a small
mark in the corner saying something is absent. Opening that key names the
plugin it wants and offers the ways out: install it, open the plugin settings,
open the plugins folder.

Not a black key with an exclamation mark: the profile still holds a background
and a label, and throwing them away loses information for no gain. Not silence
either — a key that looks finished but is missing its picture is the deck
lying quietly.

**The plugin is there and has nothing to show** — OBS is closed, nothing is
playing. This is not a fault and gets no mark. The picture is simply absent,
the way a variable with no value renders as empty. If these two were conflated,
everybody who had not yet opened OBS would find warning marks on their deck.

## Who is looking

A plugin must not draw for a page nobody has open. Spotify fetching album art
for a folder somebody visited last week is the same waste `onWatched` was built
to prevent — but it is *not* the same question.

`variablesReadBy` walks the whole profile, and rightly: a handler on another
page still has to fire when recording starts, so a variable is watched wherever
it is mentioned. A picture is the opposite. It is worth drawing only while it
is **on screen**, and "on screen" is per deck — the same key may be showing on
the panel and not on the tablet.

So this is a second, narrower question living beside the existing one, not a
reuse of it: which surfaces are visible right now, on any deck, told to the
plugins that own them, and told again whenever the page changes.

## Frames, and what may be kept

The compositor already plays prepared frames and chooses which one to show from
the clock; what it lacks is any way for frames to arrive from something other
than a GIF in the profile. A surface fills that gap, and says of each frame
whether it is worth keeping:

- **A picture that will be shown again** — album art, an avatar, a scene
  thumbnail. Addressed by content and cached like any other tile.
- **A frame in a stream** — a graph redrawn every second, a meter. Never
  cached: it is seen once, and keeping it would fill the byte cache with
  pictures that will never match again.

That distinction belongs in the contract rather than in a heuristic, because
only the plugin knows which of the two it is sending.

## What this does not decide

**Motion has no vocabulary yet.** Looping or once, always or on an event, what
happens when the page is hidden mid-animation — none of that exists in the
editor today, and it is a larger question than where the picture comes from.
A surface that pushes frames sidesteps it by deciding for itself; a GIF on a
key does not, and the two will have to meet somewhere.

**Presets carrying a live surface.** They can, but a preset is meant to survive
its plugin, and this one cannot. Probably the preset simply carries the
reference and inherits the missing-plugin behaviour above.

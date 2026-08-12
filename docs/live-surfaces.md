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

## Changing a widget while the deck runs

A widget's settings are in the profile, which is what somebody authored. What
it is *showing* is a fact about this moment — and pressing a key to switch a
graph from the processor to the memory is about the moment.

So a change is **laid over** the profile rather than written into it, exactly
as a forced button state is. The document stays what was authored, an export
carries that and not whatever was last pressed, and the overrides survive an
edit to the same profile while a genuine switch clears them.

Each override remembers who made it. A macro, the plugin that owns the widget
and another plugin entirely may all write the same setting, and "why is my
graph showing the memory" deserves a better answer than a shrug.

**`vars.set-widget-param`** is the macro, sitting beside `vars.set-button-state`
because they are the same kind of thing: both change what the deck shows
without touching what was authored. It takes a button — this one or another —
then one of that widget's settings, then a value. An empty value puts the
setting back, so one key can undo another without knowing what it was.

## Any plugin may do the same

The macro is not a privileged path. A plugin declares widgets, and it can also
see and change them:

- **`onWidgets`** — what is on screen, whoever declared it. The same bargain
  `onWatched` makes for variables and scoped the same way: what is being drawn
  now, not every key of every folder. That is what keeps it from being a way to
  read somebody's whole configuration, and it is all a plugin needs, since a key
  nobody is looking at is a key nothing useful can be done to.
- **`setWidgetParam`** — the same override the macro writes.

Not filtered to a plugin's own widgets. A plugin may reasonably want to point
somebody else's graph at what it is talking about, and forbidding it would be a
fiction — a plugin can already run actions and write variables. What limits it
is the scope: it sees what is drawn.

`SurfaceRequest` therefore names the buttons a picture is being drawn for. A
list, because two keys wanting the same picture with the same settings remain
one drawing — that saving is deliberate — and the list is what gives a plugin
something to address.

## Forms that change shape

Three additions to `ParamDefinition`, all optional, none specific to widgets:

- **`dependsOn`** — the field appears once the named ones are answered. The OBS
  filter chain stops showing three boxes, two of which cannot answer yet.
- **`emptyNote`** — what to say when the choices come back empty. "This key has
  no widget on it" beats a text box inviting an answer that cannot be right.
- **`shapeFrom`** — the field's whole definition arrives at run time. This is
  how "the new value" becomes a number for a thickness, a picker for a colour
  and a list for a period: the widget's own declaration is *borrowed*, with its
  range and its options intact, so there is nothing to drift.

`button-state` was the first parameter type that depended on another, and was
solved by adding a type. These are that solved once, generally; it need not be
rewritten, but nothing new should need the same treatment.

## Timers, as they came

Named timers landed as a **family of variables**, not as a widget:
`clock.timer(Кофе)` with its `-seconds` and `-running` beside it. A widget
would have meant a plugin drawing the numerals, which is a picture where a
string will do — the label already substitutes a variable, and a timer that is
a variable can be compared in an `if`, bound to a state and put in a label
without any of this document's machinery.

Two keys with the same name are one timer, which is how a start key and a
display key work; two names are two independent timers, which is the point.

A timer comes into existence by being named. There is no list of timers in the
plugin's settings, because that would be a second place where they exist and it
would go stale — a name in a macro and a name in a list are one thing too many.

Which is why the name is **typed** in the action that starts one and **chosen**
everywhere else. The typing is not a fallback: it is where somebody works out
that naming a timer is what makes it. Every other question is about a timer
that already exists, and there a list is both easier and the only way to be
sure of writing the same name twice. The cost stands — a typo makes a second
timer rather than an error — so the governing action can delete one.

Timers do not survive a restart of the daemon: a running stopwatch is a fact
about this session, and one that came back saying fourteen hours is rubbish
nobody started. The keys that govern one therefore spend the time before it is
started pointing at nothing, and do nothing, quietly.

## What this does not decide

**Motion has no vocabulary yet.** Looping or once, always or on an event, what
happens when the page is hidden mid-animation — none of that exists in the
editor today, and it is a larger question than where the picture comes from.
A surface that pushes frames sidesteps it by deciding for itself; a GIF on a
key does not, and the two will have to meet somewhere.

**Presets carrying a live surface.** They can, but a preset is meant to survive
its plugin, and this one cannot. Probably the preset simply carries the
reference and inherits the missing-plugin behaviour above.

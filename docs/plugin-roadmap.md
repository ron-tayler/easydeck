# Plugins worth writing

[plugin-host.md](plugin-host.md) says what a plugin *may* do. This says which
plugins to write next, and why those.

The list is not sorted by popularity. Each entry is chosen because it pushes on
a different part of the contract, and the ones that push hardest come first —
a gap found while writing the third plugin is cheap, and the same gap found by
somebody else's plugin after the API version is published is not.

## Where we are

Built into the host, no plugin involved: navigation (`easydeck.*`), variables
(`vars.*`), system (`system.run-program`, `system.hotkey`, `system.type-text`,
`system.type-password`, `system.open`), media and per-application audio on
Windows (`media.*`), the deck itself (`deck.set-brightness`, `deck.sleep-panel`),
and `http.request`. Scripts on a key have `core.if`, `core.for`, `core.delay`
and `core.on` — the last of which is the handler that makes a plugin's variable
able to cause something.

Written as plugins, and deliberately using nothing a third party could not:

| Plugin | What it proved |
| --- | --- |
| `hardware` | live keys with no actions at all — presets, published variables, `onWatched` |
| `obs` | a socket, a password, dynamic option lists, feedback by event |
| `vts` | authorising that needs a person in front of the screen, and `remember` |
| `clock` | a plugin on its own schedule, and `onWatched` as correctness rather than thrift |

The plugins folder currently loads the passive half of a plugin — icons,
translations, `.streamDeckIconPack` archives. It does not yet load anybody's
code; every plugin above is a TypeScript module compiled into the daemon.
**That is the largest single item on this list and it is not on it**, because it
is not a plugin: until an installed folder can carry behaviour, every entry
below is work only we can do.

## What each candidate is for

### ~~1. Clock / Timer~~ — written

Clock, date, stopwatch, countdown and pomodoro, in
`infrastructure/plugins/clock/`. It is the reference plugin: no dependency, no
authorising, nothing that can be uninstalled underneath it, and the timekeeping
sits in a file of its own that takes `now` as an argument.

Two things came out of writing it, both of which outlived it:

**`update` on `PluginHost`.** Every plugin was keeping its own `setInterval`,
which put its heartbeat somewhere the host could not see: stopping such a
plugin only asks it nicely, and one that forgets a timer runs for as long as
the daemon does. Plugins now ask the host for a beat and get a handle back.
`hardware` and the audio half of `media` were moved onto it.

**`variablesReadBy` was blind to handlers.** A plugin only reports on what it
is told something reads, and that list was gathered from labels and state
bindings alone — so a profile whose only interest in a variable was a "when
this happens" handler read nothing at all, the value never arrived, and the
handler that existed precisely to notice it never fired. This was a live bug
for OBS long before the clock existed; the clock is only what made it obvious.

### ~~2. Shell / Script~~ — decided against

Not to be written, and the reason is the one this entry used to carry as an
open question. A profile is meant to be copied between machines and pasted into
issues, and a profile carrying `shell.run` carries somebody else's command
line. Every mitigation on offer — refuse it in an imported profile, mark such
buttons, ask at import — is a prompt somebody clicks through, and being the
program that made a click-through prompt the only thing between a downloaded
profile and a shell is not a position worth taking for a convenience.

### 3. Now Playing — Spotify, or whatever is playing, with the cover art

Here for one reason: **a plugin cannot currently put a picture on a key.**
`setVariable` takes a `VariableValue`, which is a scalar, and album art is not
one. The same wall is behind an OBS scene thumbnail, a camera preview, a
generated chart, a QR code, an avatar.

So the question this plugin settles is not Spotify's API, it is the shape of
the answer: a variable that holds an `assetId` the way the compositor already
keys its cache, or a separate `setImage` call, or an icon source that resolves
through the plugin. Whichever is chosen has to survive the picture changing
thirty times a minute without churning the asset store.

Worth deciding before it is discovered by somebody writing a plugin against
the published API.

### 4. Twitch / YouTube — viewers, followers, chat as a trigger

The full OAuth round trip, which is the one part of `PluginHost` that has
never run: `route()` on the loopback server, `openExternal`, `remember` for the
token, `secret` for what it must not leak. VTube Studio authorised with a
dialog inside another program; this authorises through a browser, which is a
different mechanism and the one every remaining service uses.

Note what `plugin-host.md` already commits to: EasyDeck ships no OAuth
application, each user registers their own. Where Device Code Flow is offered,
prefer it — no redirect, no client secret, and no loopback server at all.

Chat as a trigger runs into the same gap as the countdown.

### 5. MIDI — incoming as a trigger, outgoing as CC and notes

One plugin, and every DAW, lighting desk and mixer that speaks MIDI becomes
reachable. It is also the honest test of the trigger question, because a MIDI
plugin whose input cannot cause anything is half a plugin.

### 6. Home Assistant / MQTT

Families of variables at a scale nothing has tried: a house with two hundred
entities, of which a deck shows six. `onWatched` was designed for exactly this
and has so far only been asked about a dozen sensors.

### 7. Soundboard — play a file into an output device

Consistently the most-asked-for feature in this class of program, and the one
that needs something the project does not have: audio output, device
enumeration, and in practice a virtual cable so the sound reaches a stream.
Cheap to want, not cheap to build. Sequence it by whether the audience is
streamers.

### Beyond that, in rough order of demand

Weather (a small `http` plugin, and a good second reference); window management,
keyboard layout, clipboard; Philips Hue; Discord (its RPC offers little beyond
mute and deafen, and that little has been withdrawn before); Elgato Wave Link;
Ableton and Reaper directly, if MIDI proves insufficient.

## Gaps these will hit

**Pictures from a plugin.** Described under Now Playing. The earlier it is
answered, the less of the API has to change to accommodate it.

**Triggers — narrower than it was.** Handlers exist: a key's "when this
happens" tab holds `core.on` steps, they are gathered from the whole profile
rather than the page on screen, and they fire on the edge — the moment the
condition becomes true. "Recording started, go to the live page" and "the
countdown reached zero, run this" both work today, and the clock's countdown
was written to give a handler two edges to choose from: the number stopping at
zero, and the running flag turning over.

What is still missing is the **momentary** event — one with no state to become
anything. A chat message with the same text twice, or the same MIDI note struck
twice, does not change the variable, so the edge never comes. Both plugins that
want it are still unwritten, which is the right time to decide what the shape
is: a variable that can be published as an occurrence rather than a value, or
a separate `emit` beside `setVariable`.

**Partial status.** `PluginStatus` has four values and no way to say "working,
but not completely". The hardware plugin already lives in that state without
administrator rights, where temperatures are unreadable and everything else is
fine. A plugin that reports `ready` while half its variables stay empty is
lying quietly; one that reports `error` while doing its job is crying wolf.

**A plugin folder that carries code.** The contract was written so this would
be a transport change and nothing more — every `PluginHost` call is already a
message. It is still the largest piece of work here, and until it lands the
plugin list is whatever we personally have time to write.

## The strategic one: Elgato compatibility

Their SDK is a separate process speaking WebSocket against a manifest, which is
close enough to our shape that the question deserves a real answer rather than
a shrug. If it worked, it would bring hundreds of finished plugins at once —
more than this document could ever list.

The likely rock is the Property Inspector: their settings UI is an HTML page a
plugin ships, ours is `ParamDefinition[]` the host draws. That difference is
deliberate on our side — described in the comment on `ParamType` — and it is
what lets a phone, a web page and a future native client all render the same
form. Hosting somebody's HTML gives that up; refusing to means their plugins
arrive without a way to configure them.

Worth an afternoon of investigation before anyone plans around it, and worth
knowing that plenty of Stream Deck plugins have few settings or none, which may
make a partial bridge more useful than it sounds.

## Suggested order

~~`clock`~~ → ~~`shell`~~ → decide the picture question → `now-playing` →
`twitch` → `midi`. Slot code-carrying plugin folders in as soon as it is
affordable; every week it waits is a week the ecosystem is one person wide.

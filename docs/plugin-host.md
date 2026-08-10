# What a plugin may ask of EasyDeck

A plugin used to be a manifest and some handlers: a list of things a key could
do. That was enough for navigation, variables and the system actions, and it
is not enough for anything that talks to the outside world. OBS holds a socket
open, Twitch holds a token, a processor gauge holds a timer. This document is
the contract for those.

It is written as though every one of these plugins were somebody else's, and
the built-in ones deliberately use nothing a third party could not. Whatever
the built-ins can do, a plugin can do.

## The shape of it

A plugin is up to four things, and needs only the first:

- a **manifest** — data: its actions, the variables it publishes, the settings
  it needs, the buttons its settings window shows;
- **action handlers** — what its keys do;
- a **life** — `start(host)` and `stop()`, for anything that has to be held
  open;
- **command handlers** — what the buttons in its settings window do.

`PluginRuntime` owns the last two. `ActionRegistry` owns the first two, and
did before any of this existed.

## PluginHost

Everything a plugin may ask for arrives through one object, and none of the
methods hand it anything of ours:

| Call | For |
| --- | --- |
| `settings()` | what the user filled in, secrets included |
| `onSettingsChanged(fn)` | the user pressed Save |
| `setVariable(name, value)` | publish a value for keys to show and bind to |
| `setStatus(status, message?)` | `off` / `connecting` / `ready` / `error` |
| `provideOptions(name, load)` | the choices behind a parameter's `optionsFrom` |
| `route(path, handler)` | claim `/plugin/<id>/<path>` on the loopback server |
| `openExternal(url)` | open a browser — the way into any OAuth flow |
| `log(level, message)` | say something to whoever is watching |

The absence of anything richer is the design. A plugin never receives the
variable store, the deck registry or the HTTP server, so every one of these
calls is already a message — which is what will let third-party plugins move
into a child process without the plugins themselves changing.

### Publishing values

`setVariable` only accepts names the manifest declared, so a plugin cannot
write over the user's variables or another plugin's. Nothing else is needed to
put live data on a key: the deck repaints whenever a variable changes, and a
label may say `{{obs.scene}}` or `{{hw.cpu}}%`.

Two habits belong to the plugin rather than the host:

- **Publish what is worth showing.** `43`, not `42.7331`. A value that changes
  every second is a picture pushed over USB every second.
- **Clear on disconnect.** A key showing the last viewer count of a service
  that dropped an hour ago is the deck stating something untrue.

## Presets

An action is a step; a preset is a whole key. Dragging an action into a macro
adds that step, and dragging a preset onto the grid puts down a finished
button — its colours, its states, whatever it does. So the palette shows
presets beside the deck grid and actions inside the key editor, and the same
plugin reads as "here are some keys" in one place and "here are some steps" in
the other.

This is what lets a plugin that publishes but does not act appear at all. The
hardware plugin has no actions whatsoever, so without presets it would be
invisible in a palette made of actions, and its variables could only be used
by somebody who knew to type `{{hw.cpu}}` into a label.

No flags decide where a plugin shows up, and none are needed: a plugin with no
actions is absent from the editor by itself, and a plugin with no presets
still drops onto the grid as a key holding that one action, which is what the
palette did before presets existed.

What lands is an ordinary button. Nothing in a profile remembers that it came
from a preset, so editing it afterwards is editing a button, and uninstalling
the plugin leaves it in place showing nothing — which is correct, because a
profile knows nothing about plugins.

### Icons that move

A preset's icon may answer to a variable — a needle that swings with the
processor rather than a number that changes. Declared in the icon, wired up in
the key, and described in [parametric-icons.md](parametric-icons.md).

### Bands

A gauge wants "90 and above is red", and until presets there was no way to say
it: a number with no exact match walks the states like a carousel, which is
right for a counter and nonsense for a reading. A state's `when` may now be a
range instead of a value:

```json
{ "id": "hot", "when": { "min": 85 }, "visual": { "background": "#7a2c2c" } }
```

Both ends inclusive, either one optional, first match wins.

## Settings

Declared as `ParamDefinition[]` — the same declarations an action's parameters
use, so the configurator draws the form with machinery it already has and a
plugin still ships no UI.

Two fields exist for settings in particular:

- `secret: true` — a token or password. Stored apart, never sent to a client,
  and reported to the configurator only as "filled in" or not.
- `optionsFrom: 'scenes'` — the choices come from the plugin at run time. The
  configurator must still allow the value to be typed: setting up an OBS
  button while OBS is closed is the normal case, not the exception.

Saving is partial. The configurator never receives a secret, so it cannot send
one back, and a whole-document save would drop every token the moment somebody
changed a port.

### Where it lands

```
%APPDATA%\EasyDeck\
  plugin-settings\<id>.json   ports, intervals, client ids — readable
  secrets\<id>.json           tokens — sealed where the platform allows
```

Machine-wide, not part of a profile: a profile is meant to be copied to
another machine and shared, while the port OBS listens on and the token for an
account are true of this machine alone.

Secrets are sealed through `SecretVault`. The desktop app implements it with
Electron's `safeStorage` — DPAPI on Windows, so a copied file decrypts to
nothing. Started without Electron, the daemon writes them as they are and says
so in the file. Storing a key beside the ciphertext would be theatre, so
nothing pretends otherwise.

## Commands

Authorising with Twitch, reconnecting, testing a token: real work that nobody
wants on a key. Declared in the manifest, shown at the foot of the settings
window, and never in the action palette — a palette offering "Authorise" next
to "Switch scene" invites somebody to bind a browser-opening action to a key
they press by accident.

## Status

`off`, `connecting`, `ready`, `error`, with a message. Shown on the plugin's
gear and beside its actions. It exists because "no OBS on port 4455" and "no
password set yet" want different things from the person reading them, and
because a key bound to a plugin that is still connecting should not look
broken.

A plugin that throws on the way up lands in `error` with the reason and the
daemon keeps running. Half of these plugins talk to programs that may not be
installed.

## Routes and OAuth

Routes live on a loopback server of their own, never on the one that serves
the web deck. That server can be opened to the network on purpose, and an
OAuth code arriving over an open port is a code anybody on that network can
take.

EasyDeck ships no OAuth applications. Each user registers their own and pastes
the client id into the plugin's settings — which is what comparable programs
do, and the only honest option for a program whose source is public: a secret
in an open repository is not a secret. Device Code Flow, where a service
offers it, avoids both the redirect and the secret entirely.

## Order of work

1. Contract and storage — this document's subject. Done.
2. `hardware` — processor, memory, disks. Done: no sockets, no authorisation,
   no settings, and it proved the live-key path end to end.
3. `obs` — a socket, a password, dynamic scene lists, feedback by event.
4. The settings window in the configurator, and dynamic options with it.
   Deliberately after OBS rather than before: a form built for a plugin that
   does not exist yet is a guess about what its settings need.
5. The loopback server, which nothing wants until the first OAuth flow.

Then Discord, which talks over a pipe rather than a socket, and Twitch, which
is where authorisation gets interesting.

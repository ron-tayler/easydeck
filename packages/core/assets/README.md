# Pictures the built-in plugins bring with them

One folder per plugin, named after its id, holding whatever a preset wants to
put on a key — SVG, PNG, an animation:

```
assets/
  hardware/
    cpu-gauge.svg
    disk-ring.svg
  obs/
    recording.gif
```

A preset points at one the way a profile points at its own pictures:

```ts
visual: { icon: { source: 'plugin:hardware/cpu-gauge.svg' } }
```

The id in the reference is the plugin's, not the folder's owner: a preset may
name another plugin's picture, and an installed plugin's `icons/` folder is
searched under the same scheme. Nothing has to be arranged between them.

**What lands in a profile is the picture, not the reference.** The manifest is
expanded on its way to a window, so dropping a preset on the grid stores an
ordinary icon — it survives the plugin being uninstalled, travels in an export,
and is deduplicated by the profile's asset store like anything else. The other
side of that: changing a picture here does not change keys somebody has already
placed.

Nested paths are fine (`hardware/gauges/cpu.svg`); `..` is not, and a reference
containing one is refused rather than resolved.

See `src/infrastructure/plugins/plugin-assets.ts`.

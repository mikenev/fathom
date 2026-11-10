# Fathom

A calm, fullscreen browser aquarium built with Three.js. Leave it running like a classic desktop aquarium.

**Milestone 1:** the tropical coral reef scene with clownfish, blue tang, a lyretail anthias school and two blacktip reef sharks that cruise and never hunt. All models, textures and shaders are original and procedural.

## Run it

It is a static site with no build step. Serve the repo root and open `index.html`:

```sh
python3 -m http.server 8000
# then open http://localhost:8000/
```

Three.js r170 is vendored in `vendor/three/` (MIT license included), so nothing loads from a CDN.

## Controls

| Key | Action |
| --- | --- |
| `F` | Enter fullscreen |
| `S` | Open or close settings (the aquarium keeps running behind it) |
| `Esc` | Close settings if open, otherwise exit fullscreen |

The mouse is ignored: no camera drag, click or hover. The camera holds a mostly fixed view with a very slow drift.

## Settings

Settings cover the scene (only the reef in M1) and, per species, on/off plus a count. They save to `localStorage` under `fathom.settings.v1` and restore on the next visit. **Reset to reef preset** restores the defaults (6 clownfish, 4 blue tang, 18 anthias, 2 sharks). Added or removed fish fade in and out instead of popping.

## Layout

- `index.html`, `style.css`: page shell and settings overlay
- `src/main.js`: renderer, camera drift, keys, main loop
- `src/reef.js`: seafloor, coral, rocks, anemones, light rays, motes and bubbles
- `src/fish.js`: procedural species models and their colors
- `src/sim.js`: schooling, wandering and shark cruise behavior
- `src/shaders.js`: shared caustics and tail-wiggle shader patches
- `src/settings.js`: settings storage and panel

Browsers: desktop Chrome and Safari first.

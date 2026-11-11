# Fathom

A calm, fullscreen browser aquarium built with Three.js. Leave it running like a classic desktop aquarium.

Four scenes, each with its own species, lighting and particles. Sharks cruise and never hunt. All models, textures and shaders are original and procedural.

| Scene | Preset |
| --- | --- |
| Tropical coral reef | 6 clownfish, 4 blue tang, 18 lyretail anthias, 2 blacktip reef sharks |
| Open ocean | 40 Pacific sardines (bait ball), 6 yellowfin tuna, 2 scalloped hammerheads |
| Kelp forest | 5 garibaldi, 16 señorita, 4 kelp bass, 2 leopard sharks on the sandy bottom |
| Deep sea | 24 lanternfish, 10 Atlantic hatchetfish, 2 footballfish, 2 glowing velvet-belly lanternsharks |

The reef and kelp forest get caustics and god rays, the open ocean gets soft rays and faint caustics, and the deep sea has no sunlight: bioluminescent glow and drifting marine snow instead.

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
| Arrow keys | Move a focused slider (Tab through the settings) |

The mouse is ignored: no camera drag, click or hover. The camera holds a mostly fixed view with a very slow drift.

## Settings

Settings cover the scene and, per species in that scene, on/off plus a count. Each scene keeps its own counts. Everything saves to `localStorage` under `fathom.settings.v1` (M1 settings carry over) and restores on the next visit, including the chosen scene. **Reset this scene's preset** restores only the current scene's defaults. Switching scenes fades through dark, and added or removed fish fade in and out instead of popping.

The aquarium pauses while the tab is hidden and picks up where it left off. For previews, `?scene=ocean` opens a scene without changing the saved choice.

In Safari, the browser itself takes `Esc` in fullscreen, so one press exits fullscreen and also closes settings.

## Layout

- `index.html`, `style.css`: page shell and settings overlay
- `src/main.js`: renderer, camera drift, keys, main loop
- `src/scenes.js`: per-scene species, lighting, fog, bounds and environment builders (kelp, open water, deep sea)
- `src/reef.js`: shared backdrop, seafloor, rocks, light rays and particles, plus the reef's coral and anemones
- `src/fish.js`: procedural species models and their colors
- `src/sim.js`: schooling, wandering, territory and shark cruise behavior, plus glow halos
- `src/shaders.js`: shared caustics, glow and tail-wiggle shader patches
- `src/settings.js`: settings storage and panel

Browsers: desktop Chrome and Safari first.

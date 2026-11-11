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
| `M` | Sound on or off |
| `Esc` | Close settings if open, otherwise exit fullscreen |
| Arrow keys | Up and down move through the settings; left and right adjust a slider or change the scene |
| `Enter` | Open settings, or activate the focused control |

**Touch:** tap anywhere for small buttons (settings, fullscreen, next scene, sound) that hide again on their own. The settings panel has a close button, and tapping outside it closes it too.

**Fire TV and other remotes:** the D-pad moves through the settings and buttons with a visible focus ring, Select activates, left and right adjust sliders, and Back closes. Menu or Play/Pause toggles settings, and Select opens them when nothing is open. Fullscreen is optional; where the browser has none, its button and hint are hidden.

**Game controllers** (Gamepad API, standard layout): A selects, B goes back, Start toggles settings, and the D-pad or left stick navigates.

The mouse never moves the camera; a click only shows the buttons. Each scene has its own slow camera drift.

## Sound

Each scene has its own ambient sound, all synthesized live with Web Audio (no recordings): water swell, bubbles and reef crackle on the reef, a deep open-water swell, bubble vents in the kelp, and a low drone with distant echoing pings in the deep. Browsers only allow sound after a first tap, click or key, so it starts then. Sound crossfades with the scene, pauses with the tab, and its on/off choice is saved.

## Settings

Settings cover the scene and, per species in that scene, on/off plus a count. Each scene keeps its own counts. Everything saves to `localStorage` under `fathom.settings.v1` (older settings carry over) and restores on the next visit, including the chosen scene. **Reset this scene's preset** restores only the current scene's defaults. The species list follows a new scene choice right away. Switching scenes fades through dark, and added or removed fish fade in and out instead of popping.

The aquarium pauses while the tab is hidden and picks up where it left off. For previews, `?scene=ocean` opens a scene and saves nothing while previewing. `?fps=1` shows a frame-rate readout for checking the 60 fps target.

In Safari, the browser itself takes `Esc` in fullscreen, so one press exits fullscreen and also closes settings.

## Layout

- `index.html`, `style.css`: page shell and settings overlay
- `src/main.js`: renderer, camera drift, keys, remote, controller and touch controls, main loop
- `src/audio.js`: procedural ambient sound per scene
- `src/scenes.js`: per-scene species, lighting, fog, bounds and environment builders (kelp, open water, deep sea)
- `src/reef.js`: shared backdrop, seafloor, rocks, light rays and particles, plus the reef's coral and anemones
- `src/fish.js`: procedural species models and their colors
- `src/sim.js`: schooling, wandering, territory and shark cruise behavior, plus glow halos
- `src/shaders.js`: shared caustics, glow and tail-wiggle shader patches
- `src/settings.js`: settings storage and panel

Browsers: desktop Chrome and Safari first.

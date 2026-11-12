import * as THREE from 'three';
import { backdrop, rays } from './reef.js';
import { SCENES, SCENE_ORDER } from './scenes.js';
import { Aquarium } from './sim.js';
import { shared } from './shaders.js';
import * as Settings from './settings.js';
import { Ambience } from './audio.js';

const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(new THREE.Color().setRGB(0.12, 0.42, 0.52, THREE.LinearSRGBColorSpace), 0.034);
const hemi = new THREE.HemisphereLight(0x9fe6f2, 0x6a5a40, 1.15);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xe8fbff, 1.6);
sun.position.set(-8, 30, 6);
scene.add(sun);
const fill = new THREE.DirectionalLight(0x3a8fb0, 0.45);
fill.position.set(10, 4, 20);
scene.add(fill);
const sky = backdrop(scene.fog.color);
scene.add(sky);
const godRays = rays();
scene.add(godRays);

const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 900);

// Scenes -------------------------------------------------------------------
// Each scene's set and fish are built the first time it is shown, then kept,
// so switching back is instant. Only the visible scene simulates.
const worlds = {};
function world(key) {
  if (!worlds[key]) {
    const def = SCENES[key], group = new THREE.Group();
    const env = def.build(group);
    const tank = new Aquarium(group, env, def);
    scene.add(group);
    worlds[key] = { group, tank, fresh: true };
  }
  return worlds[key];
}
function applyLook(def) {
  scene.fog.color.copy(def.fog); // the backdrop shares this color object
  scene.fog.density = def.density;
  sky.material.uniforms.uSurf.value.set(...def.surf);
  sky.material.uniforms.uLow.value = def.low;
  sky.material.uniforms.uRipple.value = def.ripple;
  hemi.color.set(def.hemi[0]); hemi.groundColor.set(def.hemi[1]); hemi.intensity = def.hemi[2];
  sun.color.set(def.sun[0]); sun.intensity = def.sun[1];
  fill.color.set(def.fill[0]); fill.intensity = def.fill[1];
  godRays.userData.uniforms.uStrength.value = def.rays;
  godRays.visible = def.rays > 0;
  shared.uCausticScale.value = def.caustics;
}

const params = new URLSearchParams(location.search);
let settings = Settings.load();
// ?scene= opens a scene as a preview: nothing is saved while previewing.
const preview = !!SCENES[params.get('scene')];
if (preview) settings.scene = params.get('scene');
const persist = () => { if (!preview) Settings.save(settings); };
let current = null;
const tank = () => worlds[current].tank;
const audio = new Ambience();
audio.muted = settings.muted;

function applySettings(instant = false) {
  const sp = settings.scenes[current].species;
  for (const k of SCENES[current].species) tank().setTarget(k, sp[k].on ? sp[k].count : 0, instant);
}

// Settings panel ---------------------------------------------------------------
const panel = document.getElementById('settings');
const sceneSelect = document.getElementById('scene-select');
const soundBox = document.getElementById('sound-toggle');
for (const k of SCENE_ORDER) sceneSelect.add(new Option(SCENES[k].label, k));
let panelScene = null; // the scene the species list shows; it changes as soon as a switch starts
function rebuildPanel(key) {
  panelScene = key;
  sceneSelect.value = key;
  Settings.buildPanel(document.getElementById('species-list'), settings, key, () => { persist(); if (key === current) applySettings(); });
}
document.getElementById('reset-defaults').addEventListener('click', () => {
  Settings.resetScene(settings, panelScene);
  persist();
  rebuildPanel(panelScene);
  if (panelScene === current) applySettings();
});
document.getElementById('close-settings').addEventListener('click', () => setSettingsOpen(false));
soundBox.checked = !settings.muted;
soundBox.addEventListener('change', () => setMuted(!soundBox.checked));
function setMuted(m) {
  settings.muted = m;
  soundBox.checked = !m;
  audio.setMuted(m);
  persist();
  updateToolbar();
}

function showScene(key) {
  for (const k in worlds) worlds[k].group.visible = k === key;
  const w = world(key);
  w.group.visible = true;
  current = key;
  applyLook(SCENES[key]);
  applySettings(w.fresh);
  if (w.fresh) {
    // warm up so schools have formed before anyone sees them
    for (let i = 0; i < 240; i++) { t += 1 / 60; w.tank.update(1 / 60, t); }
    w.fresh = false;
  }
  audio.setScene(key);
  if (panelScene !== key) rebuildPanel(key);
}

// Switching fades through dark water, swaps scenes while hidden, then fades back.
const fade = document.getElementById('fade');
let switchToken = 0, switching = false;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// Resolve once the dark overlay is fully opaque (slow frames can stretch the CSS transition).
function fadedOut() {
  return new Promise((resolve) => {
    const start = performance.now();
    const check = () => {
      if (Number(getComputedStyle(fade).opacity) >= 0.999 || performance.now() - start > 3000) resolve();
      else requestAnimationFrame(check);
    };
    setTimeout(check, 850);
  });
}

async function switchScene(key) {
  if (!SCENES[key]) return;
  settings.scene = key;
  persist();
  if (panelScene !== key) rebuildPanel(key); // the species list follows the choice right away
  audio.setScene(key); // sound crossfades during the fade
  if (key === current) {
    // switched back before the fade finished: cancel the pending swap
    if (switching) { switchToken++; switching = false; fade.classList.remove('on'); }
    return;
  }
  const token = ++switchToken;
  switching = true;
  fade.classList.add('on');
  await fadedOut();
  if (token !== switchToken) return;
  showScene(key);
  placeCamera(t);
  renderer.render(scene, camera); // compile the new scene's shaders while still dark
  await wait(80);
  if (token !== switchToken) return;
  fade.classList.remove('on');
  switching = false;
}
sceneSelect.addEventListener('change', () => switchScene(sceneSelect.value));
const nextScene = (dir = 1) => SCENE_ORDER[(SCENE_ORDER.indexOf(settings.scene) + dir + SCENE_ORDER.length) % SCENE_ORDER.length];

// Camera: mostly locked, with a slow drift that differs per scene. No input moves it.
const look = new THREE.Vector3();
function placeCamera(t) {
  const c = SCENES[current].cam, s = t * c.k;
  camera.position.set(Math.sin(s * 0.013) * c.ax, c.y + Math.sin(s * 0.017 + 1) * c.ay, c.z + Math.sin(s * 0.009) * c.az);
  look.set(Math.sin(s * 0.0105 + 0.6) * c.lx, c.ly + Math.sin(s * 0.012) * 0.4, -10);
  camera.lookAt(look);
}

// Fullscreen -------------------------------------------------------------------
const isFullscreen = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
// TVs and some phones have no fullscreen API; everything else still works without it.
const fsSupported = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
async function enterFullscreen() {
  if (!fsSupported) return;
  const el = document.documentElement;
  try {
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    // Chrome: let Esc reach the page so it can close settings first (holding Esc still exits).
    if (navigator.keyboard?.lock) navigator.keyboard.lock(['Escape']).catch(() => {});
  } catch { /* the browser refused; stay windowed */ }
}
function exitFullscreen() {
  if (navigator.keyboard?.unlock) navigator.keyboard.unlock();
  try {
    if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
  } catch { /* ignore */ }
}
const toggleFullscreen = () => (isFullscreen() ? exitFullscreen() : enterFullscreen());

// Hint, toolbar and settings visibility ---------------------------------------------
const hint = document.getElementById('hint');
const coarse = matchMedia('(pointer: coarse)').matches;
hint.innerHTML = coarse ? 'Tap for controls'
  : (fsSupported ? 'Press <kbd>F</kbd> for fullscreen &middot; ' : '') + '<kbd>S</kbd> for settings &middot; <kbd>M</kbd> for sound';
let hintTimer = 0;
function showHint(ms = 7000) {
  hint.classList.add('show');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => hint.classList.remove('show'), ms);
}

const toolbar = document.getElementById('toolbar');
const tb = (act) => toolbar.querySelector(`[data-act=${act}]`);
if (!fsSupported) {
  tb('fullscreen').hidden = true;
  for (const el of document.querySelectorAll('.fs-only')) el.hidden = true;
}
let toolbarTimer = 0;
const toolbarShown = () => toolbar.classList.contains('show');
function showToolbar(ms = 4500) {
  if (settingsOpen()) return;
  hint.classList.remove('show');
  toolbar.classList.add('show');
  toolbar.inert = false;
  clearTimeout(toolbarTimer);
  toolbarTimer = setTimeout(hideToolbar, ms);
}
function hideToolbar() {
  clearTimeout(toolbarTimer);
  if (toolbar.contains(document.activeElement)) document.activeElement.blur();
  toolbar.classList.remove('show');
  toolbar.inert = true;
}
function updateToolbar() {
  const s = tb('sound');
  s.textContent = settings.muted ? 'Sound off' : 'Sound on';
  s.setAttribute('aria-pressed', String(!settings.muted));
  tb('fullscreen').textContent = isFullscreen() ? 'Exit fullscreen' : 'Fullscreen';
}
toolbar.addEventListener('click', (e) => {
  const act = e.target.closest('button')?.dataset.act;
  if (!act) return;
  if (act === 'settings') { hideToolbar(); setSettingsOpen(true, !e.detail); return; } // e.detail is 0 for keyboard or remote clicks
  if (act === 'fullscreen') toggleFullscreen();
  if (act === 'scene') switchScene(nextScene());
  if (act === 'sound') setMuted(!settings.muted);
  showToolbar();
});

function setSettingsOpen(open, focus = true) {
  panel.hidden = !open;
  document.body.classList.toggle('settings-open', open);
  if (open) {
    hint.classList.remove('show');
    hideToolbar();
    // Keys, the remote and controllers start on the scene list; touch doesn't take focus.
    if (focus) sceneSelect.focus({ preventScroll: true });
  } else if (document.activeElement && panel.contains(document.activeElement)) document.activeElement.blur();
}
const settingsOpen = () => !panel.hidden;

// Remote, keyboard and controller navigation ---------------------------------------
// D-pad up/down walk focus through the open panel or toolbar; left/right adjust a
// slider or the scene list; Select activates; Back closes.
function focusables() {
  const root = settingsOpen() ? panel : toolbarShown() ? toolbar : null;
  return root ? [...root.querySelectorAll('select, input, button')].filter((el) => !el.disabled && !el.hidden && el.offsetParent !== null) : [];
}
function moveFocus(dir) {
  const list = focusables();
  if (!list.length) return;
  let i = list.indexOf(document.activeElement);
  i = i < 0 ? 0 : Math.max(0, Math.min(list.length - 1, i + dir));
  list[i].focus({ preventScroll: true });
  list[i].scrollIntoView({ block: 'nearest' });
}
function adjust(el, dir) {
  if (el === sceneSelect) {
    const i = Math.max(0, Math.min(SCENE_ORDER.length - 1, sceneSelect.selectedIndex + dir));
    if (i !== sceneSelect.selectedIndex) { sceneSelect.selectedIndex = i; switchScene(sceneSelect.value); }
    return true;
  }
  if (el?.type === 'range') {
    const v = Math.max(Number(el.min), Math.min(Number(el.max), Number(el.value) + dir * Number(el.step || 1)));
    if (v !== Number(el.value)) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }
    return true;
  }
  return false;
}
function nav(action) {
  document.body.classList.add('nav'); // show focus rings for remote, keyboard and controller use
  const el = document.activeElement, open = settingsOpen(), inBar = toolbarShown();
  switch (action) {
    case 'up': case 'down': case 'left': case 'right': {
      const dir = action === 'up' || action === 'left' ? -1 : 1;
      if (!open && !inBar) { showToolbar(); tb('settings').focus(); return true; }
      if (inBar) showToolbar(); // keep it up while in use
      if (open && (action === 'left' || action === 'right') && adjust(el, dir)) return true;
      moveFocus(dir);
      return true;
    }
    case 'select':
      if (open || inBar) {
        const list = focusables();
        if (!list.includes(el)) { moveFocus(0); return true; }
        if (el.tagName === 'BUTTON' || el.type === 'checkbox') el.click();
        else if (el === sceneSelect) { sceneSelect.selectedIndex = (sceneSelect.selectedIndex + 1) % SCENE_ORDER.length; switchScene(sceneSelect.value); }
        return true;
      }
      setSettingsOpen(true);
      return true;
    case 'back':
      if (open) { setSettingsOpen(false); return true; }
      if (inBar) { hideToolbar(); return true; }
      if (isFullscreen()) { exitFullscreen(); return true; }
      return false;
    case 'menu': setSettingsOpen(!open); return true;
    case 'fullscreen': if (!isFullscreen()) enterFullscreen(); return true;
    case 'mute': setMuted(!settings.muted); showToolbar(); return true;
  }
  return false;
}

const BACK_KEYS = new Set(['Escape', 'Backspace', 'GoBack', 'BrowserBack']);
function keyAction(e) {
  const k = e.key, c = e.keyCode;
  if (BACK_KEYS.has(k) || c === 4) return 'back';
  if (k === 'ContextMenu' || k === 'MediaPlayPause' || c === 179 || (c === 82 && k !== 'r' && k !== 'R')) return 'menu';
  if (k === 'Enter') return 'select';
  if (k === 'ArrowUp') return 'up';
  if (k === 'ArrowDown') return 'down';
  if (k === 'ArrowLeft') return 'left';
  if (k === 'ArrowRight') return 'right';
  if (e.code === 'KeyS' || k === 's' || k === 'S') return 'menu';
  if (e.code === 'KeyF' || k === 'f' || k === 'F') return 'fullscreen';
  if (e.code === 'KeyM' || k === 'm' || k === 'M') return 'mute';
  return null;
}
// Some browsers swallow the keydown that lands during the fullscreen animation,
// so a key whose keydown never arrived is acted on at keyup instead.
const downSeen = new Set();
window.addEventListener('keydown', (e) => {
  audio.start();
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const a = keyAction(e);
  if (!a) return;
  downSeen.add(e.code || e.key);
  if (e.repeat && (a === 'menu' || a === 'fullscreen' || a === 'mute' || a === 'select' || a === 'back')) { e.preventDefault(); return; }
  if (nav(a)) e.preventDefault();
}, true);
window.addEventListener('keyup', (e) => {
  const id = e.code || e.key;
  if (downSeen.delete(id)) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const a = keyAction(e);
  if (a === 'menu' || a === 'mute') nav(a);
}, true);

// Gamepads: A selects, B goes back, Start toggles settings, D-pad or left stick navigates.
const pads = {};
function pollGamepads(now) {
  const list = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const gp of list) {
    if (!gp) continue;
    const b = (i) => !!gp.buttons[i]?.pressed, ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
    const dir = b(12) || ay < -0.6 ? 'up' : b(13) || ay > 0.6 ? 'down' : b(14) || ax < -0.6 ? 'left' : b(15) || ax > 0.6 ? 'right' : null;
    const cur = { a: b(0), b: b(1), start: b(9), dir };
    const prev = pads[gp.index] || { repeatAt: 0 };
    if ((cur.a && !prev.a) || (cur.b && !prev.b) || (cur.start && !prev.start) || (dir && !prev.dir)) audio.start();
    if (cur.a && !prev.a) nav('select');
    if (cur.b && !prev.b) nav('back');
    if (cur.start && !prev.start) nav('menu');
    if (dir && dir !== prev.dir) { nav(dir); cur.repeatAt = now + 420; }
    else if (dir && now >= prev.repeatAt) { nav(dir); cur.repeatAt = now + 140; }
    else cur.repeatAt = prev.repeatAt;
    pads[gp.index] = cur;
  }
}

// Touch and mouse: a tap shows the toolbar; a tap outside an open panel closes it.
window.addEventListener('pointerdown', (e) => {
  audio.start();
  document.body.classList.remove('nav');
  if (panel.contains(e.target)) return;
  if (toolbar.contains(e.target)) { showToolbar(); return; }
  if (settingsOpen()) { setSettingsOpen(false); return; }
  showToolbar();
});
// iOS unlocks audio only inside these events
window.addEventListener('touchend', () => audio.start(), { passive: true });
window.addEventListener('click', () => audio.start());

// Safari exits fullscreen on Esc before the page sees the key. If settings were
// open, close them in that same step so the panel is never left behind.
const onFsChange = () => {
  updateToolbar();
  if (!isFullscreen()) {
    if (settingsOpen() && !navigator.keyboard?.lock) setSettingsOpen(false);
    if (navigator.keyboard?.unlock) navigator.keyboard.unlock();
    if (!toolbarShown()) showHint(5000);
  } else hint.classList.remove('show');
};
document.addEventListener('fullscreenchange', onFsChange);
document.addEventListener('webkitfullscreenchange', onFsChange);
updateToolbar();
toolbar.inert = true;
showHint();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight, false);
});

// Optional frame-rate readout: ?fps=1
let fpsEl = null, fpsN = 0, fpsStart = performance.now(), fpsWorst = 0, fpsLast = performance.now(), fpsValue = 0;
if (params.get('fps') === '1') {
  fpsEl = document.createElement('div');
  fpsEl.className = 'fps';
  document.body.appendChild(fpsEl);
}
function countFrame(now) {
  fpsN++;
  fpsWorst = Math.max(fpsWorst, now - fpsLast);
  fpsLast = now;
  if (now - fpsStart >= 500) {
    fpsValue = (fpsN * 1000) / (now - fpsStart);
    if (fpsEl) fpsEl.textContent = `${fpsValue.toFixed(0)} fps · slowest frame ${fpsWorst.toFixed(0)} ms`;
    fpsN = 0; fpsStart = now; fpsWorst = 0;
  }
}

// Loop ---------------------------------------------------------------------
const clock = new THREE.Clock();
let t = 0;
if (params.has('t')) t = Number(params.get('t')) || 0; // start time offset, for previews
let rafId = 0;
function frame(now) {
  // clamp dt so a hidden tab or a hitch never teleports anything
  const dt = Math.min(clock.getDelta(), 1 / 20);
  t += dt;
  shared.uTime.value = t;
  tank().update(dt, t);
  placeCamera(t);
  renderer.render(scene, camera);
  pollGamepads(now);
  countFrame(now);
  rafId = requestAnimationFrame(frame);
}
showScene(settings.scene);
placeCamera(t);
rafId = requestAnimationFrame(frame);
requestAnimationFrame(() => requestAnimationFrame(() => { if (!switching) fade.classList.remove('on'); }));

// Pause (picture and sound) while the tab is hidden; resume without a jump.
document.addEventListener('visibilitychange', () => {
  audio.setHidden(document.hidden);
  if (document.hidden) { cancelAnimationFrame(rafId); rafId = 0; clock.stop(); }
  else if (!rafId) { clock.start(); fpsLast = fpsStart = performance.now(); fpsN = 0; rafId = requestAnimationFrame(frame); }
});

// Read-only status for automated checks.
window.fathom = Object.freeze({
  stats: () => tank().stats(),
  scene: () => current,
  panelScene: () => panelScene,
  switching: () => switching,
  paused: () => rafId === 0,
  settingsOpen,
  toolbarShown,
  isFullscreen,
  muted: () => settings.muted,
  audio: () => audio.ctx?.state ?? 'off',
  audioScene: () => audio.bed?.key ?? null,
  fps: () => fpsValue,
  camera: () => camera.position.toArray(),
  tris: () => renderer.info.render.triangles,
  // per fish: [species, roll, pitch] in radians, to check fish swim level
  poses: () => SCENES[current].species.flatMap((k) => tank().groups[k].agents.map((a) => [k, a.roll ?? 0, a.pitch ?? 0])),
  get time() { return t; },
  // QA only (?qa=1): run the visible scene's sim for `seconds` without drawing, optionally with every
  // species at its maximum, and report how deep any body got into rock, coral, kelp or the seabed,
  // plus the biggest step and turn in a single frame, to catch snapping and jitter.
  soak: (seconds, dt = 1 / 60, max = false) => {
    if (!new URLSearchParams(location.search).has('qa')) return null;
    const tk = tank(), keys = SCENES[current].species;
    if (max) for (const k of keys) tk.setTarget(k, tk.groups[k].sp.max, true);
    let time = tk.time, frames = 0, bad = 0, worst = 0, jump = 0, turn = 0, n = 0, flips = 0, jumpWho = '', turnWho = '', flipAt = null;
    const flipWho = {};
    const prev = new Map();
    for (let f = 0; f < seconds / dt; f++) {
      time += dt; tk.update(dt, time); frames++;
      let hit = false;
      for (const k of keys) for (const a of tk.groups[k].agents) {
        n++;
        const p = tk.penetration ? tk.penetration(a) : 0;
        if (p > 1e-3) { hit = true; worst = Math.max(worst, p); }
        const q = prev.get(a);
        if (q && a.scale > 0.5) {
          const v = Math.max(a.vel.length(), 0.3);
          const j = Math.hypot(a.pos.x - q[0], a.pos.y - q[1], a.pos.z - q[2]) / (v * dt);
          if (j > jump) { jump = j; jumpWho = k; }
          const w = Math.atan2(Math.sin(a.yaw - q[3]), Math.cos(a.yaw - q[3])) / dt;
          if (Math.abs(w) > turn) { turn = Math.abs(w); turnWho = k; }
          // jitter: the turn rate flipping hard from one side to the other between frames
          if (q[4] * w < 0 && Math.abs(q[4]) > 1 && Math.abs(w) > 1) { flips++; flipWho[k] = (flipWho[k] || 0) + 1; if (!flipAt) flipAt = [k, +time.toFixed(2), +a.pos.x.toFixed(2), +a.pos.y.toFixed(2), +a.pos.z.toFixed(2)]; }
          q[0] = a.pos.x; q[1] = a.pos.y; q[2] = a.pos.z; q[3] = a.yaw; q[4] = w;
        } else prev.set(a, [a.pos.x, a.pos.y, a.pos.z, a.yaw, 0]);
      }
      if (hit) bad++;
    }
    return { frames, bad, worst, jump, turn, flips, flipWho, flipAt, jumpWho, turnWho, checks: n, shapes: tk.field?.shapes.length ?? 0 };
  },
  snapshot: () => Object.fromEntries(SCENES[current].species.map((k) => [k, tank().groups[k].agents.map((a) => [a.pos.x, a.pos.y, a.pos.z])])),
});

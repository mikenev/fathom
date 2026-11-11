import * as THREE from 'three';
import { backdrop, rays } from './reef.js';
import { SCENES, SCENE_ORDER } from './scenes.js';
import { Aquarium } from './sim.js';
import { shared } from './shaders.js';
import * as Settings from './settings.js';

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
let savedScene = settings.scene;
if (SCENES[params.get('scene')]) settings.scene = params.get('scene'); // preview override, never saved
const persist = () => Settings.save({ ...settings, scene: savedScene });
let current = null;
const tank = () => worlds[current].tank;

function applySettings(instant = false) {
  const sp = settings.scenes[current].species;
  for (const k of SCENES[current].species) tank().setTarget(k, sp[k].on ? sp[k].count : 0, instant);
}
const panel = document.getElementById('settings');
const sceneSelect = document.getElementById('scene-select');
for (const k of SCENE_ORDER) sceneSelect.add(new Option(SCENES[k].label, k));
function rebuildPanel() {
  sceneSelect.value = current;
  Settings.buildPanel(document.getElementById('species-list'), settings, current, () => { persist(); applySettings(); });
}
document.getElementById('reset-defaults').addEventListener('click', () => {
  Settings.resetScene(settings, current);
  persist();
  rebuildPanel();
  applySettings();
});

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
  rebuildPanel();
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
  settings.scene = savedScene = key;
  persist();
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
  renderer.render(scene, camera); // compile the new scene's shaders while still dark
  await wait(80);
  if (token !== switchToken) return;
  fade.classList.remove('on');
  switching = false;
}
sceneSelect.addEventListener('change', () => switchScene(sceneSelect.value));

// Camera: mostly locked, with a very slow drift. No input moves it.
const look = new THREE.Vector3();
function placeCamera(t) {
  camera.position.set(Math.sin(t * 0.013) * 4, 5.2 + Math.sin(t * 0.017 + 1) * 0.8, 14 + Math.sin(t * 0.009) * 1.4);
  look.set(Math.sin(t * 0.0105 + 0.6) * 2.5, 3.6 + Math.sin(t * 0.012) * 0.4, -10);
  camera.lookAt(look);
}

// Controls -----------------------------------------------------------------
const hint = document.getElementById('hint');
let hintTimer = 0;
function showHint(ms = 7000) {
  hint.classList.add('show');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => hint.classList.remove('show'), ms);
}
const isFullscreen = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
async function enterFullscreen() {
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
  if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
  else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
}
function setSettingsOpen(open) {
  panel.hidden = !open;
  document.body.classList.toggle('settings-open', open);
  if (open) {
    hint.classList.remove('show');
    sceneSelect.focus({ preventScroll: true }); // Tab then reaches each checkbox and slider; arrows adjust them
  } else if (document.activeElement && panel.contains(document.activeElement)) document.activeElement.blur();
}
const settingsOpen = () => !panel.hidden;

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key;
  // Arrow, Home/End and Page keys belong to the focused control (sliders, the scene list).
  if (k === 'Escape') {
    e.preventDefault();
    if (settingsOpen()) setSettingsOpen(false);
    else if (isFullscreen()) exitFullscreen();
    return;
  }
  if (k === 's' || k === 'S') { e.preventDefault(); setSettingsOpen(!settingsOpen()); return; }
  if ((k === 'f' || k === 'F') && !isFullscreen()) { e.preventDefault(); enterFullscreen(); }
});
// Safari exits fullscreen on Esc before the page sees the key. If settings were
// open, close them in that same step so the panel is never left behind.
const onFsChange = () => {
  if (!isFullscreen()) {
    if (settingsOpen() && !navigator.keyboard?.lock) setSettingsOpen(false);
    if (navigator.keyboard?.unlock) navigator.keyboard.unlock();
    showHint(5000);
  } else hint.classList.remove('show');
};
document.addEventListener('fullscreenchange', onFsChange);
document.addEventListener('webkitfullscreenchange', onFsChange);
showHint();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight, false);
});

// Loop ---------------------------------------------------------------------
const clock = new THREE.Clock();
let t = 0;
if (params.has('t')) t = Number(params.get('t')) || 0; // start time offset, for previews
let rafId = 0;
function frame() {
  // clamp dt so a hidden tab or a hitch never teleports anything
  const dt = Math.min(clock.getDelta(), 1 / 20);
  t += dt;
  shared.uTime.value = t;
  tank().update(dt, t);
  placeCamera(t);
  renderer.render(scene, camera);
  rafId = requestAnimationFrame(frame);
}
showScene(settings.scene);
placeCamera(t);
rafId = requestAnimationFrame(frame);
requestAnimationFrame(() => requestAnimationFrame(() => { if (!switching) fade.classList.remove('on'); }));

// Pause while the tab is hidden; resume without a jump.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { cancelAnimationFrame(rafId); rafId = 0; clock.stop(); }
  else if (!rafId) { clock.start(); rafId = requestAnimationFrame(frame); }
});

// Read-only status for automated checks.
window.fathom = Object.freeze({
  stats: () => tank().stats(),
  scene: () => current,
  switching: () => switching,
  paused: () => rafId === 0,
  settingsOpen,
  isFullscreen,
  get time() { return t; },
  snapshot: () => Object.fromEntries(SCENES[current].species.map((k) => [k, tank().groups[k].agents.map((a) => [a.pos.x, a.pos.y, a.pos.z])])),
});

import * as THREE from 'three';
import { buildReef, WATER } from './reef.js';
import { Aquarium } from './sim.js';
import { shared } from './shaders.js';
import { SPECIES_ORDER } from './fish.js';
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
scene.add(new THREE.HemisphereLight(0x9fe6f2, 0x6a5a40, 1.15));
const sun = new THREE.DirectionalLight(0xe8fbff, 1.6);
sun.position.set(-8, 30, 6);
scene.add(sun);
const fill = new THREE.DirectionalLight(0x3a8fb0, 0.45);
fill.position.set(10, 4, 20);
scene.add(fill);

const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 900);
const reef = buildReef(scene);
const tank = new Aquarium(scene, reef);

let settings = Settings.load();
function applySettings(instant = false) {
  const sp = settings.scenes.reef.species;
  for (const k of SPECIES_ORDER) tank.setTarget(k, sp[k].on ? sp[k].count : 0, instant);
}
applySettings(true);

const panel = document.getElementById('settings');
Settings.buildPanel(document.getElementById('species-list'), settings, () => { Settings.save(settings); applySettings(); });
document.getElementById('reset-defaults').addEventListener('click', () => {
  settings = Settings.defaults();
  Settings.save(settings);
  Settings.buildPanel(document.getElementById('species-list'), settings, () => { Settings.save(settings); applySettings(); });
  applySettings();
});

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
  if (open) hint.classList.remove('show');
  else if (document.activeElement && panel.contains(document.activeElement)) document.activeElement.blur();
}
const settingsOpen = () => !panel.hidden;

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key;
  if (k === 'Escape') {
    e.preventDefault();
    if (settingsOpen()) setSettingsOpen(false);
    else if (isFullscreen()) exitFullscreen();
    return;
  }
  if (k === 's' || k === 'S') { e.preventDefault(); setSettingsOpen(!settingsOpen()); return; }
  if ((k === 'f' || k === 'F') && !isFullscreen()) { e.preventDefault(); enterFullscreen(); }
});
const onFsChange = () => {
  if (!isFullscreen()) {
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
const params = new URLSearchParams(location.search);
if (params.has('t')) t = Number(params.get('t')) || 0; // start time offset, for previews
function frame() {
  // clamp dt so a hidden tab or a hitch never teleports anything
  const dt = Math.min(clock.getDelta(), 1 / 20);
  t += dt;
  shared.uTime.value = t;
  tank.update(dt, t);
  placeCamera(t);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
// Warm up the simulation so schools have formed before the first frame.
for (let i = 0; i < 240; i++) { t += 1 / 60; tank.update(1 / 60, t); }
requestAnimationFrame(frame);

// Read-only status for automated checks.
window.fathom = Object.freeze({
  stats: () => tank.stats(),
  settingsOpen,
  isFullscreen,
  get time() { return t; },
  snapshot: () => Object.fromEntries(SPECIES_ORDER.map((k) => [k, tank.groups[k].agents.map((a) => [a.pos.x, a.pos.y, a.pos.z])])),
});

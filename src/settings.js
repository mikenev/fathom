import { SPECIES } from './fish.js';
import { SCENES, SCENE_ORDER } from './scenes.js';

const KEY = 'fathom.settings.v1';

function scenePreset(sceneKey) {
  const species = {};
  for (const k of SCENES[sceneKey].species) species[k] = { on: true, count: SPECIES[k].defaultCount };
  return { species };
}

export function defaults() {
  const scenes = {};
  for (const s of SCENE_ORDER) scenes[s] = scenePreset(s);
  return { version: 3, scene: 'reef', muted: false, scenes };
}

export function resetScene(state, sceneKey) {
  state.scenes[sceneKey] = scenePreset(sceneKey);
}

// Reads saved settings (M1's reef-only shape included), keeping only known scenes,
// known species and counts inside each species' range.
export function load() {
  const out = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return out;
    const s = JSON.parse(raw);
    if (SCENES[s?.scene]) out.scene = s.scene;
    out.muted = s?.muted === true;
    for (const sceneKey of SCENE_ORDER) {
      const src = s?.scenes?.[sceneKey]?.species || {};
      for (const k of SCENES[sceneKey].species) {
        const v = src[k];
        if (!v) continue;
        out.scenes[sceneKey].species[k] = {
          on: v.on !== false,
          count: Math.max(0, Math.min(SPECIES[k].max, Math.round(Number(v.count) || 0))),
        };
      }
    }
    return out;
  } catch {
    return out;
  }
}

export function save(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage may be unavailable; keep running */ }
}

export function buildPanel(root, state, sceneKey, onChange) {
  root.innerHTML = '';
  for (const k of SCENES[sceneKey].species) {
    const sp = SPECIES[k], cur = state.scenes[sceneKey].species[k];
    const el = document.createElement('div');
    el.className = 'species' + (cur.on ? '' : ' off');
    el.dataset.species = k;
    el.innerHTML = `
      <div class="top">
        <label class="name"><input type="checkbox" ${cur.on ? 'checked' : ''} aria-label="Show ${sp.label}"><span class="swatch" style="background:${sp.swatch}"></span><span>${sp.label}</span></label>
        <span class="count">${cur.count}</span>
      </div>
      <div class="role">${sp.role}</div>
      <input type="range" min="0" max="${sp.max}" step="1" value="${cur.count}" aria-label="${sp.label} count">`;
    const box = el.querySelector('input[type=checkbox]'), range = el.querySelector('input[type=range]'), count = el.querySelector('.count');
    box.addEventListener('change', () => { cur.on = box.checked; el.classList.toggle('off', !cur.on); onChange(); });
    range.addEventListener('input', () => { cur.count = Number(range.value); count.textContent = cur.count; onChange(); });
    root.appendChild(el);
  }
}

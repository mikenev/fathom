import { SPECIES, SPECIES_ORDER } from './fish.js';

const KEY = 'fathom.settings.v1';

export function defaults() {
  const species = {};
  for (const k of SPECIES_ORDER) species[k] = { on: true, count: SPECIES[k].defaultCount };
  return { version: 1, scene: 'reef', scenes: { reef: { species } } };
}

export function load() {
  const d = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return d;
    const s = JSON.parse(raw);
    const out = defaults();
    out.scene = s.scene === 'reef' ? 'reef' : 'reef';
    const src = s?.scenes?.reef?.species || {};
    for (const k of SPECIES_ORDER) {
      const v = src[k];
      if (!v) continue;
      out.scenes.reef.species[k] = {
        on: v.on !== false,
        count: Math.max(0, Math.min(SPECIES[k].max, Math.round(Number(v.count) || 0))),
      };
    }
    return out;
  } catch {
    return d;
  }
}

export function save(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage may be unavailable; keep running */ }
}

export function buildPanel(root, state, onChange) {
  root.innerHTML = '';
  for (const k of SPECIES_ORDER) {
    const sp = SPECIES[k], cur = state.scenes.reef.species[k];
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

import * as THREE from 'three';
import { mergeGeometries, paint, fin, glowPaint } from './geo.js';

const C = (h) => new THREE.Color(h);
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Body: an ellipsoid with a tapered tail stalk and a shaped head; +z is forward.
function body({ L, H, W, nose = 0.55, stalk = 0.22, hump = 0, seg = [28, 18] }, colorFn) {
  const g = new THREE.SphereGeometry(0.5, seg[0], seg[1]);
  g.rotateX(Math.PI / 2); // poles along z
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const t = v.z + 0.5; // 0 tail .. 1 nose
    let k = THREE.MathUtils.lerp(stalk, 1, sstep(0.0, 0.42, t));
    k *= THREE.MathUtils.lerp(1, nose, sstep(0.72, 1.0, t));
    const yUp = v.y > 0 ? 1 + hump * Math.sin(Math.PI * t) : 1;
    p.setXYZ(i, v.x * W * k, v.y * H * k * yUp, v.z * L);
  }
  g.computeVertexNormals();
  return paint(g, (pt, out) => colorFn(pt, out, { t: pt.z / L + 0.5, yn: pt.y / (H * 0.5) }));
}

function eyes(L, H, W, at = 0.83, r = 0.06) {
  const parts = [];
  for (const s of [-1, 1]) {
    const e = new THREE.SphereGeometry(r * L, 10, 8);
    e.translate(s * W * 0.33, H * 0.12, (at - 0.5) * L);
    parts.push(paint(e, (p, o) => o.set(0x0a0a0a)));
    const ring = new THREE.SphereGeometry(r * L * 1.25, 10, 8);
    ring.scale(0.6, 1, 1);
    ring.translate(s * W * 0.3, H * 0.12, (at - 0.5) * L);
    parts.push(paint(ring, (p, o) => o.set(0xd8c070)));
  }
  return parts;
}

const tailZ = (L) => -0.5 * L;

// A generic shark: heterocercal tail, two dorsals, pectorals and pelvics.
// colorFn(p, out, {t, yn}) paints the body; finColor(p, out) the fins.
function shark({ L, H, W, nose = 0.32, dorsal = 0.55, head = null, eyeAt = 0.9 }, colorFn, finColor, glowFn = null) {
  const b = body({ L, H, W, nose, stalk: 0.16, seg: [36, 20] }, colorFn);
  const z0 = tailZ(L), k = L / 3.6;
  const parts = [
    b,
    fin([[0, 0.02 * k, z0 + 0.1 * k], [0, 0.72 * k, z0 - 0.62 * k], [0, 0.6 * k, z0 - 0.68 * k], [0, 0.04 * k, z0 - 0.14 * k], [0, -0.44 * k, z0 - 0.42 * k], [0, -0.38 * k, z0 - 0.46 * k]], finColor),
    fin([[0, H * 0.42, 0.45 * k], [0, H * 0.5 + dorsal * k, -0.15 * k], [0, H * 0.5 + dorsal * 0.87 * k, -0.28 * k], [0, H * 0.36, -0.32 * k]], finColor),
    fin([[0, H * 0.3, -1.1 * k], [0, H * 0.3 + 0.18 * k, -1.28 * k], [0, H * 0.25, -1.34 * k]], finColor),
    fin([[W * 0.4, -H * 0.25, 0.75 * k], [W * 0.5 + 0.62 * k, -H * 0.5 - 0.22 * k, 0.2 * k], [W * 0.5 + 0.5 * k, -H * 0.5 - 0.2 * k, 0.08 * k], [W * 0.38, -H * 0.3, 0.32 * k]], finColor),
    fin([[-W * 0.4, -H * 0.25, 0.75 * k], [-W * 0.5 - 0.62 * k, -H * 0.5 - 0.22 * k, 0.2 * k], [-W * 0.5 - 0.5 * k, -H * 0.5 - 0.2 * k, 0.08 * k], [-W * 0.38, -H * 0.3, 0.32 * k]], finColor),
    fin([[W * 0.2, -H * 0.38, -0.7 * k], [W * 0.2 + 0.2 * k, -H * 0.38 - 0.16 * k, -0.95 * k], [W * 0.15, -H * 0.36, -0.98 * k]], finColor),
    fin([[-W * 0.2, -H * 0.38, -0.7 * k], [-W * 0.2 - 0.2 * k, -H * 0.38 - 0.16 * k, -0.95 * k], [-W * 0.15, -H * 0.36, -0.98 * k]], finColor),
  ];
  if (head === 'hammer') {
    // cephalofoil: a flat, swept wing across the snout with eyes at its tips
    const hw = W * 2.1, hz = 0.5 * L - 0.28 * k;
    const g = new THREE.SphereGeometry(0.5, 24, 10);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) * hw * 2, y = p.getY(i) * H * 0.32, z = p.getZ(i) * 0.36 * k;
      p.setXYZ(i, x, y + H * 0.05, z + hz - Math.abs(x) * 0.18);
    }
    g.computeVertexNormals();
    parts.push(paint(g, (pt, o) => colorFn(pt, o, { t: 0.95, yn: pt.y > H * 0.05 ? 0.6 : -0.5 })));
    for (const sx of [-1, 1]) {
      const e = new THREE.SphereGeometry(0.035 * k, 8, 6);
      e.translate(sx * hw * 0.98, H * 0.05, hz - hw * 0.18);
      parts.push(paint(e, (pt, o) => o.set(0x0a0a0a)));
    }
  } else {
    parts.push(...eyes(L, H, W * 0.95, eyeAt, 0.012));
  }
  const g = mergeGeometries(parts);
  return glowFn ? glowPaint(g, glowFn) : g;
}

const spots = (x, y, z, f, s) => Math.sin(x * f + s) * Math.sin(y * f * 1.3 + s * 2.1) * Math.sin(z * f * 0.9 + s * 0.7);

export const SPECIES = {
  clownfish: {
    label: 'Clownfish', role: 'Wanders near coral', swatch: '#ff7a1a',
    defaultCount: 6, max: 20, behavior: 'anemone', speed: [0.5, 1.1], length: 0.62, wiggle: 0.13, freq: 9,
    build() {
      const L = 0.62, H = 0.3, W = 0.16;
      const orange = C(0xff6a10), white = C(0xf7f7f2), black = C(0x161210);
      const bands = [0.8, 0.52, 0.16];
      const b = body({ L, H, W, nose: 0.6, stalk: 0.32 }, (p, o, { t }) => {
        o.copy(orange);
        for (const c of bands) {
          const d = Math.abs(t - c);
          if (d < 0.055) o.copy(white); else if (d < 0.075) o.copy(black);
        }
      });
      const fc = (p, o) => { o.copy(orange); if (p.y > H * 0.5 || p.z < tailZ(L) - 0.13) o.lerp(black, 0.7); };
      const z0 = tailZ(L);
      return mergeGeometries([
        b,
        fin([[0, 0, z0 + 0.05], [0, 0.14, z0 - 0.15], [0, 0.02, z0 - 0.19], [0, -0.14, z0 - 0.15]], fc),
        fin([[0, H * 0.42, 0.12], [0, H * 0.62, 0.04], [0, H * 0.6, -0.1], [0, H * 0.38, -0.2]], fc),
        fin([[W * 0.45, -0.03, 0.08], [W * 0.95, -0.1, -0.02], [W * 0.5, -0.08, -0.06]], fc),
        fin([[-W * 0.45, -0.03, 0.08], [-W * 0.95, -0.1, -0.02], [-W * 0.5, -0.08, -0.06]], fc),
        ...eyes(L, H, W, 0.84, 0.05),
      ]);
    },
  },
  blueTang: {
    label: 'Blue tang', role: 'Wanders the reef', swatch: '#2a5be0',
    defaultCount: 4, max: 16, behavior: 'wander', speed: [0.8, 1.6], length: 0.9, wiggle: 0.11, freq: 6.5,
    build() {
      const L = 0.9, H = 0.56, W = 0.14;
      const blue = C(0x2350d8), black = C(0x0d1020), yellow = C(0xffcf1f);
      const b = body({ L, H, W, nose: 0.5, stalk: 0.2, hump: 0.08 }, (p, o, { t, yn }) => {
        o.copy(blue);
        const curve = 0.15 + 0.35 * Math.sin(Math.PI * Math.min(1, Math.max(0, (t - 0.18) / 0.7)));
        if (t > 0.18 && t < 0.88 && Math.abs(yn - curve) < 0.16) o.copy(black);
        if (t > 0.6 && t < 0.8 && yn > 0.35 && yn < 0.6) o.copy(black);
        if (t < 0.1) o.copy(yellow);
      });
      const z0 = tailZ(L);
      const tail = (p, o) => { o.copy(yellow); if (Math.abs(p.y) > 0.14) o.lerp(black, 0.8); };
      const dors = (p, o) => { o.copy(blue); if (Math.abs(p.y) > H * 0.6) o.lerp(black, 0.85); };
      return mergeGeometries([
        b,
        fin([[0, 0, z0 + 0.06], [0, 0.2, z0 - 0.2], [0, 0.0, z0 - 0.12], [0, -0.2, z0 - 0.2]], tail),
        fin([[0, H * 0.45, 0.22], [0, H * 0.7, 0.05], [0, H * 0.62, -0.25], [0, H * 0.3, -0.36]], dors),
        fin([[0, -H * 0.45, 0.05], [0, -H * 0.68, -0.08], [0, -H * 0.6, -0.26], [0, -H * 0.3, -0.36]], dors),
        fin([[W * 0.45, -0.04, 0.12], [W * 1.2, -0.12, -0.04], [W * 0.5, -0.1, -0.08]], (p, o) => o.copy(yellow).lerp(blue, 0.3)),
        fin([[-W * 0.45, -0.04, 0.12], [-W * 1.2, -0.12, -0.04], [-W * 0.5, -0.1, -0.08]], (p, o) => o.copy(yellow).lerp(blue, 0.3)),
        ...eyes(L, H, W, 0.82, 0.045),
      ]);
    },
  },
  anthias: {
    label: 'Lyretail anthias', role: 'Schools in midwater', swatch: '#ff7f6a',
    defaultCount: 18, max: 60, behavior: 'school', speed: [1.0, 1.9], length: 0.42, wiggle: 0.14, freq: 11,
    build() {
      const L = 0.42, H = 0.15, W = 0.08;
      const peach = C(0xff7a58), belly = C(0xffc49a), magenta = C(0xe0448a), lilac = C(0xb06ad8);
      const b = body({ L, H, W, nose: 0.55, stalk: 0.28 }, (p, o, { t, yn }) => {
        o.copy(peach).lerp(belly, Math.max(0, -yn) * 0.8);
        if (t > 0.62 && t < 0.9 && Math.abs(yn + 0.05 - (t - 0.62) * 0.8) < 0.07) o.copy(lilac);
      });
      const z0 = tailZ(L);
      const fc = (p, o) => o.copy(magenta).lerp(peach, 0.25);
      return mergeGeometries([
        b,
        fin([[0, 0, z0 + 0.03], [0, 0.13, z0 - 0.2], [0, 0.03, z0 - 0.08], [0, -0.03, z0 - 0.08], [0, -0.13, z0 - 0.2]], fc),
        fin([[0, H * 0.42, 0.1], [0, H * 0.95, 0.07], [0, H * 0.6, -0.02], [0, H * 0.4, -0.14]], fc),
        fin([[W * 0.45, -0.02, 0.05], [W * 1.1, -0.06, -0.03], [W * 0.5, -0.05, -0.04]], fc),
        fin([[-W * 0.45, -0.02, 0.05], [-W * 1.1, -0.06, -0.03], [-W * 0.5, -0.05, -0.04]], fc),
        ...eyes(L, H, W, 0.85, 0.055),
      ]);
    },
  },
  blacktip: {
    label: 'Blacktip reef shark', role: 'Cruises the reef edge', swatch: '#8d9496',
    defaultCount: 2, max: 4, behavior: 'cruise', speed: [1.6, 2.1], length: 3.6, wiggle: 0.1, freq: 2.4,
    build() {
      const L = 3.6, H = 0.52, W = 0.5;
      const top = C(0x7f8784), side = C(0xa3a89f), belly = C(0xeef0ea), black = C(0x121414);
      const b = body({ L, H, W, nose: 0.32, stalk: 0.16, seg: [36, 20] }, (p, o, { t, yn }) => {
        o.copy(top).lerp(side, sstep(0.3, -0.05, yn));
        if (yn < -0.15) o.lerp(belly, sstep(-0.15, -0.35, yn));
        if (t > 0.86 && t < 0.89 && Math.abs(p.x) > W * 0.15 && yn > -0.2) o.multiplyScalar(0.7); // gill hint
      });
      const z0 = tailZ(L);
      const tipped = (tip) => (p, o) => { o.copy(top); if (p.y < -0.05) o.lerp(belly, 0.6); if (tip(p)) o.copy(black); };
      const dorsalTip = (p) => p.y > H * 0.5 + 0.38;
      const caudal = (p) => p.y > 0.55 || p.y < -0.36;
      const pect = (p) => Math.abs(p.x) > W * 0.5 + 0.48;
      return mergeGeometries([
        b,
        // heterocercal tail: tall upper lobe
        fin([[0, 0.02, z0 + 0.1], [0, 0.72, z0 - 0.62], [0, 0.6, z0 - 0.68], [0, 0.04, z0 - 0.14], [0, -0.44, z0 - 0.42], [0, -0.38, z0 - 0.46]], tipped(caudal)),
        fin([[0, H * 0.42, 0.45], [0, H * 0.5 + 0.55, -0.15], [0, H * 0.5 + 0.48, -0.28], [0, H * 0.36, -0.32]], tipped(dorsalTip)),
        fin([[0, H * 0.3, -1.1], [0, H * 0.3 + 0.18, -1.28], [0, H * 0.25, -1.34]], tipped(() => false)),
        fin([[W * 0.4, -H * 0.25, 0.75], [W * 0.5 + 0.62, -H * 0.5 - 0.22, 0.2], [W * 0.5 + 0.5, -H * 0.5 - 0.2, 0.08], [W * 0.38, -H * 0.3, 0.32]], tipped(pect)),
        fin([[-W * 0.4, -H * 0.25, 0.75], [-W * 0.5 - 0.62, -H * 0.5 - 0.22, 0.2], [-W * 0.5 - 0.5, -H * 0.5 - 0.2, 0.08], [-W * 0.38, -H * 0.3, 0.32]], tipped(pect)),
        fin([[W * 0.2, -H * 0.38, -0.7], [W * 0.2 + 0.2, -H * 0.38 - 0.16, -0.95], [W * 0.15, -H * 0.36, -0.98]], tipped(() => false)),
        fin([[-W * 0.2, -H * 0.38, -0.7], [-W * 0.2 - 0.2, -H * 0.38 - 0.16, -0.95], [-W * 0.15, -H * 0.36, -0.98]], tipped(() => false)),
        ...eyes(L, H, W * 0.95, 0.9, 0.012),
      ]);
    },
  },
  // Open ocean -------------------------------------------------------------
  sardine: {
    label: 'Pacific sardine', role: 'Tight bait-ball school', swatch: '#9fb7c4',
    defaultCount: 40, max: 120, behavior: 'school', speed: [1.2, 2.1], length: 0.32, wiggle: 0.14, freq: 13,
    mat: { metalness: 0.45, roughness: 0.3 }, school: { radius: 8, sep: 0.4, coh: 2.2, pull: 0.5, maxAcc: 4 },
    build() {
      const L = 0.32, H = 0.08, W = 0.055;
      const back = C(0x24566e), silver = C(0xd2dce0), belly = C(0xf4f6f6), dot = C(0x1a2a34);
      const b = body({ L, H, W, nose: 0.5, stalk: 0.26 }, (p, o, { t, yn }) => {
        o.copy(silver).lerp(back, sstep(0.1, 0.55, yn)).lerp(belly, sstep(-0.1, -0.6, yn));
        if (yn > 0.05 && yn < 0.3 && t > 0.35 && t < 0.78 && Math.sin(t * 90) > 0.75) o.copy(dot);
      });
      const z0 = tailZ(L);
      const fc = (p, o) => o.copy(silver).lerp(back, 0.4);
      return mergeGeometries([
        b,
        fin([[0, 0, z0 + 0.03], [0, 0.07, z0 - 0.09], [0, 0.0, z0 - 0.04], [0, -0.07, z0 - 0.09]], fc),
        fin([[0, H * 0.45, 0.03], [0, H * 0.9, -0.01], [0, H * 0.4, -0.05]], fc),
        ...eyes(L, H, W, 0.86, 0.06),
      ]);
    },
  },
  tuna: {
    label: 'Yellowfin tuna', role: 'Loose hunting school', swatch: '#e8c020',
    defaultCount: 6, max: 14, behavior: 'wander', speed: [1.7, 2.7], length: 1.7, wiggle: 0.06, freq: 4.2, scale: 1.0,
    mat: { metalness: 0.35, roughness: 0.32 },
    build() {
      const L = 1.7, H = 0.44, W = 0.32;
      const back = C(0x15244e), silver = C(0xc4ccd2), belly = C(0xeef0f0), yellow = C(0xf2c41c);
      const b = body({ L, H, W, nose: 0.42, stalk: 0.1, seg: [32, 18] }, (p, o, { t, yn }) => {
        o.copy(silver).lerp(back, sstep(0.05, 0.4, yn)).lerp(belly, sstep(-0.2, -0.7, yn));
        if (Math.abs(yn - 0.12) < 0.06 && t > 0.25 && t < 0.85) o.lerp(yellow, 0.75);
      });
      const z0 = tailZ(L), y = (p, o) => o.copy(yellow);
      const parts = [
        b,
        // lunate tail
        fin([[0, 0, z0 + 0.04], [0, 0.42, z0 - 0.2], [0, 0.36, z0 - 0.26], [0, 0.03, z0 - 0.08], [0, -0.36, z0 - 0.26], [0, -0.42, z0 - 0.2]], (p, o) => o.copy(back).lerp(silver, 0.2)),
        fin([[0, H * 0.4, 0.3], [0, H * 0.4 + 0.18, 0.22], [0, H * 0.42, 0.04]], (p, o) => o.copy(back)),
        // long sickle second dorsal and anal fins
        fin([[0, H * 0.38, -0.02], [0, H * 0.38 + 0.42, -0.32], [0, H * 0.3, -0.2]], y),
        fin([[0, -H * 0.38, -0.02], [0, -H * 0.38 - 0.42, -0.32], [0, -H * 0.3, -0.2]], y),
        fin([[W * 0.42, 0.0, 0.42], [W * 0.5 + 0.35, -0.04, 0.0], [W * 0.45, -0.03, 0.26]], (p, o) => o.copy(back).lerp(silver, 0.3)),
        fin([[-W * 0.42, 0.0, 0.42], [-W * 0.5 - 0.35, -0.04, 0.0], [-W * 0.45, -0.03, 0.26]], (p, o) => o.copy(back).lerp(silver, 0.3)),
        ...eyes(L, H, W, 0.88, 0.028),
      ];
      // yellow finlets along the tail stalk
      for (let i = 0; i < 6; i++) {
        const z = -0.32 - i * 0.07, h = H * 0.42 * (1 - i * 0.12);
        parts.push(fin([[0, h, z], [0, h + 0.05, z - 0.03], [0, h - 0.01, z - 0.05]], y));
        parts.push(fin([[0, -h, z], [0, -h - 0.05, z - 0.03], [0, -h + 0.01, z - 0.05]], y));
      }
      return mergeGeometries(parts);
    },
  },
  hammerhead: {
    label: 'Scalloped hammerhead', role: 'Cruises in a slow loop', swatch: '#8a8a7c',
    defaultCount: 2, max: 4, behavior: 'cruise', speed: [1.5, 2.0], length: 3.9, wiggle: 0.1, freq: 2.2,
    mat: { roughness: 0.55 }, path: { y: 7.5, yAmp: 2.0, rx: 22, rz: 11, cz: -13 },
    build() {
      const top = C(0x6e6f64), side = C(0x9a9a8c), belly = C(0xeceee6);
      const col = (p, o, { yn }) => { o.copy(top).lerp(side, sstep(0.3, -0.05, yn)); if (yn < -0.15) o.lerp(belly, sstep(-0.15, -0.35, yn)); };
      return shark({ L: 3.9, H: 0.54, W: 0.48, nose: 0.4, dorsal: 0.85, head: 'hammer' }, col, (p, o) => { o.copy(top); if (p.y < -0.05) o.lerp(belly, 0.5); });
    },
  },
  // Kelp forest ------------------------------------------------------------
  garibaldi: {
    label: 'Garibaldi', role: 'Wanders a small territory', swatch: '#ff6a00',
    defaultCount: 5, max: 14, behavior: 'territory', speed: [0.45, 1.0], length: 0.6, wiggle: 0.12, freq: 7, homeR: 2.4,
    build() {
      const L = 0.6, H = 0.36, W = 0.15;
      const orange = C(0xff5e00), deep = C(0xe04800);
      const b = body({ L, H, W, nose: 0.62, stalk: 0.36, hump: 0.06 }, (p, o, { yn }) => o.copy(orange).lerp(deep, Math.max(0, yn) * 0.4));
      const z0 = tailZ(L), fc = (p, o) => o.copy(deep);
      return mergeGeometries([
        b,
        fin([[0, 0, z0 + 0.04], [0, 0.15, z0 - 0.12], [0, 0.05, z0 - 0.19], [0, -0.05, z0 - 0.19], [0, -0.15, z0 - 0.12]], fc),
        fin([[0, H * 0.44, 0.14], [0, H * 0.66, 0.02], [0, H * 0.62, -0.16], [0, H * 0.36, -0.24]], fc),
        fin([[0, -H * 0.44, 0.0], [0, -H * 0.64, -0.1], [0, -H * 0.34, -0.22]], fc),
        fin([[W * 0.45, -0.03, 0.08], [W * 1.0, -0.1, -0.03], [W * 0.5, -0.08, -0.06]], fc),
        fin([[-W * 0.45, -0.03, 0.08], [-W * 1.0, -0.1, -0.03], [-W * 0.5, -0.08, -0.06]], fc),
        ...eyes(L, H, W, 0.84, 0.05),
      ]);
    },
  },
  senorita: {
    label: 'Señorita', role: 'Schools through the kelp', swatch: '#f0b040',
    defaultCount: 16, max: 48, behavior: 'school', speed: [1.0, 1.8], length: 0.42, wiggle: 0.14, freq: 10,
    build() {
      const L = 0.42, H = 0.09, W = 0.07;
      const gold = C(0xe8a83a), cream = C(0xf6e6c4), black = C(0x141010);
      const b = body({ L, H, W, nose: 0.5, stalk: 0.3 }, (p, o, { t, yn }) => {
        o.copy(gold).lerp(cream, sstep(0.0, -0.6, yn));
        if (t > 0.05 && t < 0.13 && Math.abs(yn) < 0.4) o.copy(black); // dark spot at the tail base
      });
      const z0 = tailZ(L), fc = (p, o) => o.copy(gold).lerp(cream, 0.4);
      return mergeGeometries([
        b,
        fin([[0, 0, z0 + 0.04], [0, 0.06, z0 - 0.07], [0, -0.06, z0 - 0.07]], fc),
        fin([[0, H * 0.45, 0.1], [0, H * 0.75, 0.0], [0, H * 0.4, -0.13]], fc),
        ...eyes(L, H, W, 0.87, 0.05),
      ]);
    },
  },
  kelpBass: {
    label: 'Kelp bass', role: 'Wanders the holdfasts', swatch: '#7a7048',
    defaultCount: 4, max: 10, behavior: 'territory', speed: [0.6, 1.3], length: 0.9, wiggle: 0.1, freq: 5.5, homeR: 5, scale: 1.2,
    build() {
      const L = 0.9, H = 0.26, W = 0.15;
      const olive = C(0x5e5838), pale = C(0xc8c098), belly = C(0xe2dcc0);
      const b = body({ L, H, W, nose: 0.5, stalk: 0.24 }, (p, o, { yn }) => {
        o.copy(olive).lerp(belly, sstep(-0.1, -0.6, yn));
        if (yn > -0.1 && spots(p.x * 3, p.y * 3, p.z, 22, 1.7) > 0.2) o.lerp(pale, 0.65);
      });
      const z0 = tailZ(L), fc = (p, o) => o.copy(olive).lerp(pale, 0.2);
      return mergeGeometries([
        b,
        fin([[0, 0, z0 + 0.05], [0, 0.16, z0 - 0.16], [0, 0.0, z0 - 0.13], [0, -0.16, z0 - 0.16]], fc),
        fin([[0, H * 0.42, 0.2], [0, H * 0.42 + 0.14, 0.14], [0, H * 0.42 + 0.12, 0.02], [0, H * 0.42 + 0.13, -0.08], [0, H * 0.4, -0.2]], fc),
        fin([[W * 0.45, -0.03, 0.14], [W * 1.0, -0.1, 0.0], [W * 0.5, -0.08, -0.02]], fc),
        fin([[-W * 0.45, -0.03, 0.14], [-W * 1.0, -0.1, 0.0], [-W * 0.5, -0.08, -0.02]], fc),
        ...eyes(L, H, W, 0.86, 0.04),
      ]);
    },
  },
  leopardShark: {
    label: 'Leopard shark', role: 'Cruises the sandy bottom', swatch: '#9a8a6a',
    defaultCount: 2, max: 4, behavior: 'cruise', speed: [1.1, 1.5], length: 2.8, wiggle: 0.115, freq: 2.6,
    mat: { roughness: 0.6 }, path: { bottom: 1.0, yAmp: 0.35, dive: 0.5, rx: 18, rz: 9, cz: -11 },
    build() {
      const top = C(0x8c7e62), belly = C(0xece6d6), dark = C(0x2a2018);
      const col = (p, o, { t, yn }) => {
        o.copy(top);
        if (yn < -0.1) o.lerp(belly, sstep(-0.1, -0.35, yn));
        else if (Math.sin(t * 44) > 0.72 || spots(p.x, p.y, p.z, 9, 0.4) > 0.35) o.copy(dark).lerp(top, 0.25); // saddles and spots
      };
      return shark({ L: 2.8, H: 0.36, W: 0.4, nose: 0.42, dorsal: 0.42 }, col, (p, o) => { o.copy(top); if (spots(p.x, p.y, p.z, 12, 2) > 0.4) o.copy(dark); });
    },
  },
  // Deep sea ---------------------------------------------------------------
  lanternfish: {
    label: 'Lanternfish', role: 'Glowing midwater school', swatch: '#6fd8ff',
    defaultCount: 24, max: 60, behavior: 'school', speed: [0.8, 1.4], length: 0.3, wiggle: 0.14, freq: 10,
    glow: 0x4fd8ff, mat: { metalness: 0.4, roughness: 0.35 }, school: { radius: 5, sep: 0.6, coh: 0.6, pull: 0.15 },
    build() {
      const L = 0.3, H = 0.09, W = 0.06;
      const dark = C(0x1c2634), silver = C(0x8a9aa8);
      const b = body({ L, H, W, nose: 0.75, stalk: 0.3 }, (p, o, { yn }) => o.copy(dark).lerp(silver, sstep(0.2, -0.6, yn)));
      const z0 = tailZ(L), fc = (p, o) => o.copy(dark);
      const g = mergeGeometries([
        b,
        fin([[0, 0, z0 + 0.03], [0, 0.06, z0 - 0.07], [0, -0.06, z0 - 0.07]], fc),
        fin([[0, H * 0.45, 0.04], [0, H * 0.75, -0.02], [0, H * 0.4, -0.06]], fc),
        ...eyes(L, H, W, 0.86, 0.08),
      ]);
      // rows of photophores along the belly and flank
      return glowPaint(g, (p) => {
        const t = p.z / L + 0.5, yn = p.y / (H * 0.5);
        const row = (Math.abs(yn + 0.6) < 0.16 || Math.abs(yn + 0.15) < 0.1) && Math.abs(p.x) > 0.008;
        return row && t > 0.12 && t < 0.82 && Math.sin(t * 70) > 0.3 ? 1 : 0;
      });
    },
  },
  hatchetfish: {
    label: 'Atlantic hatchetfish', role: 'Loose glowing school', swatch: '#9ab8ff',
    defaultCount: 10, max: 24, behavior: 'school', speed: [0.4, 0.9], length: 0.3, wiggle: 0.12, freq: 8,
    glow: 0x6fb0ff, mat: { metalness: 0.6, roughness: 0.25 }, school: { radius: 7, sep: 1.3, coh: 0.25, pull: 0.08 },
    build() {
      const L = 0.3, H = 0.26, W = 0.04;
      const silver = C(0xb8c4cc), back = C(0x3a4450);
      const b = body({ L, H, W, nose: 0.5, stalk: 0.18 }, (p, o, { yn }) => o.copy(silver).lerp(back, sstep(0.4, 0.9, yn)));
      // the deep 'hatchet' keel: push the lower front of the body down
      const pp = b.attributes.position;
      for (let i = 0; i < pp.count; i++) {
        const y = pp.getY(i), z = pp.getZ(i);
        if (y < 0) pp.setY(i, y * (1 + 0.6 * sstep(-0.1, 0.08, z)));
      }
      b.computeVertexNormals();
      const z0 = tailZ(L), fc = (p, o) => o.copy(silver).multiplyScalar(0.7);
      const g = mergeGeometries([
        b,
        fin([[0, 0, z0 + 0.03], [0, 0.06, z0 - 0.07], [0, -0.06, z0 - 0.07]], fc),
        fin([[0, H * 0.45, 0.0], [0, H * 0.7, -0.04], [0, H * 0.4, -0.07]], fc),
        ...eyes(L, H, W * 1.4, 0.82, 0.09),
      ]);
      return glowPaint(g, (p) => (p.y < -H * 0.42 && Math.sin((p.z / L) * 60) > 0 ? 1 : 0));
    },
  },
  footballfish: {
    label: 'Footballfish (anglerfish)', role: 'Slow wander in the dark', swatch: '#c0f4ff',
    defaultCount: 2, max: 4, behavior: 'wander', speed: [0.22, 0.45], length: 0.75, wiggle: 0.08, freq: 3, scale: 1.3,
    glow: 0x9ff0ff, mat: { roughness: 0.8 }, halo: { size: 1.4, offset: [0, 0.434, 0.64] },
    build() {
      const L = 0.75, H = 0.62, W = 0.56;
      const dark = C(0x241a14), brown = C(0x3a2a20);
      const b = body({ L, H, W, nose: 0.85, stalk: 0.3, seg: [24, 16] }, (p, o) => o.copy(dark).lerp(brown, spots(p.x, p.y, p.z, 30, 1) * 0.5 + 0.5));
      const z0 = tailZ(L), fc = (p, o) => o.copy(dark);
      const parts = [
        b,
        fin([[0, 0, z0 + 0.06], [0, 0.12, z0 - 0.12], [0, -0.12, z0 - 0.12]], fc),
        fin([[W * 0.45, -0.04, 0.0], [W * 0.75, -0.1, -0.08], [W * 0.45, -0.1, -0.1]], fc),
        fin([[-W * 0.45, -0.04, 0.0], [-W * 0.75, -0.1, -0.08], [-W * 0.45, -0.1, -0.1]], fc),
        ...eyes(L, H, W * 0.8, 0.82, 0.02),
      ];
      // the lure: a thin rod curving forward with a glowing bulb
      const rod = new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, H * 0.45, 0.18), new THREE.Vector3(0, H * 0.95, 0.3), new THREE.Vector3(0, H * 0.7, 0.62)), 10, 0.008, 4);
      parts.push(paint(rod, (p, o) => o.copy(brown)));
      const bulb = new THREE.SphereGeometry(0.045, 10, 8); bulb.translate(0, H * 0.7, 0.64);
      parts.push(paint(bulb, (p, o) => o.set(0xd8fbff)));
      const g = mergeGeometries(parts);
      return glowPaint(g, (p) => (Math.hypot(p.x, p.y - H * 0.7, p.z - 0.64) < 0.05 ? 1 : 0));
    },
  },
  lanternshark: {
    label: 'Velvet-belly lanternshark', role: 'Glowing cruise', swatch: '#4fd0ff',
    defaultCount: 2, max: 4, behavior: 'cruise', speed: [0.9, 1.3], length: 1.7, wiggle: 0.115, freq: 3.0,
    glow: 0x3fc8ff, mat: { roughness: 0.7 }, path: { y: 5.5, yAmp: 1.6, rx: 14, rz: 8, cz: -9 },
    build() {
      const L = 1.7, H = 0.26, W = 0.26;
      const brown = C(0x2e2620), black = C(0x0c0a0a);
      const col = (p, o, { yn }) => o.copy(brown).lerp(black, sstep(0.0, -0.4, yn));
      return shark({ L, H, W, nose: 0.45, dorsal: 0.3, eyeAt: 0.88 }, col, (p, o) => o.copy(brown),
        (p) => { const yn = p.y / (H * 0.5), t = p.z / L + 0.5; return yn < -0.35 && t > 0.15 && t < 0.85 && p.z > -L * 0.5 ? 0.75 + 0.25 * Math.sin(t * 40) : 0; });
    },
  },
};

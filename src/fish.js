import * as THREE from 'three';
import { mergeGeometries, paint, fin } from './geo.js';

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
    defaultCount: 2, max: 4, behavior: 'cruise', speed: [1.6, 2.1], length: 3.6, wiggle: 0.07, freq: 2.2,
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
};

export const SPECIES_ORDER = ['clownfish', 'blueTang', 'anthias', 'blacktip'];

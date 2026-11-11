import * as THREE from 'three';
import { mergeGeometries, paint, rng } from './geo.js';
import { patchMaterial } from './shaders.js';
import { buildReef, seafloor, rock, particles } from './reef.js';

const lin = (r, g, b) => new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace);
const noFloor = () => -100;

// Look and preset for each scene. Lighting, fog, rays and caustics are shared
// objects in main.js; a scene only says how to tint them.
export const SCENES = {
  reef: {
    label: 'Tropical coral reef',
    species: ['clownfish', 'blueTang', 'anthias', 'blacktip'],
    fog: lin(0.12, 0.42, 0.52), density: 0.034, surf: [0.2, 0.62, 0.72], low: 0.55, ripple: 0.03,
    hemi: [0x9fe6f2, 0x6a5a40, 1.15], sun: [0xe8fbff, 1.6], fill: [0x3a8fb0, 0.45],
    rays: 1, caustics: 1, bounds: { minY: 0.6 }, schoolY: 5.5,
    cam: { ax: 4, y: 5.2, ay: 0.8, z: 14, az: 1.4, k: 1, lx: 2.5, ly: 3.6 },
    build: (g) => buildReef(g),
  },
  ocean: {
    label: 'Open ocean',
    species: ['sardine', 'tuna', 'hammerhead'],
    fog: lin(0.03, 0.2, 0.42), density: 0.026, surf: [0.1, 0.45, 0.72], low: 0.3, ripple: 0.035,
    hemi: [0x8fd0f0, 0x0a2440, 1.1], sun: [0xe8fbff, 1.5], fill: [0x2a70b0, 0.4],
    rays: 1.15, caustics: 0.35, bounds: { minY: -5 }, schoolY: 5,
    cam: { ax: 6, y: 5.6, ay: 1.2, z: 16, az: 2, k: 0.7, lx: 3.5, ly: 5 },
    build: buildOcean,
  },
  kelp: {
    label: 'Kelp forest',
    species: ['garibaldi', 'senorita', 'kelpBass', 'leopardShark'],
    fog: lin(0.07, 0.27, 0.24), density: 0.04, surf: [0.24, 0.55, 0.44], low: 0.5, ripple: 0.03,
    hemi: [0xbfe8c8, 0x5a5030, 1.05], sun: [0xf2f8d8, 1.5], fill: [0x3a9080, 0.35],
    rays: 0.9, caustics: 0.8, bounds: { minY: 0.6 }, schoolY: 5,
    cam: { ax: 3, y: 3.6, ay: 0.5, z: 13, az: 1, k: 0.85, lx: 2, ly: 3.2 },
    build: buildKelp,
  },
  deep: {
    label: 'Deep sea',
    species: ['lanternfish', 'hatchetfish', 'footballfish', 'lanternshark'],
    fog: lin(0.003, 0.009, 0.02), density: 0.042, surf: [0.008, 0.025, 0.05], low: 0.4, ripple: 0,
    hemi: [0x30507a, 0x000000, 0.4], sun: [0xbfd8ff, 0.06], fill: [0x2050a0, 0.3],
    rays: 0, caustics: 0, bounds: { minY: -5 }, schoolY: 5,
    cam: { ax: 2, y: 5, ay: 0.4, z: 12, az: 0.8, k: 0.5, lx: 1.2, ly: 5 },
    build: buildDeep,
  },
};
export const SCENE_ORDER = ['reef', 'ocean', 'kelp', 'deep'];

function buildOcean(group) {
  // open blue water: no floor in view, just drifting motes for depth
  group.add(particles(1100, new THREE.Vector3(90, 30, 64), { seed: 9, origin: new THREE.Vector3(-45, -8, -52), vel: new THREE.Vector3(0.14, 0.02, 0.05), size: 0.8, color: 0xc8e8f8, alpha: 0.26 }));
  return { homes: [], obstacles: [], floor: noFloor };
}

export function kelpFloor(x, z) {
  return -0.3 + Math.sin(x * 0.09 + 0.7) * 0.35 + Math.cos(z * 0.11 + 1.1) * 0.3 + Math.sin((x - z) * 0.27) * 0.1 + Math.max(0, -z - 20) * 0.08;
}

function kelpGeometry(rand) {
  const H = 16, parts = [];
  const pts = [];
  const bend = (rand() - 0.5) * 1.2;
  for (let i = 0; i <= 8; i++) { const y = (i / 8) * H; pts.push(new THREE.Vector3(Math.sin(y * 0.2) * 0.25 + bend * (y / H) ** 2, y, Math.cos(y * 0.17) * 0.2)); }
  const curve = new THREE.CatmullRomCurve3(pts);
  const stipe = new THREE.TubeGeometry(curve, 24, 0.05, 5);
  const brown = new THREE.Color(0x5a4318), gold = new THREE.Color(0xb88a2c), olive = new THREE.Color(0x8a6420);
  parts.push(paint(stipe, (v, o) => o.copy(brown).lerp(olive, v.y / H)));
  // blades along the stipe, alternating sides, each with a small float at its base
  for (let y = 0.8, side = 1; y < H - 0.3; y += 0.6 + rand() * 0.3, side = -side) {
    const c = curve.getPointAt(y / H);
    const len = 1.5 + rand() * 0.9, w = 0.3 + rand() * 0.16;
    const g = new THREE.PlaneGeometry(w, len, 1, 4);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const yy = p.getY(i) / len + 0.5; p.setX(i, p.getX(i) * Math.sin(Math.PI * Math.min(1, yy * 1.1 + 0.05))); p.setZ(i, Math.sin(yy * 3) * 0.06); }
    g.translate(0, len / 2, 0);
    g.rotateZ(-side * (0.3 + rand() * 0.25));
    g.rotateY(rand() * Math.PI * 2);
    g.translate(c.x, c.y, c.z);
    const tint = rand() * 0.5 + 0.2;
    parts.push(paint(g, (v, o) => o.copy(olive).lerp(gold, tint)));
    const f = new THREE.SphereGeometry(0.07, 6, 4); f.translate(c.x, c.y, c.z);
    parts.push(paint(f, (v, o) => o.copy(gold)));
  }
  return mergeGeometries(parts);
}

function buildKelp(group) {
  const rand = rng(4321);
  group.add(seafloor(kelpFloor, [0xc4b48c, 0x968866, 0xdcd0ac], 0.75));
  const statics = [], obstacles = [], homes = [];
  // boulders and holdfast rocks
  for (let i = 0; i < 26; i++) {
    const x = -34 + rand() * 68, z = -40 + rand() * 42;
    if (z > -4 && Math.abs(x) < 7) continue;
    const r = 0.5 + rand() * 1.4;
    const g = rock(r, rand, [0x6e6a5c, 0x5a584e, 0x7a6a58][Math.floor(rand() * 3)]);
    g.rotateY(rand() * 6); g.translate(x, kelpFloor(x, z) - 0.15, z);
    statics.push(g);
    obstacles.push({ x, y: kelpFloor(x, z) + r * 0.3, z, r: r * 1.3 });
    homes.push(new THREE.Vector3(x, kelpFloor(x, z) + r * 0.7 + 0.6, z));
  }
  for (let i = 0; i < 50; i++) {
    const x = -50 + rand() * 100, z = -55 + rand() * 62;
    const g = rock(0.15 + rand() * 0.35, rand, 0x8a8270); g.rotateY(rand() * 6); g.translate(x, kelpFloor(x, z) - 0.05, z); statics.push(g);
  }
  group.add(new THREE.Mesh(mergeGeometries(statics), patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }), { caustic: 0.75 })));

  // kelp: a few stipe shapes, instanced, swaying in the surge
  const spots = [];
  for (let tries = 0; spots.length < 54 && tries < 2000; tries++) {
    const x = -38 + rand() * 76, z = -44 + rand() * 50;
    if (z > -6 && Math.abs(x) < 10) continue; // keep the middle of the view open
    if (spots.some((s) => Math.hypot(s[0] - x, s[1] - z) < 2.6)) continue;
    spots.push([x, z]);
  }
  const variants = 3, per = Math.ceil(spots.length / variants);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
  for (let v = 0; v < variants; v++) {
    const mine = spots.slice(v * per, (v + 1) * per);
    const geo = kelpGeometry(rand);
    const phase = new Float32Array(mine.length);
    const mat = patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, side: THREE.DoubleSide }), { caustic: 0.55, sway: 0.0045 });
    const mesh = new THREE.InstancedMesh(geo, mat, mine.length);
    mine.forEach(([x, z], i) => {
      const k = 0.75 + rand() * 0.35;
      pos.set(x, kelpFloor(x, z) - 0.1, z); q.setFromEuler(new THREE.Euler(0, rand() * 6.28, 0)); sc.set(k, k, k);
      m.compose(pos, q, sc); mesh.setMatrixAt(i, m);
      phase[i] = x * 0.15 + z * 0.1; // neighbors sway together, like a surge passing through
      for (const h of [2.5, 6, 10]) obstacles.push({ x, y: pos.y + h * k, z, r: 0.35 });
      homes.push(new THREE.Vector3(x + 0.8, pos.y + 1.2, z + 0.8));
    });
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  group.add(particles(1200, new THREE.Vector3(80, 22, 60), { seed: 15, origin: new THREE.Vector3(-40, -1, -48), vel: new THREE.Vector3(0.1, 0.03, 0.04), size: 0.9, color: 0xd8f0d0, alpha: 0.3 }));
  for (const [vx, vz] of [[-7, -9], [9, -14]]) {
    group.add(particles(24, new THREE.Vector3(0.8, 16, 0.8), { seed: vx * 7 + vz, origin: new THREE.Vector3(vx - 0.4, kelpFloor(vx, vz) + 1, vz - 0.4), vel: new THREE.Vector3(0, 1.0, 0), size: 2.1, color: 0xeefcf0, alpha: 0.45, ring: true }));
  }
  return { homes, obstacles, floor: kelpFloor };
}

function buildDeep(group) {
  // marine snow drifting down, plus a few faint specks of free-floating glow
  group.add(particles(1800, new THREE.Vector3(80, 28, 60), { seed: 21, origin: new THREE.Vector3(-40, -6, -48), vel: new THREE.Vector3(0.02, -0.2, 0.01), size: 1.0, color: 0xdde8ee, alpha: 0.5 }));
  group.add(particles(70, new THREE.Vector3(70, 24, 50), { seed: 33, origin: new THREE.Vector3(-35, -4, -44), vel: new THREE.Vector3(0.03, 0.01, -0.02), size: 0.7, color: 0x5fd8ff, alpha: 0.8 }));
  return { homes: [], obstacles: [], floor: noFloor };
}

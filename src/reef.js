import * as THREE from 'three';
import { mergeGeometries, paint, rng } from './geo.js';
import { patchMaterial, shared } from './shaders.js';
import { Field, fitShape, CYL, DOME } from './obstacles.js';

export function floorHeight(x, z) {
  return -0.4
    + Math.sin(x * 0.11 + 1.3) * 0.55 + Math.cos(z * 0.13 - 0.4) * 0.5
    + Math.sin((x + z) * 0.31) * 0.18 + Math.cos(x * 0.47 - z * 0.23) * 0.1
    + Math.max(0, -z - 18) * 0.12 // gentle rise toward the back wall
    + mounds(x, z);
}

// Low reef mounds (bommies) that lift the coral clusters off the sand, tallest toward the back.
const MOUNDS = [[-18, -14, 1.6, 34], [11, -24, 2.0, 46], [20, -16, 1.3, 30], [0, -18, 1.0, 26], [-12, -26, 1.8, 40], [-27, -20, 1.4, 36], [27, -28, 1.7, 40], [5, -9, 0.6, 14]];
function mounds(x, z) {
  let h = 0;
  for (const [mx, mz, a, w] of MOUNDS) {
    const d2 = (x - mx) * (x - mx) + (z - mz) * (z - mz);
    if (d2 < w * 9) h += a * Math.exp(-d2 / w);
  }
  return h;
}

// Shared water backdrop: fades from the fog color at the horizon to a lighter
// surface tint above and a darker tone below. Scenes retint it through uniforms.
export function backdrop(fogColor) {
  const g = new THREE.SphereGeometry(400, 32, 16);
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uTime: shared.uTime, uFog: { value: fogColor }, uSurf: { value: new THREE.Vector3(0.2, 0.62, 0.72) }, uLow: { value: 0.55 }, uRipple: { value: 0.03 } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `varying vec3 vDir; uniform float uTime; uniform vec3 uFog; uniform vec3 uSurf; uniform float uLow, uRipple;
      void main(){
        float y = vDir.y;
        // Same color space as three's fog, so the far floor melts into the water.
        vec3 c = mix(uFog, uSurf, smoothstep(0.04, 0.95, y));
        c = mix(uFog * uLow, c, smoothstep(-0.5, 0.0, y));
        float ripple = sin(vDir.x * 40.0 + uTime * 0.6) * sin(vDir.z * 37.0 - uTime * 0.5);
        c += smoothstep(0.45, 1.0, y) * ripple * uRipple;
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.renderOrder = -10;
  return mesh;
}

export function seafloor(height = floorHeight, tones = [0xd9c9a0, 0xa89870, 0xeee2c0], caustic = 0.8) {
  const g = new THREE.PlaneGeometry(700, 700, 220, 220);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, height(p.getX(i), p.getZ(i)));
  g.computeVertexNormals();
  const sand = new THREE.Color(tones[0]), dark = new THREE.Color(tones[1]), pale = new THREE.Color(tones[2]);
  paint(g, (v, o) => {
    const n = Math.sin(v.x * 1.7) * Math.cos(v.z * 1.3) * 0.5 + Math.sin(v.x * 0.37 + v.z * 0.29) * 0.5;
    o.copy(sand).lerp(n > 0 ? pale : dark, Math.abs(n) * 0.5);
  });
  const m = patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }), { caustic });
  return new THREE.Mesh(g, m);
}

export function rock(r, rand, color, detail = 3) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position, v = new THREE.Vector3();
  const a = rand() * 10, b = rand() * 10;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = 1 + 0.18 * Math.sin(v.x * 3 + a) * Math.cos(v.z * 3 + b) + 0.08 * Math.sin(v.y * 7 + a);
    v.multiplyScalar(n);
    p.setXYZ(i, v.x * r * 1.3, Math.max(v.y * r * 0.7, -0.4), v.z * r);
  }
  g.computeVertexNormals();
  const base = new THREE.Color(color);
  return paint(g, (v, o) => { o.copy(base).multiplyScalar(0.75 + 0.35 * (Math.sin(v.x * 4.1) * Math.cos(v.z * 3.7) * 0.5 + 0.5)); });
}

function branching(rand, color, size) {
  const parts = [];
  const tip = new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.35), base = new THREE.Color(color);
  const up = new THREE.Vector3(0, 1, 0);
  function grow(origin, dir, len, rad, depth) {
    const end = origin.clone().addScaledVector(dir, len);
    const g = new THREE.CylinderGeometry(rad * 0.72, rad, len, depth >= 2 ? 6 : 4, 1, false);
    g.translate(0, len / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, dir));
    g.translate(origin.x, origin.y, origin.z);
    parts.push(paint(g, (v, o) => o.copy(base).lerp(tip, Math.min(1, (v.y) / (size * 1.6)))));
    if (depth <= 0) {
      const cap = new THREE.SphereGeometry(rad * 0.85, 5, 3); cap.translate(end.x, end.y, end.z);
      parts.push(paint(cap, (v, o) => o.copy(tip)));
      return;
    }
    const n = 2 + (rand() < 0.4 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const d = dir.clone().add(new THREE.Vector3((rand() - 0.5) * 1.2, rand() * 0.35, (rand() - 0.5) * 1.2)).normalize();
      if (d.y < 0.25) { d.y = 0.25; d.normalize(); }
      grow(end, d, len * (0.68 + rand() * 0.15), rad * 0.7, depth - 1);
    }
  }
  const trunks = 3 + Math.floor(rand() * 3);
  for (let i = 0; i < trunks; i++) {
    const o = new THREE.Vector3((rand() - 0.5) * size * 0.6, 0, (rand() - 0.5) * size * 0.6);
    const d = new THREE.Vector3((rand() - 0.5) * 0.6, 1, (rand() - 0.5) * 0.6).normalize();
    // tall colonies get longer, not fatter, branches
    grow(o, d, size * 0.45, Math.min(size * 0.07, 0.11), 3);
  }
  return mergeGeometries(parts);
}

// Pillar coral: a clump of tall, knobbly upright columns.
function pillar(h, rand, color) {
  const parts = [];
  const base = new THREE.Color(color), tip = base.clone().lerp(new THREE.Color(0xfff4e0), 0.35);
  const n = 4 + Math.floor(rand() * 5);
  for (let i = 0; i < n; i++) {
    const a = rand() * Math.PI * 2, d = rand() * h * 0.22;
    const ph = h * (0.45 + rand() * 0.55), r = h * (0.05 + rand() * 0.03);
    const g = new THREE.CylinderGeometry(r * 0.85, r, ph, 8, 6);
    const p = g.attributes.position;
    for (let j = 0; j < p.count; j++) {
      const k = 1 + 0.12 * Math.sin(p.getY(j) * 9 / h + a * 3) ;
      p.setX(j, p.getX(j) * k); p.setZ(j, p.getZ(j) * k);
    }
    g.translate(Math.cos(a) * d, ph / 2, Math.sin(a) * d);
    parts.push(paint(g, (v, o) => o.copy(base).lerp(tip, Math.min(1, v.y / h))));
    const cap = new THREE.SphereGeometry(r * 0.85, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);
    cap.translate(Math.cos(a) * d, ph, Math.sin(a) * d);
    parts.push(paint(cap, (v, o) => o.copy(tip)));
  }
  return mergeGeometries(parts);
}

function brain(r, rand) {
  const g = new THREE.SphereGeometry(r, 40, 24, 0, Math.PI * 2, 0, Math.PI * 0.55);
  const p = g.attributes.position, v = new THREE.Vector3(), s = rand() * 6;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const ridge = Math.sin(v.x * 9 / r + Math.sin(v.z * 5 / r + s) * 2.2) * 0.035 * r;
    v.multiplyScalar(1 + ridge / r);
    p.setXYZ(i, v.x, v.y * 0.75 - r * 0.08, v.z);
  }
  g.computeVertexNormals();
  const a = new THREE.Color(0x8fa65a), b = new THREE.Color(0x5e7a3a);
  return paint(g, (v, o) => o.copy(a).lerp(b, Math.sin(v.x * 9 / r + Math.sin(v.z * 5 / r + s) * 2.2) * 0.5 + 0.5));
}

function tableCoral(r, color) {
  const g = new THREE.CylinderGeometry(r, r * 0.92, r * 0.08, 28, 1);
  const stem = new THREE.CylinderGeometry(r * 0.08, r * 0.14, r * 0.5, 10);
  g.translate(0, r * 0.5, 0); stem.translate(0, r * 0.25, 0);
  const c = new THREE.Color(color), rim = c.clone().lerp(new THREE.Color(0xffffff), 0.3);
  return mergeGeometries([
    paint(g, (v, o) => o.copy(c).lerp(rim, Math.min(1, Math.hypot(v.x, v.z) / r))),
    paint(stem, (v, o) => o.copy(c).multiplyScalar(0.8)),
  ]);
}

function seaFan(h, rand, color) {
  const parts = [];
  const c = new THREE.Color(color);
  function arm(x0, y0, ang, len, depth) {
    const x1 = x0 + Math.sin(ang) * len, y1 = y0 + Math.cos(ang) * len;
    const g = new THREE.CylinderGeometry(0.02 + depth * 0.012, 0.03 + depth * 0.014, len, 5);
    g.translate(0, len / 2, 0); g.rotateZ(-ang); g.translate(x0, y0, 0);
    parts.push(paint(g, (v, o) => o.copy(c)));
    if (depth > 0) for (const s of [-1, 1]) arm(x1, y1, ang + s * (0.25 + rand() * 0.25), len * 0.78, depth - 1);
  }
  arm(0, 0, 0, h * 0.32, 4);
  return mergeGeometries(parts);
}

function anemone(rand, count = 70) {
  const tentacle = new THREE.CylinderGeometry(0.018, 0.04, 0.42, 5, 6);
  tentacle.translate(0, 0.21, 0);
  const tip = new THREE.SphereGeometry(0.03, 6, 4); tip.translate(0, 0.42, 0);
  const geo = mergeGeometries([
    paint(tentacle, (v, o) => o.set(0xd8b07a).lerp(new THREE.Color(0xf0dfc0), v.y / 0.42)),
    paint(tip, (v, o) => o.set(0xb9e070)),
  ]);
  const mat = patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }), { caustic: 0.5, sway: 1.6 });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const phase = new Float32Array(count);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), pos = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const r = Math.sqrt(rand()) * 0.75, a = rand() * Math.PI * 2;
    pos.set(Math.cos(a) * r, 0.05, Math.sin(a) * r);
    q.setFromEuler(new THREE.Euler((rand() - 0.5) * 0.5 + Math.sin(a) * r * 0.6, rand() * 6, (rand() - 0.5) * 0.5 - Math.cos(a) * r * 0.6));
    const k = 0.8 + rand() * 0.5; s.set(k, k * (1 - r * 0.4), k);
    m.compose(pos, q, s); mesh.setMatrixAt(i, m);
    phase[i] = rand() * 6.28 + a;
  }
  geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
  return mesh;
}

// Shared god rays from the surface; uStrength fades them per scene.
export function rays() {
  const group = new THREE.Group();
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    uniforms: { uTime: shared.uTime, uStrength: { value: 1 } },
    vertexShader: `varying vec2 vUv; varying float vSeed; attribute float aSeed;
      void main(){ vUv = uv; vSeed = aSeed; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position,1.0); }`,
    fragmentShader: `varying vec2 vUv; varying float vSeed; uniform float uTime; uniform float uStrength;
      void main(){
        float edge = smoothstep(0.0, 0.5, vUv.x) * smoothstep(1.0, 0.5, vUv.x);
        float len = smoothstep(0.0, 0.75, vUv.y);
        float flick = 0.55 + 0.45 * sin(uTime * 0.21 + vSeed * 6.0) * sin(uTime * 0.13 + vSeed * 3.0);
        float a = edge * edge * len * flick * 0.085 * uStrength;
        gl_FragColor = vec4(vec3(0.75, 0.95, 1.0) * a, a);
      }`,
  });
  const g = new THREE.PlaneGeometry(1, 1);
  g.translate(0, -0.5, 0);
  const n = 14, mesh = new THREE.InstancedMesh(g, mat, n);
  const seeds = new Float32Array(n), r = rng(77), m = new THREE.Matrix4();
  for (let i = 0; i < n; i++) {
    seeds[i] = r();
    const x = -40 + r() * 80, z = -42 + r() * 40;
    const w = 2 + r() * 5, h = 34 + r() * 10;
    m.compose(new THREE.Vector3(x, 26, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.32 + (r() - 0.5) * 0.08)), new THREE.Vector3(w, h, 1));
    mesh.setMatrixAt(i, m);
  }
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
  mesh.renderOrder = 5;
  mesh.frustumCulled = false;
  group.add(mesh);
  group.userData.uniforms = mat.uniforms;
  return group;
}

// Drifting motes and rising bubbles, animated entirely on the GPU with wraparound
// that fades in and out, so nothing pops.
export function particles(count, box, opts) {
  const r = rng(opts.seed);
  const pos = new Float32Array(count * 3), seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = r() * box.x; pos[i * 3 + 1] = r() * box.y; pos[i * 3 + 2] = r() * box.z; seed[i] = r();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: shared.uTime, uBox: { value: box }, uOrigin: { value: opts.origin }, uVel: { value: opts.vel }, uSize: { value: opts.size }, uColor: { value: new THREE.Color(opts.color) }, uAlpha: { value: opts.alpha }, uPix: { value: Math.min(window.devicePixelRatio, 2) } },
    vertexShader: `attribute float aSeed; uniform float uTime; uniform vec3 uBox, uOrigin, uVel; uniform float uSize, uPix; varying float vFade;
      void main(){
        vec3 p = position + uVel * uTime * (0.6 + aSeed * 0.8);
        p.x += sin(uTime * 0.3 + aSeed * 30.0) * 0.4;
        p.z += cos(uTime * 0.23 + aSeed * 20.0) * 0.4;
        p = mod(p, uBox);
        vec3 e = min(p, uBox - p) / (uBox * 0.12);
        vFade = clamp(min(e.x, min(e.y, e.z)), 0.0, 1.0);
        vec4 mv = modelViewMatrix * vec4(p + uOrigin, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uSize * uPix * (0.6 + aSeed) * (30.0 / -mv.z);
        vFade *= 1.0 - smoothstep(10.0, 70.0, -mv.z);
      }`,
    fragmentShader: `uniform vec3 uColor; uniform float uAlpha; varying float vFade;
      void main(){
        vec2 d = gl_PointCoord - 0.5; float r = length(d);
        float a = smoothstep(0.5, 0.1, r) * vFade * uAlpha;
        ${opts.ring ? 'a *= 0.35 + smoothstep(0.2, 0.42, r) * 1.4;' : ''}
        gl_FragColor = vec4(uColor * a, a);
      }`,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  return pts;
}

export function buildReef(scene) {
  const rand = rng(1234);
  scene.add(seafloor());

  const statics = [];
  const obstacles = []; // solid shapes fish steer around (see obstacles.js)
  const anemones = [], pending = [];
  const colors = [0xe0567a, 0xb05cd0, 0xff8a3c, 0xf2b6c8, 0x6fc0b8, 0xd94f4f];
  const clusters = [
    [-9, -6, 1.2], [5, -9, 1.1], [14, -3, 0.9], [-18, -14, 1.3], [0, -18, 1.4], [20, -16, 1.0], [-4, 2, 0.7], [-24, -2, 0.9], [11, -24, 1.2], [-12, -26, 1.1],
    // added in M3.1: fill the gaps and the far reef so it reads as a reef, not islands
    [-27, -20, 1.2], [27, -28, 1.2], [26, -6, 0.8], [-6, -32, 1.3], [17, -36, 1.2], [-20, -36, 1.1], [-15, -4, 0.7], [7, -30, 1.0],
  ];
  const place = (geo, x, z, rotY = 0, lift = 0, kind = null) => {
    if (kind !== null) obstacles.push(fitShape(geo, kind, x, z, floorHeight(x, z) + lift));
    geo.rotateY(rotY);
    geo.translate(x, floorHeight(x, z) + lift, z);
    statics.push(geo);
  };
  const rockTones = [0x8a7d6c, 0x7c7266, 0x948670];
  clusters.forEach(([cx, cz, s], ci) => {
    const rr = 1.6 * s + rand() * 0.6;
    const g0 = floorHeight(cx, cz);
    place(rock(rr, rand, rockTones[ci % 3]), cx, cz, rand() * 6, -0.2, DOME);
    // stack one or two smaller boulders on the base rock, so clusters stand up off the floor
    let top = g0 + rr * 0.55;
    const stack = s < 0.8 ? 0 : 1 + (rand() < 0.5 ? 1 : 0); // small foreground clusters stay low
    for (let k = 0, r = rr; k < stack; k++) {
      r *= 0.55 + rand() * 0.15;
      const ox = (rand() - 0.5) * r * 0.8, oz = (rand() - 0.5) * r * 0.8;
      const y = top - r * 0.15;
      const g = rock(r, rand, rockTones[(ci + k + 1) % 3]);
      obstacles.push(fitShape(g, DOME, cx + ox, cz + oz, y));
      g.rotateY(rand() * 6); g.translate(cx + ox, y, cz + oz); statics.push(g);
      top = y + r * 0.6;
    }
    const n = 7 + Math.floor(rand() * 5);
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2, d = rand() * rr * 1.4;
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      const kind = rand();
      // pieces near the middle of a cluster sit on the stack and are the tallest
      const inner = d < rr * 0.5;
      const tall = (inner ? 1.35 : 1) * (0.8 + rand() * 0.6);
      let g, h;
      if (kind < 0.32) { h = (1.3 + rand() * 1.2) * s * tall; g = branching(rand, colors[Math.floor(rand() * colors.length)], h); }
      else if (kind < 0.46) { h = (2.2 + rand() * 1.8) * s * tall; g = pillar(h, rand, [0xe39a5c, 0xd0808a, 0xeab26a][Math.floor(rand() * 3)]); }
      else if (kind < 0.62) { h = 0.8 * s; g = brain((0.6 + rand() * 0.6) * s, rand); }
      else if (kind < 0.8) { h = 1.2 * s; g = tableCoral((0.8 + rand() * 0.6) * s, [0x9fb878, 0xc8a87a, 0x7fa8a0][Math.floor(rand() * 3)]); }
      else { h = (1.8 + rand() * 1.4) * s * tall; g = seaFan(h, rand, [0xa04ad0, 0xe0603a, 0xe8c040][Math.floor(rand() * 3)]); }
      const ground = floorHeight(x, z);
      const lift = inner ? Math.max(0, top - ground - 0.15) : d < rr ? Math.max(0, g0 + rr * 0.55 - ground - d * 0.35) : 0;
      place(g, x, z, rand() * 6, lift, kind >= 0.46 && kind < 0.62 ? DOME : CYL);
    }
    if (ci < 3 || ci === 6) {
      const a = rand() * Math.PI * 2;
      pending.push([anemone(rand), cx, cz, a, rr * 0.9]);
    }
  });
  // scattered small rocks and rubble
  for (let i = 0; i < 70; i++) {
    const x = -50 + rand() * 100, z = -50 + rand() * 60;
    place(rock(0.2 + rand() * 0.5, rand, 0x9a8e7a, 2), x, z, rand() * 6, -0.05, DOME);
  }
  // Anemones sit on open sand at the edge of their cluster, walked outward until a clownfish
  // hovering over one has room, so the fish's home is never inside rock or coral.
  const field = new Field(floorHeight, obstacles), n = { x: 0, y: 0, z: 0 };
  for (const [an, cx, cz, a, d0] of pending) {
    let x, z;
    for (let d = d0; d < d0 + 8; d += 0.15) {
      x = cx + Math.cos(a) * d; z = cz + Math.sin(a) * d;
      if (field.sdf(x, floorHeight(x, z) + 0.5, z, n) > 0.7) break;
    }
    an.position.set(x, floorHeight(x, z) - 0.05, z);
    scene.add(an);
    anemones.push(new THREE.Vector3(x, floorHeight(x, z) + 0.5, z));
  }
  const reefMat = patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0 }), { caustic: 0.85 });
  const reef = new THREE.Mesh(mergeGeometries(statics), reefMat);
  scene.add(reef);

  scene.add(particles(1400, new THREE.Vector3(80, 22, 60), { seed: 5, origin: new THREE.Vector3(-40, -1, -48), vel: new THREE.Vector3(0.12, 0.03, 0.05), size: 0.9, color: 0xcfeef5, alpha: 0.35 }));
  const vents = [[-9, -6], [5, -9], [0, -18]];
  for (const [vx, vz] of vents) {
    scene.add(particles(28, new THREE.Vector3(0.8, 16, 0.8), { seed: vx * 13 + vz, origin: new THREE.Vector3(vx - 0.4, floorHeight(vx, vz) + 1, vz - 0.4), vel: new THREE.Vector3(0, 1.1, 0), size: 2.2, color: 0xe8fbff, alpha: 0.5, ring: true }));
  }
  return { anemones, obstacles, homes: anemones, floor: floorHeight };
}

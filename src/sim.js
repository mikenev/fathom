import * as THREE from 'three';
import { SPECIES, SPECIES_ORDER } from './fish.js';
import { patchMaterial } from './shaders.js';
import { floorHeight } from './reef.js';

const B = { minX: -30, maxX: 30, minY: 0.6, maxY: 15, minZ: -32, maxZ: 6 };
const schoolC = new THREE.Vector3(), tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), dummy = new THREE.Object3D(), mat4 = new THREE.Matrix4();
const smooth = (x) => x * x * (3 - 2 * x);

// Sum of slow sines: smooth, never repeating within a viewing session.
function noise(t, s) {
  return Math.sin(t * 0.13 + s * 7.1) * 0.5 + Math.sin(t * 0.071 + s * 3.3) * 0.35 + Math.sin(t * 0.037 + s * 11.7) * 0.15;
}

function randomSpawn(rand, sp, anemones, back) {
  if (sp.behavior === 'anemone' && anemones.length) {
    const a = anemones[Math.floor(rand() * anemones.length)];
    return new THREE.Vector3(a.x + (rand() - 0.5) * 2, a.y + rand() * 1.2, a.z + (rand() - 0.5) * 2);
  }
  const x = B.minX + rand() * (B.maxX - B.minX);
  const z = back ? B.minZ + 1 + rand() * 6 : B.minZ + rand() * (B.maxZ - B.minZ - 6);
  const y = sp.behavior === 'school' ? 5 + rand() * 5 : floorHeight(x, z) + 1.5 + rand() * 5;
  return new THREE.Vector3(x, y, z);
}

export class Aquarium {
  constructor(scene, reef) {
    this.scene = scene;
    this.reef = reef;
    this.time = 0;
    this.groups = {};
    this.rand = Math.random;
    for (const key of SPECIES_ORDER) {
      const sp = SPECIES[key];
      const geo = sp.build();
      const phase = new THREE.InstancedBufferAttribute(new Float32Array(sp.max), 1);
      phase.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aPhase', phase);
      const mat = patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: key === 'blacktip' ? 0.55 : 0.4, metalness: 0.05, side: THREE.DoubleSide }), { caustic: 0.45, wiggle: { length: sp.length, amp: sp.wiggle } });
      const mesh = new THREE.InstancedMesh(geo, mat, sp.max);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.groups[key] = { key, sp, mesh, phase, agents: [], target: 0, schoolSeed: Math.random() * 100 };
    }
  }

  // Set how many of a species should be present. Changes fade in or out at the fog line.
  setTarget(key, n, instant = false) {
    const g = this.groups[key];
    n = Math.max(0, Math.min(g.sp.max, n));
    g.target = n;
    const alive = g.agents.filter((a) => !a.leaving).length;
    if (n > alive) {
      // revive leaving agents from the end first, then add new ones
      for (let i = g.agents.length - 1; i >= 0 && g.agents.filter((a) => !a.leaving).length < n; i--) {
        if (g.agents[i].leaving) g.agents[i].leaving = false;
      }
      while (g.agents.filter((a) => !a.leaving).length < n) g.agents.push(this.spawn(g, instant));
    } else if (n < alive) {
      let drop = alive - n;
      for (let i = g.agents.length - 1; i >= 0 && drop > 0; i--) if (!g.agents[i].leaving) { g.agents[i].leaving = true; drop--; }
    }
  }

  spawn(g, instant) {
    const sp = g.sp, r = this.rand;
    const i = g.agents.length;
    const a = {
      pos: randomSpawn(r, sp, this.reef.anemones, !instant),
      vel: new THREE.Vector3(r() - 0.5, (r() - 0.5) * 0.2, r() - 0.5).normalize().multiplyScalar(sp.speed[0]),
      quat: new THREE.Quaternion(),
      seed: r() * 100,
      phase: r() * 6.28,
      cruise: sp.speed[0] + r() * (sp.speed[1] - sp.speed[0]),
      scale: instant ? 1 : 0,
      leaving: false,
      home: sp.behavior === 'anemone' ? this.reef.anemones[i % Math.max(1, this.reef.anemones.length)] : null,
      size: (sp.behavior === 'cruise' ? 1 : 1.45) * (0.85 + r() * 0.3),
      bank: 0,
    };
    if (sp.behavior === 'cruise') {
      a.loop = { dir: i % 2 ? -1 : 1, theta: r() * 6.28, cx: (r() - 0.5) * 6, cz: -12 - r() * 4, seed: r() * 10 };
      a.size = 0.95 + r() * 0.1;
      a.pos.copy(this.cruisePoint(a, 0));
    }
    tmp.copy(a.vel).normalize();
    dummy.position.set(0, 0, 0); dummy.lookAt(tmp); a.quat.copy(dummy.quaternion);
    return a;
  }

  cruisePoint(a, t) {
    const L = a.loop, s = L.seed;
    const rx = 21 + 4 * Math.sin(t * 0.021 + s), rz = 11 + 3 * Math.cos(t * 0.017 + s * 1.7);
    const th = L.theta;
    return new THREE.Vector3(
      L.cx + Math.cos(th) * rx,
      3.2 + 1.6 * Math.sin(t * 0.043 + s * 2.1) + 0.8 * Math.sin(th * 2 + s),
      L.cz + Math.sin(th) * rz + 4 * Math.sin(t * 0.011 + s) * Math.max(0, Math.sin(th)),
    );
  }

  update(dt, t) {
    this.time = t;
    const sharks = this.groups.blacktip.agents;
    for (const key of SPECIES_ORDER) {
      const g = this.groups[key];
      const sp = g.sp;
      // school center wanders slowly through midwater
      const sc = schoolC.set(noise(t, g.schoolSeed) * 12, 5.5 + noise(t * 0.8, g.schoolSeed + 3) * 2, -8 + noise(t * 0.9, g.schoolSeed + 7) * 7);
      for (let i = 0; i < g.agents.length; i++) {
        const a = g.agents[i];
        a.scale += ((a.leaving ? 0 : 1) - a.scale) * Math.min(1, dt * 0.6);
        if (sp.behavior === 'cruise') this.stepCruise(a, dt, t);
        else this.stepFish(a, g, i, dt, t, sc, sharks);
      }
      // drop fully faded agents from the end only, so other fish keep their slots
      while (g.agents.length && g.agents[g.agents.length - 1].leaving && g.agents[g.agents.length - 1].scale < 0.02) g.agents.pop();
      this.writeInstances(g, dt);
    }
  }

  stepCruise(a, dt, t) {
    const L = a.loop;
    const before = this.cruisePoint(a, t);
    const ahead = (() => { const th = L.theta; L.theta += 0.01 * L.dir; const p = this.cruisePoint(a, t); L.theta = th; return p; })();
    const arc = Math.max(0.01, ahead.distanceTo(before) / 0.01);
    L.theta += (a.cruise / arc) * dt * L.dir;
    const p = this.cruisePoint(a, t);
    a.vel.copy(p).sub(a.pos).divideScalar(Math.max(dt, 1e-4));
    if (a.vel.lengthSq() > 9) a.vel.setLength(a.cruise);
    a.pos.copy(p);
  }

  stepFish(a, g, i, dt, t, schoolCenter, sharks) {
    const sp = g.sp;
    const acc = tmp.set(0, 0, 0);
    const desired = new THREE.Vector3();
    if (sp.behavior === 'school') {
      const coh = new THREE.Vector3(), ali = new THREE.Vector3(), sep = new THREE.Vector3();
      let n = 0;
      for (let j = 0; j < g.agents.length; j++) {
        if (j === i) continue;
        const b = g.agents[j];
        const d = a.pos.distanceTo(b.pos);
        if (d < 5.0) {
          coh.add(b.pos); ali.add(b.vel); n++;
          if (d < 0.75) sep.addScaledVector(tmp2.copy(a.pos).sub(b.pos), (0.75 - d) / Math.max(d, 0.05));
        }
      }
      if (n) {
        coh.divideScalar(n).sub(a.pos).multiplyScalar(0.5);
        ali.divideScalar(n).sub(a.vel).multiplyScalar(0.6);
        acc.add(coh).add(ali);
      }
      acc.addScaledVector(sep, 2.2);
      acc.addScaledVector(desired.copy(schoolCenter).sub(a.pos), 0.12);
    } else {
      // wander: heading driven by smooth noise
      const yaw = noise(t * 1.4, a.seed) * Math.PI * 2.2;
      const pitch = noise(t * 1.1, a.seed + 5) * 0.25;
      desired.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(a.cruise);
      acc.addScaledVector(desired.sub(a.vel), 0.6);
      if (a.home) {
        const d = tmp2.copy(a.home).sub(a.pos);
        const dist = d.length();
        if (dist > 1.4) acc.addScaledVector(d, 0.35 * smooth(Math.min(1, (dist - 1.4) / 2)));
      } else {
        const d = tmp2.set(0, 3.5, -8).sub(a.pos);
        const dist = d.length();
        if (dist > 16) acc.addScaledVector(d.normalize(), 0.5 * Math.min(1, (dist - 16) / 8));
      }
      for (let j = 0; j < g.agents.length; j++) {
        if (j === i) continue;
        const d = a.pos.distanceTo(g.agents[j].pos);
        if (d < 1.0) acc.addScaledVector(tmp2.copy(a.pos).sub(g.agents[j].pos), (1.0 - d) * 1.5 / Math.max(d, 0.05));
      }
    }
    // stay inside the tank volume with soft walls
    const soft = (v, lo, hi, w) => (v < lo + w ? (lo + w - v) / w : 0) - (v > hi - w ? (v - (hi - w)) / w : 0);
    acc.x += soft(a.pos.x, B.minX, B.maxX, 5) * 1.5;
    acc.z += soft(a.pos.z, B.minZ, B.maxZ, 5) * 1.5;
    const floor = floorHeight(a.pos.x, a.pos.z) + (a.home ? 0.35 : 0.9);
    acc.y += soft(a.pos.y, floor, B.maxY, 1.6) * 2.0;
    // steer around coral and rock
    for (const o of this.reef.obstacles) {
      const dx = a.pos.x - o.x, dy = a.pos.y - o.y, dz = a.pos.z - o.z;
      const d2 = dx * dx + dy * dy + dz * dz, rr = o.r + 0.6;
      if (d2 < rr * rr) {
        const d = Math.sqrt(d2) || 0.01, k = ((rr - d) / rr) * 3.0 / d;
        acc.x += dx * k; acc.y += dy * k * 0.6 + (rr - d) * 0.6; acc.z += dz * k;
      }
    }
    // give cruising sharks room, calmly
    for (const s of sharks) {
      const d = a.pos.distanceTo(s.pos);
      if (d < 5) acc.addScaledVector(tmp2.copy(a.pos).sub(s.pos).normalize(), (5 - d) * 0.35 * s.scale);
    }
    const maxAcc = sp.behavior === 'school' ? 2.2 : 1.4;
    if (acc.length() > maxAcc) acc.setLength(maxAcc);
    a.vel.addScaledVector(acc, dt);
    a.vel.y *= 1 - Math.min(1, dt * 0.8);
    const sp2 = a.vel.length();
    const lo = sp.speed[0], hi = sp.speed[1];
    if (sp2 > hi) a.vel.multiplyScalar(hi / sp2);
    else if (sp2 < lo) a.vel.multiplyScalar(lo / Math.max(sp2, 1e-3));
    a.pos.addScaledVector(a.vel, dt);
  }

  writeInstances(g, dt) {
    const sp = g.sp, mesh = g.mesh;
    for (let i = 0; i < g.agents.length; i++) {
      const a = g.agents[i];
      const speed = a.vel.length();
      tmp.copy(a.vel).normalize();
      if (speed > 1e-3) {
        dummy.position.set(0, 0, 0);
        dummy.up.set(0, 1, 0);
        dummy.lookAt(tmp);
        // bank into turns
        const prevFwd = tmp2.set(0, 0, 1).applyQuaternion(a.quat);
        const turn = prevFwd.x * tmp.z - prevFwd.z * tmp.x;
        a.bank += (THREE.MathUtils.clamp(-turn * 6, -0.5, 0.5) - a.bank) * Math.min(1, dt * 2);
        dummy.rotateZ(a.bank);
        a.quat.slerp(dummy.quaternion, 1 - Math.exp(-dt * (sp.behavior === 'cruise' ? 2.5 : 4)));
      }
      a.phase += dt * sp.freq * (0.55 + 0.45 * speed / sp.speed[1]);
      g.phase.array[i] = a.phase;
      const s = smooth(Math.min(1, Math.max(0, a.scale))) * a.size;
      mat4.compose(a.pos, a.quat, tmp2.set(s, s, s));
      mesh.setMatrixAt(i, mat4);
    }
    mesh.count = g.agents.length;
    mesh.instanceMatrix.needsUpdate = true;
    g.phase.needsUpdate = true;
  }

  stats() {
    const out = {};
    for (const k of SPECIES_ORDER) out[k] = { target: this.groups[k].target, live: this.groups[k].agents.filter((a) => !a.leaving).length, slots: this.groups[k].agents.length };
    return out;
  }
}

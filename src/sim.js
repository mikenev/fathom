import * as THREE from 'three';
import { SPECIES } from './fish.js';
import { patchMaterial, shared } from './shaders.js';
import { Field } from './obstacles.js';

const BOUNDS = { minX: -30, maxX: 30, minY: 0.6, maxY: 15, minZ: -32, maxZ: 6 };
const SCHOOL = { radius: 5, sep: 0.75, coh: 0.5, pull: 0.12 };
const PATH = { y: 3.2, yAmp: 1.6, rx: 21, rz: 11, cz: -12 };
const schoolC = new THREE.Vector3(), tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), mat4 = new THREE.Matrix4(), euler = new THREE.Euler(0, 0, 0, 'YXZ');
// scratch space, so the per-frame sim allocates nothing
const vDesired = new THREE.Vector3(), vCoh = new THREE.Vector3(), vAli = new THREE.Vector3(), vSep = new THREE.Vector3();
const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3(), vSteer = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const nrm = { x: 0, y: 0, z: 0 }, nrm2 = { x: 0, y: 0, z: 0 }, hit = { x: 0, y: 0, z: 0 };
// Body size for collisions, as fractions of a species' length: half its thickness, and how far
// the head and tail reach from the middle. Collision checks use the head, middle and tail.
const BODY = { radius: 0.13, reach: 0.42 };
// Sharks turn at most SHARK_TURN radians per second in open water, up to SHARK_TURN_NEAR close
// to rock, and the turn rate itself changes no faster than SHARK_TURN_ACC per second, so the
// heading eases from one turn into the next instead of flicking side to side.
const SHARK_TURN = 0.9, SHARK_TURN_NEAR = 1.5, SHARK_TURN_ACC = 4;
// How each kind of swimmer looks ahead and steers around rock, coral, kelp and the seabed.
// look: seconds of travel ahead plus a fraction of body length; band: how close before it reacts;
// floor: the same for the seabed, kept small so bottom swimmers can still hug it.
const AVOID = {
  fish: { look: 0.6, lookLen: 0.5, band: 0.9, gain: 3.2, room: 0.25, floor: 0.35 },
  cruise: { look: 1.4, lookLen: 0.6, band: 2.2, gain: 2.6, room: 0.8, floor: 0.5, turnAway: 1.5 },
  // clownfish weave right through their anemone, so they only shy from rock at close range
  home: { look: 0.5, lookLen: 0.5, band: 0.5, gain: 3.5, room: 0.08, floor: 0.15 },
};
// Clownfish: how hard they are pulled back to their anemone, and the loose figure-eight they
// weave over it (radius as a fraction of homeR, height range above the home point).
const ANEMONE = { pull: 1.6, outside: 2.2, weave: 0.5, rise: 0.25, maxAcc: 3 };
const wrapAngle = (x) => Math.atan2(Math.sin(x), Math.cos(x));
// How far each kind of swimmer may roll into a turn and nose up or down (radians).
// Small fish stay almost level; sharks bank a little more, the way big fish carve a turn.
const POSE = {
  fish: { roll: 0.1, rollGain: 0.09, pitch: 0.26, pitchEase: 0.55, turn: 4 },
  cruise: { roll: 0.3, rollGain: 1.1, pitch: 0.2, pitchEase: 0.7, turn: 5 },
};
const smooth = (x) => x * x * (3 - 2 * x);
const soft = (v, lo, hi, w) => (v < lo + w ? (lo + w - v) / w : 0) - (v > hi - w ? (v - (hi - w)) / w : 0);

// Sum of slow sines: smooth, never repeating within a viewing session.
function noise(t, s) {
  return Math.sin(t * 0.13 + s * 7.1) * 0.5 + Math.sin(t * 0.071 + s * 3.3) * 0.35 + Math.sin(t * 0.037 + s * 11.7) * 0.15;
}

// A soft additive glow around each bioluminescent fish, so the light reads at a distance.
function halo(sp) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(sp.max * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(sp.max), 1).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color(sp.glow) }, uTime: shared.uTime, uPix: { value: Math.min(window.devicePixelRatio, 2) } },
    vertexShader: `attribute float aSize; uniform float uTime, uPix; varying float vA;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float pulse = 0.75 + 0.25 * sin(uTime * 1.3 + position.x * 0.7);
        gl_PointSize = aSize * uPix * 260.0 / -mv.z;
        vA = pulse * (1.0 - smoothstep(8.0, 60.0, -mv.z)) * step(0.001, aSize);
      }`,
    fragmentShader: `uniform vec3 uColor; varying float vA;
      void main(){ float r = length(gl_PointCoord - 0.5); float a = exp(-r * r * 14.0) * vA; gl_FragColor = vec4(uColor * a * 2.4, a); }`,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.userData.size = sp.halo?.size ?? sp.length * (sp.behavior === 'cruise' ? 2.2 : 7);
  pts.userData.offset = new THREE.Vector3(...(sp.halo?.offset || [0, 0, 0]));
  return pts;
}

const homed = (sp) => sp.behavior === 'anemone' || sp.behavior === 'territory';

// One aquarium per scene: the species that scene uses, living in its environment.
// env: { floor(x, z), obstacles: [{x, y, z, r}], homes: [Vector3] }
export class Aquarium {
  constructor(scene, env, def) {
    this.scene = scene;
    this.reef = env;
    this.floor = env.floor;
    // every solid thing in the scene, for collision and avoidance
    this.field = new Field(env.floor, env.obstacles || []);
    // a home a fish keeps returning to must have room around it
    // (and the anemone drawn there moves with it, so the fish hover over the anemone you see)
    for (const h of env.homes || []) {
      this.field.clear(h, 0.55, 0.45);
      if (h.mesh) h.mesh.position.set(h.x, env.floor(h.x, h.z) + (h.meshDrop ?? -0.05), h.z);
    }
    this._sharks = [];
    this.B = { ...BOUNDS, ...(def.bounds || {}) };
    this.schoolY = def.schoolY ?? 5.5;
    this.order = def.species;
    this.time = 0;
    this.groups = {};
    this.rand = Math.random;
    for (const key of this.order) {
      const sp = SPECIES[key];
      const geo = sp.build();
      const phase = new THREE.InstancedBufferAttribute(new Float32Array(sp.max), 1);
      phase.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aPhase', phase);
      const mat = patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: key === 'blacktip' ? 0.55 : 0.4, metalness: 0.05, side: THREE.DoubleSide, ...(sp.mat || {}) }), { caustic: 0.45, wiggle: { length: sp.length, amp: sp.wiggle }, glow: sp.glow ?? null });
      const mesh = new THREE.InstancedMesh(geo, mat, sp.max);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.groups[key] = { key, sp, mesh, phase, agents: [], target: 0, schoolSeed: Math.random() * 100, halo: sp.glow ? halo(sp) : null };
      if (this.groups[key].halo) scene.add(this.groups[key].halo);
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

  randomSpawn(sp, back, home) {
    const rand = this.rand, B = this.B;
    // room for the whole body (head to tail), not just its middle
    const room = sp.length * 0.75 + 0.15;
    if (home) return this.field.clear(new THREE.Vector3(home.x + (rand() - 0.5) * 2, home.y + rand() * 1.2, home.z + (rand() - 0.5) * 2), room, room);
    const x = B.minX + rand() * (B.maxX - B.minX);
    const z = back ? B.minZ + 1 + rand() * 6 : B.minZ + rand() * (B.maxZ - B.minZ - 6);
    const ground = Math.max(B.minY, this.floor(x, z));
    const y = sp.behavior === 'school' ? this.schoolY - 0.5 + rand() * 5 : ground + 1.5 + rand() * 5;
    return this.field.clear(new THREE.Vector3(x, y, z), room, room);
  }

  spawn(g, instant) {
    const sp = g.sp, r = this.rand;
    const i = g.agents.length;
    const homes = this.reef.homes || [];
    // territory fish pick a spread of homes; clownfish fill anemones in order
    const home = homed(sp) && homes.length ? homes[sp.behavior === 'anemone' ? i % homes.length : Math.floor(r() * homes.length)] : null;
    const a = {
      pos: this.randomSpawn(sp, !instant, home),
      vel: new THREE.Vector3(r() - 0.5, (r() - 0.5) * 0.2, r() - 0.5).normalize().multiplyScalar(sp.speed[0]),
      quat: new THREE.Quaternion(),
      seed: r() * 100,
      phase: r() * 6.28,
      cruise: sp.speed[0] + r() * (sp.speed[1] - sp.speed[0]),
      scale: instant ? 1 : 0,
      leaving: false,
      home,
      size: (sp.behavior === 'cruise' ? 1 : sp.scale ?? 1.45) * (0.85 + r() * 0.3),
      roll: 0,
      pitch: 0,
      yaw: 0,
      sp,
      len: sp.length,
      turnRate: 0, // sharks: current heading change, radians per second
      urge: 0, // how close the nearest obstacle ahead is, 0 (clear) to 1
      bump: new THREE.Vector3(), // sharks: the way out of the last thing the body touched
    };
    if (sp.behavior === 'cruise') {
      a.path = { ...PATH, ...(sp.path || {}) };
      a.loop = { dir: i % 2 ? -1 : 1, theta: r() * 6.28, cx: (r() - 0.5) * 6, cz: a.path.cz - r() * 4, seed: r() * 10 };
      a.size = 0.95 + r() * 0.1;
      a.carrot = new THREE.Vector3();
      a.pos.copy(this.cruiseTarget(a, 0, a.carrot));
      // the shark chases a point a little ahead on its loop, and faces it from the first frame
      const L = a.loop, lead = this.lead(sp);
      for (let k = 0; k < 400 && this.cruiseTarget(a, 0, a.carrot).distanceTo(a.pos) < lead; k++) L.theta += 0.01 * L.dir;
      a.vel.copy(a.carrot).sub(a.pos).setLength(a.cruise);
      this.field.clear(a.pos, sp.length * (BODY.reach + BODY.radius) * a.size + 0.1);
    }
    a.yaw = Math.atan2(a.vel.x, a.vel.z);
    a.quat.setFromEuler(euler.set(0, a.yaw, 0));
    return a;
  }

  // A slowly breathing ellipse. Bottom cruisers (path.bottom) follow the floor instead of a fixed depth.
  // Writes into out, so nothing is allocated per frame.
  cruisePoint(a, t, out) {
    const L = a.loop, s = L.seed, P = a.path;
    const rx = P.rx + 4 * Math.sin(t * 0.021 + s), rz = P.rz + 3 * Math.cos(t * 0.017 + s * 1.7);
    const th = L.theta;
    // a lazy side-to-side meander on top of the loop, so the shark turns and banks
    const x = L.cx + Math.cos(th) * rx + 1.4 * Math.sin(th * 5 + s * 3);
    const z = L.cz + Math.sin(th) * rz + 4 * Math.sin(t * 0.011 + s) * Math.max(0, Math.sin(th));
    // slow depth changes: a long swell plus an occasional gentle dive or climb
    const bob = P.yAmp * Math.sin(t * 0.043 + s * 2.1) + P.yAmp * 0.5 * Math.sin(th * 2 + s) + (P.dive ?? 1) * Math.sin(t * 0.09 + s * 4.3) * Math.sin(th * 3 + s * 2);
    const y = P.bottom != null ? this.floor(x, z) + P.bottom + Math.abs(bob) : P.y + bob;
    return out.set(x, y, z);
  }

  // A point on the loop, moved clear of the seabed and every rock, coral and kelp stipe,
  // with room for the shark's body, so a shark is never led into anything.
  cruiseTarget(a, t, out) {
    // room for the whole body to swing round it, head to tail, plus a margin, so the loop stays
    // in open water rather than threading the gaps between rocks; bottom cruisers keep the
    // usual small floor clearance so they can still hug the seabed
    const room = a.path.room ?? 0, len = a.len * a.size;
    const r = this.bodyRadius(a) + len * BODY.reach + 0.9 + room;
    return this.field.clear(this.cruisePoint(a, t, out), r, this.bodyRadius(a) + 0.6 + room);
  }

  lead(sp) { return Math.max(2.5, sp.length * 0.8); }
  bodyRadius(a) { return a.len * a.size * BODY.radius; }

  update(dt, t) {
    this.time = t;
    const sharks = this._sharks;
    sharks.length = 0;
    for (const key of this.order) if (this.groups[key].sp.behavior === 'cruise') for (const s of this.groups[key].agents) sharks.push(s);
    for (const key of this.order) {
      const g = this.groups[key];
      const sp = g.sp;
      // school center wanders slowly through midwater
      const sc = schoolC.set(noise(t, g.schoolSeed) * 12, this.schoolY + noise(t * 0.8, g.schoolSeed + 3) * 2, -8 + noise(t * 0.9, g.schoolSeed + 7) * 7);
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
    const L = a.loop, sp = a.sp;
    // advance the target along the loop at the shark's cruise speed, easing off if the shark falls behind
    const before = this.cruisePoint(a, t, vA);
    const th = L.theta; L.theta += 0.01 * L.dir;
    const arc = Math.max(0.01, this.cruisePoint(a, t, vB).distanceTo(before) / 0.01);
    L.theta = th;
    // cruise speed drifts: short glides and gentle surges
    const speed = a.cruise * (1 + 0.22 * Math.sin(t * 0.23 + L.seed * 5) + 0.1 * Math.sin(t * 0.61 + L.seed * 9));
    const lead = this.lead(sp), gap = a.carrot.distanceTo(a.pos);
    L.theta += (speed / arc) * dt * L.dir * THREE.MathUtils.clamp(2 - gap / lead, 0.2, 1.4);
    // The cleared target can hop to the far side of a rock as the loop point slides past it;
    // the carrot glides there instead, so the shark's aim never jumps.
    const goal = this.cruiseTarget(a, t, vC), hop = goal.distanceTo(a.carrot), glide = speed * 2.5 * dt;
    if (hop > glide) a.carrot.lerp(goal, glide / hop); else a.carrot.copy(goal);
    // steer toward it like a fish would, so turns stay smooth when the target bends around a rock
    const acc = vSteer.copy(a.carrot).sub(a.pos).setLength(speed).sub(a.vel).multiplyScalar(1.6);
    if (acc.length() > 2.0) acc.setLength(2.0);
    a.urge += (this.avoid(a, acc, AVOID.cruise) - a.urge) * Math.min(1, dt * 4);
    // after touching something, ease away from it over the next frames instead of bouncing off
    acc.addScaledVector(a.bump, 3);
    a.bump.multiplyScalar(Math.max(0, 1 - dt * 3));
    const h0 = Math.hypot(a.vel.x, a.vel.z) > 1e-3 ? Math.atan2(a.vel.x, a.vel.z) : a.yaw;
    a.vel.addScaledVector(acc, dt);
    // A big body turns at a limited rate that itself changes smoothly, so head and tail stay
    // where the sim thinks they are and the heading never flicks back and forth.
    // (never let the horizontal speed reach zero, or the shark would have no heading left to keep)
    const hz = Math.max(Math.hypot(a.vel.x, a.vel.z), speed * 0.2);
    const maxRate = SHARK_TURN + (SHARK_TURN_NEAR - SHARK_TURN) * Math.min(1, a.urge);
    const want = THREE.MathUtils.clamp(wrapAngle(Math.atan2(a.vel.x, a.vel.z) - h0) / Math.max(dt, 1e-4), -maxRate, maxRate);
    const dr = SHARK_TURN_ACC * (1 + a.urge) * dt;
    a.turnRate += THREE.MathUtils.clamp(want - a.turnRate, -dr, dr);
    const h = h0 + a.turnRate * dt;
    a.vel.x = Math.sin(h) * hz; a.vel.z = Math.cos(h) * hz;
    // climb and dive no steeper than the body can pitch, so head and tail follow the real path
    const horiz = Math.hypot(a.vel.x, a.vel.z), vyMax = horiz * 0.32;
    if (Math.abs(a.vel.y) > vyMax) a.vel.y = Math.sign(a.vel.y) * vyMax;
    // slow down close to rock, so the same turn rate makes a tighter turn
    const v = a.vel.length(), lo = speed * (0.55 - 0.2 * a.urge), hi = speed * 1.3;
    if (v > hi) a.vel.multiplyScalar(hi / v);
    else if (v < lo) a.vel.multiplyScalar(lo / Math.max(v, 1e-3));
    this.move(a, dt);
  }

  // Look ahead along the swim direction and turn away from anything solid or the seabed,
  // sideways or over the top rather than straight back, and push off anything very close.
  avoid(a, acc, P) {
    const F = this.field, len = a.len * a.size, rb = len * BODY.radius;
    const v = a.vel.length() || 1e-3;
    const fx = a.vel.x / v, fy = a.vel.y / v, fz = a.vel.z / v;
    const look = len * P.lookLen + v * P.look;
    const px = a.pos.x + fx * look, py = a.pos.y + fy * look, pz = a.pos.z + fz * look;
    const d = F.sdf(px, py, pz, nrm) - rb - P.room;
    let urge = 0;
    if (d < P.band) {
      const w = Math.min(1.6, 1 - d / P.band);
      urge = w;
      // the part of the surface normal across the swim direction is the way around
      const along = nrm.x * fx + nrm.y * fy + nrm.z * fz;
      let lx = nrm.x - along * fx, ly = nrm.y - along * fy, lz = nrm.z - along * fz;
      let l = Math.hypot(lx, ly, lz);
      if (l < 0.25) { // dead ahead: pick a side and keep it
        const side = a.seed % 2 < 1 ? 1 : -1;
        lx = fz * side; ly = 0.15; lz = -fx * side; l = Math.hypot(lx, ly, lz);
      }
      const g = P.gain * w;
      acc.x += (lx / l) * g + nrm.x * g * 0.35;
      acc.y += (ly / l) * g + nrm.y * g * 0.35;
      acc.z += (lz / l) * g + nrm.z * g * 0.35;
    }
    const fl = py - this.floor(px, pz) - rb;
    if (fl < P.floor) acc.y += P.gain * Math.min(1.6, 1 - fl / P.floor);
    // close by, the head and tail count too: a turning body swings its ends toward things
    const near = P.band * 0.5, reach = len * BODY.reach, cp = Math.cos(a.pitch);
    const hx = Math.sin(a.yaw) * cp * reach, hy = -Math.sin(a.pitch) * reach, hz = Math.cos(a.yaw) * cp * reach;
    for (let k = -1; k <= 1; k++) {
      const qx = a.pos.x + hx * k, qy = a.pos.y + hy * k, qz = a.pos.z + hz * k;
      const d0 = F.sdf(qx, qy, qz, nrm2) - rb - P.room;
      if (d0 < near) {
        const g = P.gain * Math.min(2, 1 - d0 / near);
        urge = Math.max(urge, 1);
        acc.x += nrm2.x * g; acc.y += nrm2.y * g; acc.z += nrm2.z * g;
        if (P.turnAway) {
          // a swimmer that can't brake (sharks keep a minimum speed) has to turn away instead:
          // add the part of the push that is across the swim direction once more
          const al = nrm2.x * fx + nrm2.y * fy + nrm2.z * fz, t = g * P.turnAway;
          acc.x += (nrm2.x - al * fx) * t; acc.y += (nrm2.y - al * fy) * t; acc.z += (nrm2.z - al * fz) * t;
        }
      }
      const f0 = qy - this.floor(qx, qz) - rb, fn = P.floor * 0.5;
      if (f0 < fn) acc.y += P.gain * Math.min(2, 1 - f0 / fn);
    }
    return Math.min(1, urge);
  }

  // Move along the velocity, but slide along any surface the head, middle or tail would touch
  // instead of going into it. Only the step is changed, not the velocity, so the heading stays
  // smooth and the avoidance steering turns the fish away over the next frames.
  move(a, dt) {
    const F = this.field, len = a.len * a.size, rb = len * BODY.radius, reach = len * BODY.reach;
    let sx = a.vel.x * dt, sy = a.vel.y * dt, sz = a.vel.z * dt;
    if (F.shapes.length) {
      const cp = Math.cos(a.pitch);
      const hx = Math.sin(a.yaw) * cp * reach, hy = -Math.sin(a.pitch) * reach, hz = Math.cos(a.yaw) * cp * reach;
      for (let k = -1; k <= 1; k++) {
        const qx = a.pos.x + hx * k + sx, qy = a.pos.y + hy * k + sy, qz = a.pos.z + hz * k + sz;
        if (F.sdf(qx, qy, qz, nrm) - rb < 0.01) {
          const sn = sx * nrm.x + sy * nrm.y + sz * nrm.z;
          if (sn < 0) { sx -= nrm.x * sn; sy -= nrm.y * sn; sz -= nrm.z * sn; }
        }
      }
    }
    a.pos.x += sx; a.pos.y += sy; a.pos.z += sz;
  }

  // Last line of defence: if the head, middle or tail ended up inside something or under the
  // seabed, slide the body back out along the surface and drop the velocity into it.
  // Sharks keep their heading here (only speed into the surface is lost) and steer off the
  // recorded bump over the next frames, so a touch never snaps the heading round.
  resolve(a) {
    const F = this.field, len = a.len * a.size, rb = len * BODY.radius, reach = len * BODY.reach;
    const shark = a.sp.behavior === 'cruise';
    hit.x = hit.y = hit.z = 0;
    for (let pass = 0; pass < 10; pass++) {
      const cp = Math.cos(a.pitch);
      const hx = Math.sin(a.yaw) * cp * reach, hy = -Math.sin(a.pitch) * reach, hz = Math.cos(a.yaw) * cp * reach;
      let moved = false;
      for (let k = -1; k <= 1; k++) {
        const px = a.pos.x + hx * k, py = a.pos.y + hy * k, pz = a.pos.z + hz * k;
        const d = F.sdf(px, py, pz, nrm) - rb;
        if (d < 0) {
          const m = 3e-3 - d;
          a.pos.x += nrm.x * m; a.pos.y += nrm.y * m; a.pos.z += nrm.z * m;
          const vn = a.vel.x * nrm.x + a.vel.y * nrm.y + a.vel.z * nrm.z;
          if (shark) { hit.x += nrm.x * m; hit.y += nrm.y * m; hit.z += nrm.z * m; }
          // drop the speed into the surface (sharks only part of it; they turn away smoothly next)
          if (vn < 0) { const f = shark ? 0.5 : 1; a.vel.x -= nrm.x * vn * f; a.vel.y -= nrm.y * vn * f; a.vel.z -= nrm.z * vn * f; }
          moved = true;
        }
        const f = py - this.floor(px, pz) - rb;
        if (f < 0) { a.pos.y += 3e-3 - f; if (a.vel.y < 0) a.vel.y = 0; moved = true; }
      }
      if (!moved) break;
    }
    if (shark && (hit.x || hit.y || hit.z)) {
      const l = Math.hypot(hit.x, hit.y, hit.z) || 1;
      a.bump.set(hit.x / l, hit.y / l, hit.z / l);
    }
  }

  // How far the worst point of a body is inside anything (0 when clear). Used by tests.
  penetration(a) {
    const F = this.field, len = a.len * a.size, rb = len * BODY.radius, reach = len * BODY.reach;
    const cp = Math.cos(a.pitch);
    const hx = Math.sin(a.yaw) * cp * reach, hy = -Math.sin(a.pitch) * reach, hz = Math.cos(a.yaw) * cp * reach;
    let worst = 0;
    for (let k = -1; k <= 1; k++) {
      const px = a.pos.x + hx * k, py = a.pos.y + hy * k, pz = a.pos.z + hz * k;
      worst = Math.max(worst, rb - F.sdf(px, py, pz, nrm), rb - (py - this.floor(px, pz)));
    }
    return worst;
  }

  stepFish(a, g, i, dt, t, schoolCenter, sharks) {
    const sp = g.sp;
    const acc = tmp.set(0, 0, 0);
    const desired = vDesired.set(0, 0, 0);
    const B = this.B;
    if (sp.behavior === 'school') {
      const S = sp.school || SCHOOL;
      const coh = vCoh.set(0, 0, 0), ali = vAli.set(0, 0, 0), sep = vSep.set(0, 0, 0);
      let n = 0;
      for (let j = 0; j < g.agents.length; j++) {
        if (j === i) continue;
        const b = g.agents[j];
        const d = a.pos.distanceTo(b.pos);
        if (d < S.radius) {
          coh.add(b.pos); ali.add(b.vel); n++;
          if (d < S.sep) sep.addScaledVector(tmp2.copy(a.pos).sub(b.pos), (S.sep - d) / Math.max(d, 0.05));
        }
      }
      if (n) {
        coh.divideScalar(n).sub(a.pos).multiplyScalar(S.coh);
        ali.divideScalar(n).sub(a.vel).multiplyScalar(0.6);
        acc.add(coh).add(ali);
      }
      acc.addScaledVector(sep, 2.2);
      acc.addScaledVector(desired.copy(schoolCenter).sub(a.pos), S.pull);
    } else {
      // wander: heading driven by smooth noise
      const yaw = noise(t * 1.4, a.seed) * Math.PI * 2.2;
      const pitch = noise(t * 1.1, a.seed + 5) * 0.25;
      desired.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(a.cruise);
      const anem = sp.behavior === 'anemone' && a.home;
      acc.addScaledVector(desired.sub(a.vel), anem ? 0.25 : 0.6);
      if (anem) {
        // weave a loose figure-eight in and over the anemone, always pulled back to it
        const R = sp.homeR ?? 1.4, w = 0.55 + (a.seed % 1) * 0.3, ph = t * w + a.seed;
        const tx = a.home.x + Math.sin(ph) * R * ANEMONE.weave, tz = a.home.z + Math.sin(ph * 2) * R * ANEMONE.weave * 0.6;
        const ty = a.home.y + ANEMONE.rise * Math.sin(ph * 1.3 + 1);
        const d = tmp2.set(tx - a.pos.x, ty - a.pos.y, tz - a.pos.z);
        acc.addScaledVector(d, ANEMONE.pull);
        const out = a.pos.distanceTo(a.home) - R;
        if (out > 0) acc.addScaledVector(d.normalize(), ANEMONE.outside * Math.min(2, out));
      } else if (a.home) {
        const d = tmp2.copy(a.home).sub(a.pos);
        const dist = d.length();
        const R = sp.homeR ?? 1.4;
        if (dist > R) acc.addScaledVector(d, 0.35 * smooth(Math.min(1, (dist - R) / 2)));
      } else {
        const d = tmp2.set(0, Math.max(3.5, this.schoolY), -8).sub(a.pos);
        const dist = d.length();
        if (dist > 16) acc.addScaledVector(d.normalize(), 0.5 * Math.min(1, (dist - 16) / 8));
      }
      // personal space; anemone partners share a small anemone, so they keep less of it
      const ps = anem ? 0.45 : 1.0;
      for (let j = 0; j < g.agents.length; j++) {
        if (j === i) continue;
        const d = a.pos.distanceTo(g.agents[j].pos);
        if (d < ps) acc.addScaledVector(tmp2.copy(a.pos).sub(g.agents[j].pos), (ps - d) * 1.5 / Math.max(d, 0.05));
      }
    }
    // stay inside the tank volume with soft walls
    acc.x += soft(a.pos.x, B.minX, B.maxX, 5) * 1.5;
    acc.z += soft(a.pos.z, B.minZ, B.maxZ, 5) * 1.5;
    const hug = sp.behavior === 'anemone' && a.home;
    const floor = Math.max(B.minY, this.floor(a.pos.x, a.pos.z) + this.bodyRadius(a) + (hug ? 0.08 : a.home ? 0.25 : 0.8));
    acc.y += soft(a.pos.y, floor, B.maxY, hug ? 0.4 : 1.6) * 2.0;
    // give cruising sharks room, calmly (clownfish just tuck into their anemone instead)
    if (!hug) for (const s of sharks) {
      const d = a.pos.distanceTo(s.pos);
      if (d < 5) acc.addScaledVector(tmp2.copy(a.pos).sub(s.pos).normalize(), (5 - d) * 0.35 * s.scale);
    }
    const maxAcc = sp.behavior === 'school' ? (sp.school?.maxAcc ?? 2.2) : hug ? ANEMONE.maxAcc : 1.4;
    if (acc.length() > maxAcc) acc.setLength(maxAcc);
    // steer around rock, coral, kelp and the seabed; this comes after the cap so it always wins
    this.avoid(a, acc, hug ? AVOID.home : AVOID.fish);
    a.vel.addScaledVector(acc, dt);
    a.vel.y *= 1 - Math.min(1, dt * 0.8);
    const sp2 = a.vel.length();
    const lo = sp.speed[0], hi = sp.speed[1];
    if (sp2 > hi) a.vel.multiplyScalar(hi / sp2);
    else if (sp2 < lo) {
      // Fish can't hover, so a fish braking against its heading turns instead; just scaling
      // the speed back up would undo the brake and leave it drifting away from where it wants to go.
      const v0 = vC.copy(a.vel).addScaledVector(acc, -dt);
      const al = acc.length(), dot = al > 1e-3 ? v0.dot(acc) / (v0.length() * al + 1e-6) : 1;
      if (dot < 0) {
        const side = tmp2.crossVectors(v0, UP);
        if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
        side.normalize();
        if (side.dot(acc) < 0 || (Math.abs(side.dot(acc)) < 1e-3 && a.seed % 1 < 0.5)) side.negate();
        a.vel.addScaledVector(side, lo * Math.min(1, -dot * 2.5 * dt * 2));
      }
      a.vel.multiplyScalar(lo / Math.max(a.vel.length(), 1e-3));
    }
    this.move(a, dt);
  }

  writeInstances(g, dt) {
    const sp = g.sp, mesh = g.mesh;
    for (let i = 0; i < g.agents.length; i++) {
      const a = g.agents[i];
      const speed = a.vel.length();
      tmp.copy(a.vel).normalize();
      if (speed > 1e-3) {
        // Heading from the velocity, built as yaw, then a limited pitch, then a small roll,
        // so bodies stay level with the swim direction instead of tilting on the z axis.
        const P = sp.behavior === 'cruise' ? POSE.cruise : POSE.fish;
        const k = 1 - Math.exp(-dt * P.turn);
        let dyaw = wrapAngle(Math.atan2(a.vel.x, a.vel.z) - a.yaw) * k;
        // Turn the body only as far as there's room: swinging the head or tail into rock would
        // just make the collision push shove the whole fish sideways.
        if (dyaw !== 0 && this.field.shapes.length) {
          const y0 = a.yaw, p0 = this.penetration(a);
          a.yaw = y0 + dyaw;
          if (this.penetration(a) > Math.max(p0, 1e-4)) {
            a.yaw = y0 + dyaw * 0.3;
            dyaw = this.penetration(a) > Math.max(p0, 1e-4) ? 0 : dyaw * 0.3;
          }
          a.yaw = y0;
        }
        a.yaw = wrapAngle(a.yaw + dyaw);
        const yawRate = dyaw / Math.max(dt, 1e-4);
        const horiz = Math.hypot(a.vel.x, a.vel.z);
        const pitch = THREE.MathUtils.clamp(-Math.atan2(a.vel.y, horiz) * P.pitchEase, -P.pitch, P.pitch);
        a.pitch += (pitch - a.pitch) * k;
        const roll = THREE.MathUtils.clamp(-yawRate * P.rollGain, -P.roll, P.roll);
        a.roll += (roll - a.roll) * (1 - Math.exp(-dt * 2));
        // sharks swing their head a little with each tail beat
        const swing = sp.behavior === 'cruise' ? Math.sin(a.phase - 1.0) * 0.045 : 0;
        a.quat.setFromEuler(euler.set(a.pitch, a.yaw + swing, a.roll));
      }
      this.resolve(a);
      a.phase += dt * sp.freq * (0.55 + 0.45 * speed / sp.speed[1]);
      g.phase.array[i] = a.phase;
      const s = smooth(Math.min(1, Math.max(0, a.scale))) * a.size;
      mat4.compose(a.pos, a.quat, tmp2.set(s, s, s));
      mesh.setMatrixAt(i, mat4);
    }
    mesh.count = g.agents.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (g.halo) {
      const P = g.halo.geometry.attributes.position, S = g.halo.geometry.attributes.aSize;
      for (let i = 0; i < g.agents.length; i++) {
        const a = g.agents[i];
        const k = smooth(Math.min(1, Math.max(0, a.scale))) * a.size;
        const o = tmp.copy(g.halo.userData.offset).multiplyScalar(k).applyQuaternion(a.quat).add(a.pos);
        P.setXYZ(i, o.x, o.y, o.z);
        S.setX(i, k * g.halo.userData.size);
      }
      g.halo.geometry.setDrawRange(0, g.agents.length);
      P.needsUpdate = true; S.needsUpdate = true;
    }
    g.phase.needsUpdate = true;
  }

  stats() {
    const out = {};
    for (const k of this.order) out[k] = { target: this.groups[k].target, live: this.groups[k].agents.filter((a) => !a.leaving).length, slots: this.groups[k].agents.length };
    return out;
  }
}

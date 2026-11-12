// Solid things fish must not swim through, as simple shapes on a coarse grid.
// Shapes reach down into the seabed, so nothing can slip underneath:
//   cyl:  an upright column of radius R up to height y, from the seabed or from lo (coral, kelp stipes)
//   dome: a column of radius R up to y, capped by a half-spheroid H tall (rocks, boulders, brain coral)
// sdf() gives the signed distance to the nearest shape (negative inside) and its outward normal.

export const CYL = 0, DOME = 1;
const CELL = 4, PAD = 4.5; // a query finds every shape within PAD of the point

export function cyl(x, z, top, R, lo = -Infinity) { return { kind: CYL, x, z, y: top, R, H: 0, lo }; }
export function dome(x, z, base, R, H) { return { kind: DOME, x, z, y: base, R, H }; }

// Fit a shape around a finished geometry, before it is rotated about Y and moved to (x, base, z).
// Turning about the vertical axis does not change how far a vertex is from it, so the fit holds.
export function fitShape(geo, kind, x, z, base, pad = 1.04) {
  const p = geo.attributes.position;
  let R = 1e-3, top = 1e-3;
  for (let i = 0; i < p.count; i++) {
    R = Math.max(R, Math.hypot(p.getX(i), p.getZ(i)));
    top = Math.max(top, p.getY(i));
  }
  if (kind === CYL) return cyl(x, z, base + top * pad, R * pad);
  // grow the spheroid until it contains every vertex above the base
  let k = 1;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y > 0) k = Math.max(k, Math.hypot(Math.hypot(p.getX(i), p.getZ(i)) / R, y / top));
  }
  return dome(x, z, base, R * k * pad, top * k * pad);
}

// A table coral: a stem column and a flat plate (a column section that ends at both faces).
export function fitTable(geo, x, z, base, pad = 1.04) {
  const p = geo.attributes.position;
  let R = 1e-3, top = 1e-3;
  for (let i = 0; i < p.count; i++) { R = Math.max(R, Math.hypot(p.getX(i), p.getZ(i))); top = Math.max(top, p.getY(i)); }
  // the plate is everything out past half the radius; the stem is what stands under it
  let lo = top, stem = 1e-3;
  for (let i = 0; i < p.count; i++) if (Math.hypot(p.getX(i), p.getZ(i)) > R * 0.5) lo = Math.min(lo, p.getY(i));
  // only what stands below the plate counts toward the stem, not the plate's own inner rings
  for (let i = 0; i < p.count; i++) if (p.getY(i) < lo) stem = Math.max(stem, Math.hypot(p.getX(i), p.getZ(i)));
  const plate = cyl(x, z, base + top + 0.02, R * pad, base + lo - 0.02);
  plate.face = true;
  return [cyl(x, z, base + lo, stem * pad + 0.02), plate];
}

// A sea fan is flat (its branches lie in the x-y plane before it is turned by rotY), so it is
// a row of slim columns along its width rather than one column as wide as the whole fan.
export function fitFan(geo, x, z, base, rotY, bins = 4, pad = 1.04) {
  const p = geo.attributes.position;
  let x0 = Infinity, x1 = -Infinity, thick = 1e-3;
  for (let i = 0; i < p.count; i++) { x0 = Math.min(x0, p.getX(i)); x1 = Math.max(x1, p.getX(i)); thick = Math.max(thick, Math.abs(p.getZ(i))); }
  const w = (x1 - x0) / bins || 1e-3, tops = new Array(bins).fill(-Infinity);
  for (let i = 0; i < p.count; i++) {
    const b = Math.min(bins - 1, Math.floor((p.getX(i) - x0) / w));
    tops[b] = Math.max(tops[b], p.getY(i));
  }
  const c = Math.cos(rotY), s = Math.sin(rotY), out = [];
  for (let b = 0; b < bins; b++) {
    if (tops[b] === -Infinity) continue;
    const u = x0 + (b + 0.5) * w; // three.js rotateY: (u, 0) goes to (u cos, -u sin)
    out.push(cyl(x + u * c, z - u * s, base + tops[b] * pad, Math.hypot(w / 2, thick) * pad));
  }
  return out;
}

// Distance from (x, y, z) to one shape; writes the outward normal into n.
function shapeDist(s, x, y, z, n) {
  const dx = x - s.x, dz = z - s.z, rho = Math.hypot(dx, dz);
  const hx = rho > 1e-5 ? dx / rho : 1, hz = rho > 1e-5 ? dz / rho : 0;
  const dy = y - s.y;
  if (s.kind === CYL) {
    // a column from lo (usually under the sand) to its top
    const dr = rho - s.R, db = s.lo - y, dv = Math.max(dy, db), sy = dy > db ? 1 : -1;
    if (dr <= 0 && dv <= 0) { // inside: leave by the nearest face, or always sideways for a
      // stacked section (kelp), so neighbouring sections never push a fish back and forth;
      // a flat plate (face) is left by its top or bottom when that is nearer
      if (dr > dv || (s.lo > -Infinity && !s.face)) { n.x = hx; n.y = 0; n.z = hz; return dr; }
      n.x = 0; n.y = sy; n.z = 0; return dv;
    }
    if (dv <= 0) { n.x = hx; n.y = 0; n.z = hz; return dr; }
    if (dr <= 0) { n.x = 0; n.y = sy; n.z = 0; return dv; }
    const l = Math.hypot(dr, dv); n.x = hx * dr / l; n.y = sy * dv / l; n.z = hz * dr / l; return l;
  }
  if (dy <= 0) { n.x = hx; n.y = 0; n.z = hz; return rho - s.R; }
  // spheroid cap: the usual cheap distance estimate k0 (k0 - 1) / k1
  const R = s.R, H = s.H;
  const qr = rho / R, qy = dy / H;
  const k0 = Math.hypot(qr, qy), k1 = Math.hypot(qr / R, qy / H);
  const gr = qr / R, gy = qy / H, gl = Math.hypot(gr, gy) || 1;
  n.x = hx * gr / gl; n.y = gy / gl; n.z = hz * gr / gl;
  return k1 > 1e-6 ? (k0 * (k0 - 1)) / k1 : -Math.min(R, H);
}

export class Field {
  constructor(floor, shapes = []) {
    this.floor = floor;
    this.shapes = shapes;
    this.cells = new Map();
    for (const s of shapes) {
      const r = s.R + PAD;
      for (let cx = Math.floor((s.x - r) / CELL); cx <= Math.floor((s.x + r) / CELL); cx++)
        for (let cz = Math.floor((s.z - r) / CELL); cz <= Math.floor((s.z + r) / CELL); cz++) {
          const key = cx * 4096 + cz;
          let list = this.cells.get(key);
          if (!list) this.cells.set(key, (list = []));
          list.push(s);
        }
    }
    this._n = { x: 0, y: 0, z: 0 };
  }

  // Signed distance to the nearest shape (Infinity when none is within reach); normal into n.
  sdf(x, y, z, n) {
    const list = this.cells.get(Math.floor(x / CELL) * 4096 + Math.floor(z / CELL));
    let best = Infinity;
    if (!list) return best;
    const m = this._n;
    for (let i = 0; i < list.length; i++) {
      const d = shapeDist(list[i], x, y, z, m);
      if (d < best) { best = d; n.x = m.x; n.y = m.y; n.z = m.z; }
    }
    return best;
  }

  // Move a point (any {x, y, z}) until it is at least `clear` from every shape and above the floor.
  clear(p, clear, floorClear = clear) {
    const n = this._q || (this._q = { x: 0, y: 0, z: 0 });
    for (let it = 0; it < 6; it++) {
      const d = this.sdf(p.x, p.y, p.z, n);
      const f = p.y - this.floor(p.x, p.z) - floorClear;
      if (d >= clear - 1e-4 && f >= 0) break;
      if (d < clear) { const m = clear - d + 0.01; p.x += n.x * m; p.y += n.y * m; p.z += n.z * m; }
      const f2 = p.y - this.floor(p.x, p.z) - floorClear;
      if (f2 < 0) p.y -= f2 - 0.01;
    }
    return p;
  }
}

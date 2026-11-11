// Tiny signed-distance modelling kit: the cat's body is described as a set of
// soft-blended round cones and ellipsoids, then turned into one seamless mesh.

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Smooth minimum: blends two distances over a region of size k. */
export function smin(a, b, k) {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/**
 * Describe a primitive: a segment a→b whose radius goes from ra to rb.
 * `squash` flattens it per axis (about its centre), `k` is how softly it blends
 * into what is already there, and `carve` subtracts it instead of adding it.
 */
export function prim({ tag, a, b = a, ra, rb = ra, k = 0.03, squash = [1, 1, 1], carve = false }) {
  return {
    tag, a, b, ra, rb, k, carve, squash,
    c: [0, 1, 2].map((i) => (a[i] + b[i]) / 2),
    shrink: Math.min(...squash),
  };
}

export function primDistance(p, x, y, z) {
  const [sx, sy, sz] = p.squash;
  x = p.c[0] + (x - p.c[0]) / sx;
  y = p.c[1] + (y - p.c[1]) / sy;
  z = p.c[2] + (z - p.c[2]) / sz;
  const [ax, ay, az] = p.a;
  const dx = p.b[0] - ax;
  const dy = p.b[1] - ay;
  const dz = p.b[2] - az;
  const len2 = dx * dx + dy * dy + dz * dz;
  const t = len2 > 0 ? clamp(((x - ax) * dx + (y - ay) * dy + (z - az) * dz) / len2, 0, 1) : 0;
  const d = Math.hypot(x - ax - t * dx, y - ay - t * dy, z - az - t * dz) - (p.ra + (p.rb - p.ra) * t);
  return d * p.shrink;
}

/** Sample the blended primitives on a regular grid. Returns { field, n, min, cell }. */
export function buildField(prims, min, max, cell) {
  const n = [0, 1, 2].map((i) => Math.ceil((max[i] - min[i]) / cell) + 1);
  const field = new Float32Array(n[0] * n[1] * n[2]).fill(1e3);
  for (const p of prims) {
    // Each primitive only touches the grid points near it.
    const pad = Math.max(p.ra, p.rb) + p.k + cell * 2;
    const lo = [0, 1, 2].map((i) => clamp(Math.floor((Math.min(p.a[i], p.b[i]) - pad - min[i]) / cell), 0, n[i] - 1));
    const hi = [0, 1, 2].map((i) => clamp(Math.ceil((Math.max(p.a[i], p.b[i]) + pad - min[i]) / cell), 0, n[i] - 1));
    for (let iz = lo[2]; iz <= hi[2]; iz++) {
      for (let iy = lo[1]; iy <= hi[1]; iy++) {
        let i = (iz * n[1] + iy) * n[0] + lo[0];
        for (let ix = lo[0]; ix <= hi[0]; ix++, i++) {
          const d = primDistance(p, min[0] + ix * cell, min[1] + iy * cell, min[2] + iz * cell);
          field[i] = p.carve ? -smin(-field[i], d, p.k) : smin(field[i], d, p.k);
        }
      }
    }
  }
  return { field, n, min, cell };
}

/** Naive surface nets: one vertex per grid cell the surface passes through. */
export function surfaceNets({ field, n, min, cell }) {
  const [nx, ny, nz] = n;
  const step = [1, nx, nx * ny];
  const corner = [];
  const offset = [];
  for (let c = 0; c < 8; c++) {
    offset.push([c & 1, (c >> 1) & 1, (c >> 2) & 1]);
    corner.push((c & 1) * step[0] + ((c >> 1) & 1) * step[1] + ((c >> 2) & 1) * step[2]);
  }
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];

  const vertexOf = new Int32Array(field.length).fill(-1);
  const positions = [];
  const v = new Float32Array(8);
  for (let z = 0; z < nz - 1; z++) {
    for (let y = 0; y < ny - 1; y++) {
      for (let x = 0; x < nx - 1; x++) {
        const i = x + y * step[1] + z * step[2];
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          v[c] = field[i + corner[c]];
          if (v[c] < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let px = 0;
        let py = 0;
        let pz = 0;
        let count = 0;
        for (const [a, b] of edges) {
          if ((v[a] < 0) === (v[b] < 0)) continue;
          const t = v[a] / (v[a] - v[b]);
          px += offset[a][0] + t * (offset[b][0] - offset[a][0]);
          py += offset[a][1] + t * (offset[b][1] - offset[a][1]);
          pz += offset[a][2] + t * (offset[b][2] - offset[a][2]);
          count++;
        }
        vertexOf[i] = positions.length / 3;
        positions.push(min[0] + (x + px / count) * cell, min[1] + (y + py / count) * cell, min[2] + (z + pz / count) * cell);
      }
    }
  }

  // Every grid edge that crosses the surface becomes a quad joining the four cells around it.
  const indices = [];
  for (let z = 1; z < nz - 1; z++) {
    for (let y = 1; y < ny - 1; y++) {
      for (let x = 1; x < nx - 1; x++) {
        const i = x + y * step[1] + z * step[2];
        const inside = field[i] < 0;
        for (let d = 0; d < 3; d++) {
          if ((field[i + step[d]] < 0) === inside) continue;
          const u = step[(d + 1) % 3];
          const w = step[(d + 2) % 3];
          const q0 = vertexOf[i - u - w];
          const q1 = vertexOf[i - w];
          const q2 = vertexOf[i];
          const q3 = vertexOf[i - u];
          if (inside) indices.push(q0, q1, q2, q0, q2, q3);
          else indices.push(q0, q2, q1, q0, q3, q2);
        }
      }
    }
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

// ---------- Value noise (for coat markings) ----------

function hash3(x, y, z) {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(z, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** Smooth 3D noise in 0..1. */
export function noise3(x, y, z) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const f = (t) => t * t * (3 - 2 * t);
  const tx = f(x - x0);
  const ty = f(y - y0);
  const tz = f(z - z0);
  const mix = (a, b, t) => a + (b - a) * t;
  const row = (y, z) => mix(hash3(x0, y, z), hash3(x0 + 1, y, z), tx);
  return mix(mix(row(y0, z0), row(y0 + 1, z0), ty), mix(row(y0, z0 + 1), row(y0 + 1, z0 + 1), ty), tz);
}

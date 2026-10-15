// Volumetric helpers for the rig builders: voxelise a (possibly leaky) triangle mesh, Euclidean distance transform, and
// the MEDIAL PATH between two points (the minimum-cost path through the distance field = the axis of a tube).
// Why volumetric: the shortest path on the SURFACE hugs the inside of every bend, so surface bands give a centre line
// that sits on the back of the body. The ridge of the distance field is the true centre of the tube, and it ignores
// side branches (limbs, mane, whiskers) because they are thin.
import { Heap, len, sub } from './mesh.mjs';

/**
 * @param p   Float32Array xyz (welded or not)
 * @param idx triangle indices into p
 * @param h   voxel size in world units
 * @returns grid { n:[nx,ny,nz], o:[ox,oy,oz], h, solid:Uint8Array(1 = surface or interior), surf:Uint8Array }
 */
export function voxelize(p, idx, h, { pad = 4, seal = 1 } = {}) {
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p[i+k]); mx[k] = Math.max(mx[k], p[i+k]); }
  const o = mn.map((v) => v - pad * h), n = mx.map((v, k) => Math.ceil((v - o[k]) / h) + pad + 1);
  const N = n[0] * n[1] * n[2], surf = new Uint8Array(N);
  const at = (x, y, z) => x + n[0] * (y + n[1] * z);
  const mark = (x, y, z) => { const ix = Math.floor((x - o[0]) / h), iy = Math.floor((y - o[1]) / h), iz = Math.floor((z - o[2]) / h); surf[at(ix, iy, iz)] = 1; };
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t+1] * 3, c = idx[t+2] * 3;
    const ax = p[a], ay = p[a+1], az = p[a+2];
    const e1 = Math.hypot(p[b]-ax, p[b+1]-ay, p[b+2]-az), e2 = Math.hypot(p[c]-ax, p[c+1]-ay, p[c+2]-az);
    const steps = Math.max(1, Math.ceil(Math.max(e1, e2) / (h * 0.5)));
    for (let i = 0; i <= steps; i++) for (let j = 0; j <= steps - i; j++) {
      const u = i / steps, v = j / steps, w = 1 - u - v;
      mark(w * ax + u * p[b] + v * p[c], w * ay + u * p[b+1] + v * p[c+1], w * az + u * p[b+2] + v * p[c+2]);
    }
  }
  // seal pinholes: dilate the surface by `seal` voxels (6-neighbourhood) before the flood fill
  let wall = surf;
  for (let s = 0; s < seal; s++) {
    const nxt = wall.slice();
    for (let z = 1; z < n[2] - 1; z++) for (let y = 1; y < n[1] - 1; y++) for (let x = 1; x < n[0] - 1; x++) {
      const i = at(x, y, z);
      if (wall[i]) continue;
      if (wall[i-1] || wall[i+1] || wall[i-n[0]] || wall[i+n[0]] || wall[i-n[0]*n[1]] || wall[i+n[0]*n[1]]) nxt[i] = 1;
    }
    wall = nxt;
  }
  // flood the exterior from the grid boundary through non-wall voxels
  const ext = new Uint8Array(N), stack = [0]; ext[0] = 1;
  const sx = 1, sy = n[0], sz = n[0] * n[1];
  while (stack.length) {
    const i = stack.pop();
    const x = i % n[0], y = ((i / n[0]) | 0) % n[1], z = (i / sz) | 0;
    if (x > 0 && !ext[i-sx] && !wall[i-sx]) { ext[i-sx] = 1; stack.push(i-sx); }
    if (x < n[0]-1 && !ext[i+sx] && !wall[i+sx]) { ext[i+sx] = 1; stack.push(i+sx); }
    if (y > 0 && !ext[i-sy] && !wall[i-sy]) { ext[i-sy] = 1; stack.push(i-sy); }
    if (y < n[1]-1 && !ext[i+sy] && !wall[i+sy]) { ext[i+sy] = 1; stack.push(i+sy); }
    if (z > 0 && !ext[i-sz] && !wall[i-sz]) { ext[i-sz] = 1; stack.push(i-sz); }
    if (z < n[2]-1 && !ext[i+sz] && !wall[i+sz]) { ext[i+sz] = 1; stack.push(i+sz); }
  }
  const solid = new Uint8Array(N);
  let inside = 0;
  for (let i = 0; i < N; i++) if (!ext[i]) { solid[i] = 1; inside++; }
  return { n, o, h, solid, surf, N, inside };
}

/** squared-EDT per axis (Felzenszwalb & Huttenlocher), distance in world units from each solid voxel to the nearest non-solid voxel */
export function edt(V) {
  const { n, solid, h, N } = V;
  const INF = 1e12, f = new Float32Array(N);
  for (let i = 0; i < N; i++) f[i] = solid[i] ? INF : 0;
  const pass = (len1, stride, count, base) => {
    const d = new Float64Array(len1), v = new Int32Array(len1), z = new Float64Array(len1 + 1), g = new Float64Array(len1);
    for (let c = 0; c < count; c++) {
      const b = base(c);
      for (let i = 0; i < len1; i++) g[i] = f[b + i * stride];
      let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
      for (let q = 1; q < len1; q++) {
        let s;
        for (;;) { const r = v[k]; s = ((g[q] + q * q) - (g[r] + r * r)) / (2 * q - 2 * r); if (s <= z[k] && k > 0) k--; else break; }
        if (s <= z[k]) { /* k == 0 */ }
        k++; v[k] = q; z[k] = s; z[k + 1] = INF;
      }
      k = 0;
      for (let q = 0; q < len1; q++) { while (z[k + 1] < q) k++; const r = v[k]; d[q] = (q - r) * (q - r) + g[r]; }
      for (let i = 0; i < len1; i++) f[b + i * stride] = d[i];
    }
  };
  pass(n[0], 1, n[1] * n[2], (c) => c * n[0]);
  pass(n[1], n[0], n[0] * n[2], (c) => (c % n[0]) + n[0] * n[1] * ((c / n[0]) | 0));
  pass(n[2], n[0] * n[1], n[0] * n[1], (c) => c);
  const dt = new Float32Array(N);
  for (let i = 0; i < N; i++) dt[i] = solid[i] ? Math.sqrt(f[i]) * h : 0;
  return dt;
}

export const voxelOf = (V, pt) => [Math.floor((pt[0] - V.o[0]) / V.h), Math.floor((pt[1] - V.o[1]) / V.h), Math.floor((pt[2] - V.o[2]) / V.h)];
export const worldOf = (V, ix) => [V.o[0] + (ix[0] + 0.5) * V.h, V.o[1] + (ix[1] + 0.5) * V.h, V.o[2] + (ix[2] + 0.5) * V.h];

/** nearest solid voxel to pt with a decent clearance (snaps surface end points inside the body) */
export function snapInside(V, dt, pt, radius = 0.06) {
  const c = voxelOf(V, pt), r = Math.ceil(radius / V.h);
  let best = null, bestScore = -1;
  for (let dz = -r; dz <= r; dz++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const x = c[0] + dx, y = c[1] + dy, z = c[2] + dz;
    if (x < 0 || y < 0 || z < 0 || x >= V.n[0] || y >= V.n[1] || z >= V.n[2]) continue;
    const i = x + V.n[0] * (y + V.n[1] * z);
    if (!V.solid[i]) continue;
    const dd = Math.hypot(dx, dy, dz) * V.h;
    if (dd > radius) continue;
    const score = dt[i] - 0.35 * dd;       // prefer thick regions, but stay near the requested point
    if (score > bestScore) { bestScore = score; best = [x, y, z]; }
  }
  return best;
}

/** minimum-cost path through the distance field. cost per step = length / clamp(dt)^power. -> { pts (world), r (clearance) } */
export function medialPath(V, dt, from, to, { power = 2, minDt = 0.5, smooth = 6 } = {}) {
  const [nx, ny] = V.n, at = (x, y, z) => x + nx * (y + ny * z);
  const s = snapInside(V, dt, from), g = snapInside(V, dt, to);
  if (!s || !g) throw new Error('medialPath: end point is not inside the body');
  const cost = new Float64Array(V.N).fill(Infinity), prev = new Int32Array(V.N).fill(-1), h = new Heap();
  const si = at(...s), gi = at(...g);
  cost[si] = 0; h.push(0, si);
  const dts = (i) => Math.max(dt[i], minDt * V.h);
  const OFFS = [];
  for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy || dz) OFFS.push([dx, dy, dz, Math.hypot(dx, dy, dz) * V.h]);
  while (h.size) {
    const [d, u] = h.pop();
    if (d > cost[u]) continue;
    if (u === gi) break;
    const x = u % nx, y = ((u / nx) | 0) % ny, z = (u / (nx * ny)) | 0;
    const du = dts(u);
    for (const [dx, dy, dz, l] of OFFS) {
      const xx = x + dx, yy = y + dy, zz = z + dz;
      if (xx < 0 || yy < 0 || zz < 0 || xx >= nx || yy >= ny || zz >= V.n[2]) continue;
      const v = at(xx, yy, zz);
      if (!V.solid[v]) continue;
      const dv = dts(v), c = d + l / Math.pow(0.5 * (du + dv), power);
      if (c < cost[v]) { cost[v] = c; prev[v] = u; h.push(c, v); }
    }
  }
  if (!isFinite(cost[gi])) throw new Error('medialPath: no connection between the end points');
  const cells = []; for (let u = gi; u >= 0; u = prev[u]) cells.push(u);
  cells.reverse();
  let pts = cells.map((i) => worldOf(V, [i % nx, ((i / nx) | 0) % ny, (i / (nx * ny)) | 0]));
  const r = cells.map((i) => dt[i]);
  // Laplacian smoothing of the staircase (end points fixed)
  for (let it = 0; it < smooth; it++) {
    const q = pts.map((a) => a.slice());
    for (let i = 1; i < pts.length - 1; i++) for (let k = 0; k < 3; k++) q[i][k] = 0.25 * pts[i-1][k] + 0.5 * pts[i][k] + 0.25 * pts[i+1][k];
    pts = q;
  }
  return { pts, r };
}

/** arc-length resample of {pts, r} into n samples (radius interpolated) */
export function resampleWithRadius({ pts, r }, n) {
  const seg = [0];
  for (let i = 1; i < pts.length; i++) seg.push(seg[i-1] + len(sub(pts[i], pts[i-1])));
  const total = seg[seg.length-1], out = [], rr = [];
  for (let k = 0; k < n; k++) {
    const d = (total * k) / (n - 1);
    let i = 1; while (i < pts.length - 1 && seg[i] < d) i++;
    const t = (d - seg[i-1]) / ((seg[i] - seg[i-1]) || 1);
    out.push([0, 1, 2].map((c) => pts[i-1][c] + (pts[i][c] - pts[i-1][c]) * t));
    rr.push(r[i-1] + (r[i] - r[i-1]) * t);
  }
  return { pts: out, r: rr, length: total };
}

/** local thickness per vertex: the largest clearance found within `radius` (thin strands stay small, the body is large) */
export function localThickness(V, dt, pos, radius = 0.03) {
  const nV = pos.length / 3, k = Math.ceil(radius / V.h), out = new Float32Array(nV);
  const [nx, ny, nz] = V.n;
  for (let i = 0; i < nV; i++) {
    const cx = Math.floor((pos[i*3] - V.o[0]) / V.h), cy = Math.floor((pos[i*3+1] - V.o[1]) / V.h), cz = Math.floor((pos[i*3+2] - V.o[2]) / V.h);
    let m = 0;
    for (let z = Math.max(0, cz - k); z <= Math.min(nz - 1, cz + k); z++)
      for (let y = Math.max(0, cy - k); y <= Math.min(ny - 1, cy + k); y++)
        for (let x = Math.max(0, cx - k); x <= Math.min(nx - 1, cx + k); x++) { const d = dt[x + nx * (y + ny * z)]; if (d > m) m = d; }
    out[i] = m;
  }
  return out;
}

// Shared mesh helpers for the rig builders (tools/rigs/*.mjs): load a prepped GLB, weld UV-seam duplicates, adjacency,
// surface (geodesic) distances. Everything works on the WELDED vertex set (same position => same id) so that skin weights
// can never differ across a UV seam.
import { NodeIO } from '@gltf-transform/core';

export async function loadPrep(file) {
  const io = new NodeIO();
  const doc = await io.read(file);
  const root = doc.getRoot();
  const mesh = root.listMeshes()[0];
  const prim = mesh.listPrimitives()[0];
  const pos = prim.getAttribute('POSITION').getArray();
  const idx = prim.getIndices().getArray();
  return { io, doc, root, mesh, prim, pos, idx, nV: pos.length / 3, nTri: idx.length / 3 };
}

/** weld by position. -> { weld: Int32Array(nV) vertex->welded id, rep: Int32Array(nW) welded id->a vertex, nW, p: Float32Array(nW*3) } */
export function weldByPosition(pos) {
  const nV = pos.length / 3, weld = new Int32Array(nV), map = new Map(), rep = [];
  for (let i = 0; i < nV; i++) {
    const k = `${Math.round(pos[i*3] * 1e5)},${Math.round(pos[i*3+1] * 1e5)},${Math.round(pos[i*3+2] * 1e5)}`;
    let id = map.get(k);
    if (id === undefined) { id = rep.length; map.set(k, id); rep.push(i); }
    weld[i] = id;
  }
  const nW = rep.length, p = new Float32Array(nW * 3);
  for (let w = 0; w < nW; w++) { const i = rep[w]; p[w*3] = pos[i*3]; p[w*3+1] = pos[i*3+1]; p[w*3+2] = pos[i*3+2]; }
  return { weld, rep: Int32Array.from(rep), nW, p };
}

/** CSR adjacency over welded ids from a triangle index list. -> { start: Int32Array(nW+1), nb: Int32Array, nW } */
export function adjacency(weld, idx, nW) {
  const deg = new Int32Array(nW + 1), pairs = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = weld[idx[t]], b = weld[idx[t+1]], c = weld[idx[t+2]];
    for (const [u, v] of [[a, b], [b, c], [c, a]]) if (u !== v) { pairs.push(u, v); deg[u]++; deg[v]++; }
  }
  const start = new Int32Array(nW + 1);
  for (let i = 0; i < nW; i++) start[i+1] = start[i] + deg[i];
  const fill = start.slice(0, nW), nb = new Int32Array(start[nW]);
  for (let e = 0; e < pairs.length; e += 2) { const u = pairs[e], v = pairs[e+1]; nb[fill[u]++] = v; nb[fill[v]++] = u; }
  return { start, nb, nW };
}

/** connected components of the welded graph. -> { comp: Int32Array(nW), count, sizes: number[] } */
export function components(adj) {
  const { start, nb, nW } = adj, comp = new Int32Array(nW).fill(-1), sizes = [];
  const stack = [];
  for (let s = 0; s < nW; s++) {
    if (comp[s] >= 0) continue;
    const id = sizes.length; let n = 0; stack.push(s); comp[s] = id;
    while (stack.length) { const u = stack.pop(); n++; for (let e = start[u]; e < start[u+1]; e++) { const v = nb[e]; if (comp[v] < 0) { comp[v] = id; stack.push(v); } } }
    sizes.push(n);
  }
  return { comp, count: sizes.length, sizes };
}

// binary min-heap keyed by float
export class Heap {
  constructor() { this.k = []; this.v = []; }
  push(key, val) {
    const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v, topK = k[0], topV = v[0], lk = k.pop(), lv = v.pop(), n = k.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1; if (c >= n) break;
        if (c + 1 < n && k[c+1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    return [topK, topV];
  }
  get size() { return this.k.length; }
}

/** multi-source Dijkstra over edge lengths. sources: array of welded ids (or [id, startDist] pairs). -> Float64Array(nW)
 *  (float64 on purpose: a float32 distance array rounds up and lets equal-cost relaxations re-push forever) */
export function geodesic(adj, p, sources) {
  const { start, nb, nW } = adj, dist = new Float64Array(nW).fill(Infinity), h = new Heap();
  for (const s of sources) { const [id, d0] = Array.isArray(s) ? s : [s, 0]; if (d0 < dist[id]) { dist[id] = d0; h.push(d0, id); } }
  while (h.size) {
    const [d, u] = h.pop();
    if (d > dist[u]) continue;
    const ux = p[u*3], uy = p[u*3+1], uz = p[u*3+2];
    for (let e = start[u]; e < start[u+1]; e++) {
      const v = nb[e], dx = p[v*3] - ux, dy = p[v*3+1] - uy, dz = p[v*3+2] - uz;
      const nd = d + Math.sqrt(dx*dx + dy*dy + dz*dz);
      if (nd < dist[v]) { dist[v] = nd; h.push(nd, v); }
    }
  }
  return dist;
}

export const sub = (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
export const add = (a, b) => [a[0]+b[0], a[1]+b[1], a[2]+b[2]];
export const mul = (a, s) => [a[0]*s, a[1]*s, a[2]*s];
export const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const lerp3 = (a, b, t) => [a[0] + (b[0]-a[0]) * t, a[1] + (b[1]-a[1]) * t, a[2] + (b[2]-a[2]) * t];
export const R4 = (a) => a.map((v) => Math.round(v * 1e4) / 1e4);

/** resample a polyline into n points equally spaced by arc length */
export function resample(pts, n) {
  const seg = [0];
  for (let i = 1; i < pts.length; i++) seg.push(seg[i-1] + len(sub(pts[i], pts[i-1])));
  const total = seg[seg.length-1], out = [];
  for (let k = 0; k < n; k++) {
    const d = (total * k) / (n - 1);
    let i = 1; while (i < pts.length - 1 && seg[i] < d) i++;
    out.push(lerp3(pts[i-1], pts[i], (d - seg[i-1]) / ((seg[i] - seg[i-1]) || 1)));
  }
  return out;
}
export const pathLength = (pts) => pts.reduce((s, p, i) => (i ? s + len(sub(p, pts[i-1])) : 0), 0);

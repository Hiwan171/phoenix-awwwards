// Thin appendages (whiskers, hair locks): connected components of a vertex mask and the surface path through a strand.
import { Heap } from './mesh.mjs';

/** connected components of the welded graph restricted to mask[v] = 1. -> array of vertex id arrays */
export function maskComponents(adj, mask) {
  const { start, nb, nW } = adj, seen = new Uint8Array(nW), out = [];
  for (let s = 0; s < nW; s++) {
    if (!mask[s] || seen[s]) continue;
    const st = [s], comp = []; seen[s] = 1;
    while (st.length) {
      const u = st.pop(); comp.push(u);
      for (let e = start[u]; e < start[u+1]; e++) { const v = nb[e]; if (mask[v] && !seen[v]) { seen[v] = 1; st.push(v); } }
    }
    out.push(comp);
  }
  return out;
}

/** Dijkstra from `src` restricted to mask. -> { dist: Float64Array, prev: Int32Array } (non-members stay Infinity / -1) */
export function maskedDijkstra(adj, p, mask, src) {
  const { start, nb, nW } = adj, dist = new Float64Array(nW).fill(Infinity), prev = new Int32Array(nW).fill(-1), h = new Heap();
  dist[src] = 0; h.push(0, src);
  while (h.size) {
    const [d, u] = h.pop();
    if (d > dist[u]) continue;
    for (let e = start[u]; e < start[u+1]; e++) {
      const v = nb[e]; if (!mask[v]) continue;
      const nd = d + Math.hypot(p[v*3] - p[u*3], p[v*3+1] - p[u*3+1], p[v*3+2] - p[u*3+2]);
      if (nd < dist[v]) { dist[v] = nd; prev[v] = u; h.push(nd, v); }
    }
  }
  return { dist, prev };
}

/** surface path src -> dst through the mask as an array of positions */
export function maskedPath(adj, p, mask, src, dst) {
  const { prev } = maskedDijkstra(adj, p, mask, src);
  const out = [];
  for (let u = dst; u >= 0; u = prev[u]) { out.push([p[u*3], p[u*3+1], p[u*3+2]]); if (u === src) break; }
  return out.reverse();
}

export const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

import { NodeIO } from '@gltf-transform/core';
const doc = await new NodeIO().read(process.argv[2]);
const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
const P = prim.getAttribute('POSITION').getArray(), idx = prim.getIndices().getArray();
const nV = P.length / 3, nT = idx.length / 3;
// weld by position only
const map = new Map(), rep = new Int32Array(nV);
for (let i = 0; i < nV; i++) {
  const k = `${Math.round(P[i*3]*1e5)},${Math.round(P[i*3+1]*1e5)},${Math.round(P[i*3+2]*1e5)}`;
  let r = map.get(k); if (r === undefined) { r = map.size; map.set(k, r); } rep[i] = r;
}
const U = map.size;
console.log(`vertices ${nV}, unique positions ${U}, triangles ${nT}, V/T(unique) ${(U / nT).toFixed(2)} (closed manifold ~0.5)`);
// edges
const em = new Map();
let degenerate = 0;
const key = (a, b) => (a < b ? a * 4294967296 + b : b * 4294967296 + a);
for (let t = 0; t < nT; t++) {
  const a = rep[idx[t*3]], b = rep[idx[t*3+1]], c = rep[idx[t*3+2]];
  if (a === b || b === c || a === c) { degenerate++; continue; }
  for (const k of [key(a, b), key(b, c), key(c, a)]) em.set(k, (em.get(k) ?? 0) + 1);
}
let border = 0, manifold = 0, nonman = 0;
for (const v of em.values()) { if (v === 1) border++; else if (v === 2) manifold++; else nonman++; }
console.log(`edges ${em.size}: border ${border} (${(100*border/em.size).toFixed(1)}%), manifold ${manifold}, non-manifold ${nonman}; degenerate tris ${degenerate}`);
// components (union-find on unique positions via triangles)
const par = new Int32Array(U).map((_, i) => i);
const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
for (let t = 0; t < nT; t++) { const a = find(rep[idx[t*3]]), b = find(rep[idx[t*3+1]]), c = find(rep[idx[t*3+2]]); par[b] = a; par[c] = a; }
const size = new Map();
for (let i = 0; i < U; i++) { const r = find(i); size.set(r, (size.get(r) ?? 0) + 1); }
const sizes = [...size.values()].sort((a, b) => b - a);
console.log(`connected components: ${sizes.length}; largest ${sizes.slice(0, 6).join(', ')}; tiny (<50 verts): ${sizes.filter((s) => s < 50).length}`);

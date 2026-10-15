import { NodeIO } from '@gltf-transform/core';
const doc = await new NodeIO().read(process.argv[2]);
const P = doc.getRoot().listMeshes()[0].listPrimitives()[0].getAttribute('POSITION').getArray();
const n = P.length / 3, f = (v) => v.toFixed(2);
const Y0 = +(process.argv[3] ?? -0.62);
// vertices low enough to belong to the tail fan; greedy "peak" detection of feather tips: a vertex is a tip if no
// vertex within r=0.07 (xz-agnostic: 3D) is lower. Report tips sorted by x.
const idx = []; for (let i = 0; i < n; i++) if (P[i*3+1] < Y0) idx.push(i);
idx.sort((a, b) => P[a*3+1] - P[b*3+1]);       // lowest first
const tips = [];
for (const i of idx) {
  let near = false;
  for (const t of tips) { const dx = P[i*3] - t[0], dy = P[i*3+1] - t[1], dz = P[i*3+2] - t[2]; if (dx*dx + dy*dy + dz*dz < 0.09 * 0.09) { near = true; break; } }
  if (!near) tips.push([P[i*3], P[i*3+1], P[i*3+2], i]);
  if (tips.length > 40) break;
}
tips.sort((a, b) => a[0] - b[0]);
console.log(`feather-tip candidates below y=${Y0} (3D separation 0.09), sorted by x:`);
for (const t of tips) console.log(`  (${f(t[0])}, ${f(t[1])}, ${f(t[2])})`);

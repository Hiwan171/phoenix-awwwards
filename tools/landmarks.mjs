import { NodeIO } from '@gltf-transform/core';
const doc = await new NodeIO().read(process.argv[2]);
const P = doc.getRoot().listMeshes()[0].listPrimitives()[0].getAttribute('POSITION').getArray();
const n = P.length / 3, f = (v) => v.toFixed(2);
const pt = (i) => `(${f(P[i*3])}, ${f(P[i*3+1])}, ${f(P[i*3+2])})`;
const argExt = (pred, key, dir) => { let b = -1, bv = -Infinity; for (let i = 0; i < n; i++) { if (!pred(P[i*3], P[i*3+1], P[i*3+2])) continue; const v = key(P[i*3], P[i*3+1], P[i*3+2]) * dir; if (v > bv) { bv = v; b = i; } } return b; };
// head region: near the core axis, y in [0.3, 0.72], in front (z < -0.1)
const head = (x, y, z) => Math.abs(x + 0.1) < 0.1 && y > 0.3 && y < 0.72 && z < -0.12;
console.log('beak tip (min z in head):', pt(argExt(head, (x, y, z) => z, -1)));
console.log('head top (max y in head):', pt(argExt(head, (x, y, z) => y, 1)));
console.log('head lowest (min y, chin?):', pt(argExt((x, y, z) => head(x, y, z) && y > 0.38, (x, y, z) => y, -1)));
// crest plume: thin line high up behind the head
const plume = (x, y, z) => Math.abs(x + 0.15) < 0.07 && y > 0.78 && z > -0.2 && z < 0.45;
console.log('plume top (max y near axis):', pt(argExt(plume, (x, y, z) => y, 1)));
console.log('plume furthest back (max z, y>0.8):', pt(argExt(plume, (x, y, z) => z, 1)));
// wing tips: highest y on each side
console.log('left wing top  (x<-0.15):', pt(argExt((x) => x < -0.15, (x, y) => y, 1)));
console.log('right wing top (x> 0.10):', pt(argExt((x) => x > 0.10, (x, y) => y, 1)));
console.log('left  wing outermost x   :', pt(argExt((x) => x < 0, (x) => x, -1)));
console.log('right wing outermost x   :', pt(argExt((x) => x > 0, (x) => x, 1)));
// tail tips: cluster the lowest vertices by x
const low = []; for (let i = 0; i < n; i++) if (P[i*3+1] < -0.86) low.push(i);
low.sort((a, b) => P[a*3] - P[b*3]);
const cl = []; let cur = [low[0]];
for (let k = 1; k < low.length; k++) { if (P[low[k]*3] - P[low[k-1]*3] > 0.05) { cl.push(cur); cur = []; } cur.push(low[k]); }
cl.push(cur);
console.log('\nlowest clusters (y<-0.86), by x:');
for (const c of cl) { if (c.length < 150) continue; let sx = 0, sy = 0, sz = 0, mn = 9; for (const i of c) { sx += P[i*3]; sy += P[i*3+1]; sz += P[i*3+2]; mn = Math.min(mn, P[i*3+1]); } console.log(`  n=${c.length} centroid (${f(sx/c.length)}, ${f(sy/c.length)}, ${f(sz/c.length)}) lowest y=${f(mn)}`); }
// where does each tail band sit at several heights, in the x-z plane? (cluster by x with the z centroid)
for (const y of [-0.5, -0.65, -0.8]) {
  const sel = []; for (let i = 0; i < n; i++) if (Math.abs(P[i*3+1] - y) < 0.04) sel.push(i);
  sel.sort((a, b) => P[a*3] - P[b*3]);
  const cc = []; let cu = [sel[0]];
  for (let k = 1; k < sel.length; k++) { if (P[sel[k]*3] - P[sel[k-1]*3] > 0.04) { cc.push(cu); cu = []; } cu.push(sel[k]); }
  cc.push(cu);
  console.log(`y=${y}:`, cc.filter((c) => c.length > 120).map((c) => { let sx = 0, sz = 0; for (const i of c) { sx += P[i*3]; sz += P[i*3+2]; } return `x=${f(sx/c.length)} z=${f(sz/c.length)} n=${c.length}`; }).join(' | '));
}

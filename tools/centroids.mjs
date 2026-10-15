import { NodeIO } from '@gltf-transform/core';
const doc = await new NodeIO().read(process.argv[2]);
const P = doc.getRoot().listMeshes()[0].listPrimitives()[0].getAttribute('POSITION').getArray();
const n = P.length / 3;
const XC = +(process.argv[3] ?? -0.06);          // body axis x
const f = (v) => v.toFixed(2).padStart(6);
function stats(sel, y0, y1) {
  let c = 0, sx = 0, sz = 0, x0 = 9, x1 = -9, z0 = 9, z1 = -9;
  for (let i = 0; i < n; i++) {
    const x = P[i*3], y = P[i*3+1], z = P[i*3+2];
    if (y < y0 || y >= y1 || !sel(x, y, z)) continue;
    c++; sx += x; sz += z; x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
  }
  return c ? `${String(c).padStart(6)} x=${f(sx / c)} z=${f(sz / c)} | x[${f(x0)},${f(x1)}] z[${f(z0)},${f(z1)}]` : '     -';
}
console.log(`body axis xc=${XC}\n`);
console.log('WING LEFT (x < xc-0.14) / RIGHT (x > xc+0.14) by y slab');
for (let y = 1.0; y > -0.05; y -= 0.1) {
  console.log(`y[${f(y - 0.1)},${f(y)}]  L:`, stats((x) => x < XC - 0.14, y - 0.1, y), '\n               R:', stats((x) => x > XC + 0.14, y - 0.1, y));
}
console.log('\nCORE |x-xc|<0.12 by y slab');
for (let y = 1.0; y > -1.0; y -= 0.1) console.log(`y[${f(y - 0.1)},${f(y)}]`, stats((x) => Math.abs(x - XC) < 0.12, y - 0.1, y));
console.log('\nTAIL (y<-0.3): x-lobes. per slab 1D clusters of x with gap>0.05 (count>400)');
for (let y = -0.3; y > -1.0; y -= 0.1) {
  const xs = [];
  for (let i = 0; i < n; i++) { const Y = P[i*3+1]; if (Y < y - 0.1 || Y >= y) continue; xs.push([P[i*3], P[i*3+2]]); }
  xs.sort((a, b) => a[0] - b[0]);
  const cl = []; let cur = [xs[0]];
  for (let k = 1; k < xs.length; k++) { if (xs[k][0] - xs[k-1][0] > 0.03) { cl.push(cur); cur = []; } cur.push(xs[k]); }
  cl.push(cur);
  const out = cl.filter((c) => c.length > 600).map((c) => `x=${f(c.reduce((a, b) => a + b[0], 0) / c.length)} z=${f(c.reduce((a, b) => a + b[1], 0) / c.length)} n=${c.length}`);
  console.log(`y[${f(y - 0.1)},${f(y)}]`, out.join(' | '));
}

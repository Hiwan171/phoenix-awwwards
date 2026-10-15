// Where are the unusual texels of the clay texture (eyes, claws, ...)?  Maps every vertex to its texel and reports
// 3D clusters of vertices whose texel is not the base clay colour.   usage: node texprobe.mjs prepped.glb
import { NodeIO } from '@gltf-transform/core';
import sharp from 'sharp';
const doc = await new NodeIO().read(process.argv[2]);
const root = doc.getRoot();
const prim = root.listMeshes()[0].listPrimitives()[0];
const P = prim.getAttribute('POSITION').getArray(), UV = prim.getAttribute('TEXCOORD_0').getArray();
const tex = root.listTextures().find((t) => /BaseColor/i.test(t.getName())) ?? root.listTextures()[0];
const { data, info } = await sharp(Buffer.from(tex.getImage())).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;
console.log('texture', W, H);
const n = P.length / 3;
const texel = (i) => { const x = Math.min(W - 1, Math.max(0, Math.floor(UV[i*2] * W))), y = Math.min(H - 1, Math.max(0, Math.floor(UV[i*2+1] * H))); const o = (y * W + x) * 3; return [data[o], data[o+1], data[o+2]]; };
// base clay statistics
let mr = 0, mg = 0, mb = 0;
for (let i = 0; i < n; i += 7) { const t = texel(i); mr += t[0]; mg += t[1]; mb += t[2]; }
const c = Math.ceil(n / 7); mr /= c; mg /= c; mb /= c;
console.log('mean texel', mr.toFixed(0), mg.toFixed(0), mb.toFixed(0));
const cls = { bluish: [], dark: [], light: [] };
for (let i = 0; i < n; i++) {
  const [r, g, b] = texel(i);
  if (b > r - 4) cls.bluish.push(i);
  else if (r + g + b < 150) cls.dark.push(i);
  else if (r + g + b > 560) cls.light.push(i);
}
for (const [k, ids] of Object.entries(cls)) {
  console.log(`\n${k}: ${ids.length} vertices`);
  if (!ids.length) continue;
  // greedy 3D clustering, radius 0.04
  const cl = [];
  for (const i of ids) {
    let hit = null;
    for (const q of cl) { const dx = P[i*3] - q.x / q.n, dy = P[i*3+1] - q.y / q.n, dz = P[i*3+2] - q.z / q.n; if (dx*dx + dy*dy + dz*dz < 0.04 * 0.04) { hit = q; break; } }
    if (!hit) { hit = { x: 0, y: 0, z: 0, n: 0 }; cl.push(hit); }
    hit.x += P[i*3]; hit.y += P[i*3+1]; hit.z += P[i*3+2]; hit.n++;
  }
  cl.sort((a, b) => b.n - a.n);
  for (const q of cl.slice(0, 10)) console.log(`  n=${String(q.n).padStart(5)} at (${(q.x / q.n).toFixed(3)}, ${(q.y / q.n).toFixed(3)}, ${(q.z / q.n).toFixed(3)})`);
}

// Normalises a raw sculpted GLB for rigging:
//   1. bakes the node transform into the vertices and aims the bird at -Z (the site's frame: wings +Y, tail -Y)
//   2. centres it and scales it to y in [-1, 1]
//   3. drops the (faceted) normals, welds by position+UV, decimates with meshoptimizer, then recomputes smooth normals
// Why drop the normals: this class of model ships hard-edged normals, so every position exists ~3.7x and every vertex
// looks like a locked seam to the simplifier (it collapses nothing). Welding by position+UV leaves only the real UV seams.
// usage: node prep-model.mjs in.glb out.glb [triangleRatio=0.3] [yawDeg=180] [halfHeight=1] [maxError=0.02]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, prune, dedup, reorder } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';

const [,, input, output, ratioArg = '0.3', yawArg = '180', halfArg = '1', errArg = '0.02'] = process.argv;
const RATIO = +ratioArg, YAW = (+yawArg * Math.PI) / 180, HALF = +halfArg, ERR = +errArg;
const UVW = +(process.env.UVW ?? 1.0);                       // how much UV stretch the simplifier is allowed to cost
await MeshoptSimplifier.ready; await MeshoptEncoder.ready;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
const root = doc.getRoot();

// ── 1) bake node transforms (+ yaw) ──
const quatToMat = ([x, y, z, w]) => [
  1 - 2*(y*y + z*z), 2*(x*y - z*w), 2*(x*z + y*w),
  2*(x*y + z*w), 1 - 2*(x*x + z*z), 2*(y*z - x*w),
  2*(x*z - y*w), 2*(y*z + x*w), 1 - 2*(x*x + y*y)];
const cy = Math.cos(YAW), sy = Math.sin(YAW);
const RY = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
const mul3 = (a, b) => { const o = new Array(9); for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r*3+c] = a[r*3]*b[c] + a[r*3+1]*b[3+c] + a[r*3+2]*b[6+c]; return o; };
for (const node of root.listNodes()) {
  const mesh = node.getMesh(); if (!mesh) continue;
  const s = node.getScale(), t = node.getTranslation();
  const R = mul3(RY, quatToMat(node.getRotation()));
  for (const prim of mesh.listPrimitives()) {
    const P = prim.getAttribute('POSITION'), p = P.getArray();
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i] * s[0], y = p[i+1] * s[1], z = p[i+2] * s[2];
      p[i]   = R[0]*x + R[1]*y + R[2]*z + t[0];
      p[i+1] = R[3]*x + R[4]*y + R[5]*z + t[1];
      p[i+2] = R[6]*x + R[7]*y + R[8]*z + t[2];
    }
    P.setArray(p);
    prim.setAttribute('NORMAL', null);                       // faceted normals are rebuilt below
  }
  node.setRotation([0, 0, 0, 1]).setScale([1, 1, 1]).setTranslation([0, 0, 0]);
}

// ── 2) centre + scale ──
const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) {
  const p = prim.getAttribute('POSITION').getArray();
  for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) { if (p[i+k] < mn[k]) mn[k] = p[i+k]; if (p[i+k] > mx[k]) mx[k] = p[i+k]; }
}
const c = mn.map((v, k) => (v + mx[k]) / 2), sc = (2 * HALF) / (mx[1] - mn[1]);
for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) {
  const P = prim.getAttribute('POSITION'), p = P.getArray();
  for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) p[i+k] = (p[i+k] - c[k]) * sc;
  P.setArray(p);
}
console.log('scale', sc.toFixed(4), 'centre', c.map((v) => v.toFixed(3)).join(', '));

// ── 3) weld (position + UV) -> simplify -> smooth normals ──
const countTris = () => root.listMeshes().reduce((a, m) => a + m.listPrimitives().reduce((b, p) => b + p.getIndices().getCount() / 3, 0), 0);
const before = countTris();
await doc.transform(weld({ tolerance: 1e-5 }));
console.log('after weld: triangles', countTris(), 'vertices', root.listMeshes()[0].listPrimitives()[0].getAttribute('POSITION').getCount());

for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) {
  const P = prim.getAttribute('POSITION').getArray(), UV = prim.getAttribute('TEXCOORD_0').getArray(), idx = prim.getIndices().getArray();
  const target = Math.floor((idx.length * RATIO) / 3) * 3;
  const [out, err] = MeshoptSimplifier.simplifyWithAttributes(new Uint32Array(idx), P, 3, UV, 2, [UVW, UVW], null, target, ERR, []);
  console.log(`simplify: ${idx.length / 3} -> ${out.length / 3} tris (target ${target / 3}), error ${err.toFixed(5)}`);
  prim.getIndices().setArray(out);
}
await doc.transform(reorder({ encoder: MeshoptEncoder }), prune(), dedup());

// smooth normals: area-weighted, shared across UV seams (accumulated per unique position)
for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) {
  const P = prim.getAttribute('POSITION').getArray(), idx = prim.getIndices().getArray(), nV = P.length / 3;
  const rep = new Int32Array(nV), map = new Map();
  for (let i = 0; i < nV; i++) {
    const k = `${Math.round(P[i*3]*1e5)},${Math.round(P[i*3+1]*1e5)},${Math.round(P[i*3+2]*1e5)}`;
    const r = map.get(k); if (r === undefined) { map.set(k, i); rep[i] = i; } else rep[i] = r;
  }
  const acc = new Float32Array(nV * 3);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t+1], d = idx[t+2];
    const ux = P[b*3] - P[a*3], uy = P[b*3+1] - P[a*3+1], uz = P[b*3+2] - P[a*3+2];
    const vx = P[d*3] - P[a*3], vy = P[d*3+1] - P[a*3+1], vz = P[d*3+2] - P[a*3+2];
    const nx = uy*vz - uz*vy, ny = uz*vx - ux*vz, nz = ux*vy - uy*vx;          // |n| = 2 * area
    for (const v of [a, b, d]) { const r = rep[v]; acc[r*3] += nx; acc[r*3+1] += ny; acc[r*3+2] += nz; }
  }
  const N = new Float32Array(nV * 3);
  for (let i = 0; i < nV; i++) {
    const r = rep[i], l = Math.hypot(acc[r*3], acc[r*3+1], acc[r*3+2]) || 1;
    N[i*3] = acc[r*3] / l; N[i*3+1] = acc[r*3+1] / l; N[i*3+2] = acc[r*3+2] / l;
  }
  prim.setAttribute('NORMAL', doc.createAccessor('normals').setType('VEC3').setArray(N).setBuffer(root.listBuffers()[0]));
}
const after = countTris();
const verts = root.listMeshes().reduce((a, m) => a + m.listPrimitives().reduce((b, p) => b + p.getAttribute('POSITION').getCount(), 0), 0);
console.log(`triangles ${before} -> ${after} | vertices ${verts}`);
await io.write(output, doc);
console.log('wrote', output);

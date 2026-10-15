// Per-vertex local thickness (max distance-field value in a neighbourhood) -> debug GLB with COLOR_0.
//   node thin.mjs <prep.glb> <out.glb> [voxel=0.006] [radius=0.03] [thinThreshold=0.02]

import { Accessor } from '@gltf-transform/core';

import * as M from './mesh.mjs';
import * as Vol from './volume.mjs';
const [, , prep, out, hArg = '0.006', rArg = '0.03', thArg = '0.02'] = process.argv;
const h = +hArg, rad = +rArg, th = +thArg;
const { io, doc, prim, pos, idx } = await M.loadPrep(prep);
const V = Vol.voxelize(pos, idx, h);
const dt = Vol.edt(V);
const nV = pos.length / 3, k = Math.ceil(rad / h);
const thick = new Float32Array(nV);
const [nx, ny, nz] = V.n;
for (let i = 0; i < nV; i++) {
  const cx = Math.floor((pos[i*3] - V.o[0]) / h), cy = Math.floor((pos[i*3+1] - V.o[1]) / h), cz = Math.floor((pos[i*3+2] - V.o[2]) / h);
  let m = 0;
  for (let z = Math.max(0, cz - k); z <= Math.min(nz - 1, cz + k); z++) for (let y = Math.max(0, cy - k); y <= Math.min(ny - 1, cy + k); y++) for (let x = Math.max(0, cx - k); x <= Math.min(nx - 1, cx + k); x++) {
    const d = dt[x + nx * (y + ny * z)]; if (d > m) m = d;
  }
  thick[i] = m;
}
let thin = 0; for (let i = 0; i < nV; i++) if (thick[i] < th) thin++;
console.log('vertices', nV, 'thin', thin, `(${(100 * thin / nV).toFixed(1)}%)  threshold ${th}`);
const hist = new Array(12).fill(0); for (let i = 0; i < nV; i++) hist[Math.min(11, Math.floor(thick[i] / 0.01))]++;
console.log('thickness histogram (per 0.01):', hist.join(' '));
const col = new Float32Array(nV * 3);
for (let i = 0; i < nV; i++) {
  const t = Math.min(1, thick[i] / 0.06);
  if (thick[i] < th) { col[i*3] = 1; col[i*3+1] = 0.15; col[i*3+2] = 0.1; }
  else { col[i*3] = 0.25 + 0.4 * t; col[i*3+1] = 0.45 + 0.4 * t; col[i*3+2] = 0.7; }
}
const buffer = doc.getRoot().listBuffers()[0];
prim.setAttribute('COLOR_0', doc.createAccessor('col').setType(Accessor.Type.VEC3).setArray(col).setBuffer(buffer));
await io.write(out, doc);

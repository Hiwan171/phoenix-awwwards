// Debug: paint the vertices of a GLB with a colour chosen by a JS expression of (x, y, z) and write COLOR_0.
//   node color-debug.mjs <in.glb> <out.glb> "<expr returning [r,g,b] or null>"
//   e.g. "Math.abs(x) > 0.1 && y > -0.1 ? [0.2, 0.6, 1] : null"   (null = neutral grey)
import { NodeIO, Accessor } from '@gltf-transform/core';
const [, , input, output, expr] = process.argv;
const fn = new Function('x', 'y', 'z', `return (${expr});`);
const io = new NodeIO();
const doc = await io.read(input);
const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
const pos = prim.getAttribute('POSITION').getArray(), n = pos.length / 3, col = new Float32Array(n * 3);
const counts = {};
for (let i = 0; i < n; i++) {
  const c = fn(pos[i*3], pos[i*3+1], pos[i*3+2]) ?? [0.55, 0.55, 0.6];
  col[i*3] = c[0]; col[i*3+1] = c[1]; col[i*3+2] = c[2];
  const k = c.map((v) => v.toFixed(1)).join(','); counts[k] = (counts[k] ?? 0) + 1;
}
const buffer = doc.getRoot().listBuffers()[0];
prim.setAttribute('COLOR_0', doc.createAccessor('col').setType(Accessor.Type.VEC3).setArray(col).setBuffer(buffer));
await io.write(output, doc);
console.log('colour counts', JSON.stringify(counts));

// Debug: bake a COLOR_0 from the dominant joint of every vertex of a rigged GLB.
//   node weights-debug.mjs <rig.glb> <out.glb>
//   spine = blue->cyan by index, legs = red, mane = green, whiskers = yellow, head = white, other = magenta
import { NodeIO, Accessor } from '@gltf-transform/core';
const [, , input, output] = process.argv;
const io = new NodeIO();
const doc = await io.read(input);
const root = doc.getRoot();
const prim = root.listMeshes()[0].listPrimitives()[0];
const skin = root.listSkins()[0];
const names = skin.listJoints().map((j) => j.getName());
const J = prim.getAttribute('JOINTS_0').getArray(), Wt = prim.getAttribute('WEIGHTS_0').getArray();
const n = J.length / 4, col = new Float32Array(n * 3);
const colorOf = (name) => {
  let m;
  if ((m = /^Spine_(\d+)$/.exec(name))) { const t = +m[1] / 51; return [0.1, 0.3 + 0.6 * t, 1 - 0.6 * t]; }
  if ((m = /^Wing_[LR]_F(\d+)_/.exec(name))) { const k = +m[1]; const h = (k * 0.61803) % 1; const c = (t) => 0.5 + 0.5 * Math.cos(6.2832 * (h + t)); return [c(0), c(0.33), c(0.67)]; }
  if (name.startsWith('Wing_')) return [1, 1, 1];
  if (name.startsWith('Leg_')) return [1, 0.15, 0.1];
  if (name.startsWith('Mane_')) return [0.1, 0.9, 0.2];
  if (name.startsWith('Whisker_')) return [1, 0.9, 0.1];
  if (name.startsWith('Head')) return [1, 1, 1];
  return [1, 0, 1];
};
for (let i = 0; i < n; i++) {
  let best = 0, bw = -1;
  for (let k = 0; k < 4; k++) if (Wt[i*4+k] > bw) { bw = Wt[i*4+k]; best = J[i*4+k]; }
  const c = colorOf(names[best]);
  col[i*3] = c[0]; col[i*3+1] = c[1]; col[i*3+2] = c[2];
}
const buffer = root.listBuffers()[0];
prim.setAttribute('COLOR_0', doc.createAccessor('col').setType(Accessor.Type.VEC3).setArray(col).setBuffer(buffer));
await io.write(output, doc);
console.log('wrote', output);

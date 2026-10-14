import { NodeIO } from '@gltf-transform/core';
import { render } from './render.mjs';
import { buildSkeleton, boneSegments, refine } from './skeleton.mjs';
const [,, input, prefix] = process.argv;
const doc = await new NodeIO().read(input);
const pos = doc.getRoot().listMeshes()[0].listPrimitives()[0].getAttribute('POSITION').getArray();
const sk = buildSkeleton();
refine(sk, pos, [{group:'wingL',radius:0.09},{group:'wingR',radius:0.09},{group:'tailA',radius:0.06},{group:'tailB',radius:0.06},{group:'tailC',radius:0.06}]);
 const segs = boneSegments(sk);
const palette = { body:[255,0,0], neck:[255,120,0], head:[255,0,200], wingL:[0,160,0], wingR:[0,200,120], tailA:[0,0,0], tailB:[120,0,200], tailC:[0,120,255], ribL1:[200,160,0], ribL2:[160,120,0], ribR1:[0,200,200], ribR2:[0,140,140] };
const marks = [];
sk.joints.forEach((j, i) => {
  const c = palette[j.group] ?? [0,0,0];
  const { a, b } = segs[i];
  for (let t = 0; t <= 1; t += 0.04) marks.push({ p: a.map((v, k) => v + (b[k]-v)*t), c, r: 2 });
  marks.push({ p: j.pos, c, r: 5 });
});
for (const view of ['front', 'side', 'top']) render(pos, `${prefix}-${view}.png`, view, { marks, step: 3 });

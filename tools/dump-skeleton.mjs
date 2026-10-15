// Builds the v2 skeleton, optionally re-centres chains on the mesh (same refine as build-rig), writes JSON for the overlay.
// usage: node dump-skeleton.mjs model.glb out.json [refine=1]
import { NodeIO } from '@gltf-transform/core';
import fs from 'fs';
import { buildSkeletonV2, TAIL_IDS } from './skeleton-v2.mjs';
import { refine, boneSegments } from './skeleton.mjs';
import { smoothChains } from './skeleton-utils.mjs';
const [,, input, out, doRefine = '1'] = process.argv;
const doc = await new NodeIO().read(input);
const pos = doc.getRoot().listMeshes()[0].listPrimitives()[0].getAttribute('POSITION').getArray();
let yMin = 1e9, yMax = -1e9; for (let i = 1; i < pos.length; i += 3) { yMin = Math.min(yMin, pos[i]); yMax = Math.max(yMax, pos[i]); }
const SC = (yMax - yMin) / 2;
const sk = buildSkeletonV2(SC);
if (doRefine === '1') {
  const tails = TAIL_IDS.map((id) => `tail${id}`);
  refine(sk, pos, [{ group: 'wingL', radius: 0.14 * SC }, { group: 'wingR', radius: 0.14 * SC }, ...tails.map((g) => ({ group: g, radius: 0.1 * SC }))]);
  smoothChains(sk, ['wingL', 'wingR', ...tails], 3);
}
const segs = boneSegments(sk);
fs.writeFileSync(out, JSON.stringify(sk.joints.map((j, i) => ({ name: j.name, parent: j.parent, group: j.group, pos: j.pos, end: segs[i].b }))));
console.log('joints', sk.joints.length, '->', out);

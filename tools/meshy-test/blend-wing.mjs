// Gives the WING pieces back a share of Meshy's ORIGINAL (smooth) weights.   node tools/meshy-test/blend-wing.mjs [in.glb] [out.glb] [original.glb]
//
// rig-feathers.mjs binds every wing piece 100 % to its own feather chain, and each chain hangs from ONE wing bone. Neighbouring sheets
// of the wing overlap in layers and hang from different bones (e.g. F_wingA_88 from Bone_053, F_wingA_91/93 from Bone_035): when the
// elbow folds or the arm beats they separate and a hole opens between them (measured: up to 17 cm). Meshy's original skin did not have
// the problem, because its weights blend across the wing. Here a wing vertex keeps ALPHA of its feather-chain weights (the two joints of
// the chain, for the flutter) and takes 1 - ALPHA from the original weights (its two strongest influences, renormalised): neighbours
// now share part of their motion.  ALPHA env (default 0.5).
import { NodeIO } from '@gltf-transform/core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '../..');
const [, , inArg, outArg, origArg] = process.argv;
const input = inArg ?? path.join(REPO, 'model/meshy-test/Fenix_rig_clean.glb'), output = outArg ?? path.join(REPO, 'model/meshy-test/Fenix_rig_blend.glb');
const original = origArg ?? path.join(REPO, 'model/fenix/Fenix-RIG.glb');
const ALPHA = +(process.env.ALPHA ?? 0.5);

const io = new NodeIO();
const [docA, docO] = [await io.read(input), await io.read(original)];
const rootA = docA.getRoot(), rootO = docO.getRoot();
const primA = rootA.listMeshes()[0].listPrimitives()[0], primO = rootO.listMeshes()[0].listPrimitives()[0];
const jointsA = rootA.listSkins()[0].listJoints().map((j) => j.getName()), jointsO = rootO.listSkins()[0].listJoints().map((j) => j.getName());
const nV = primA.getAttribute('POSITION').getCount();
if (primO.getAttribute('POSITION').getCount() !== nV) throw new Error('vertex counts differ');
const JA = primA.getAttribute('JOINTS_0').getArray(), WA = primA.getAttribute('WEIGHTS_0').getArray();
const JO = primO.getAttribute('JOINTS_0').getArray(), WO = primO.getAttribute('WEIGHTS_0').getArray();
// original joints -> joint index in the new skin (by name; the original joints keep their names)
const toNew = jointsO.map((nm) => jointsA.indexOf(nm));
const isWingChain = jointsA.map((nm) => /^F_wing[AB]_/.test(nm));

const nJ = new Uint16Array(JA), nW = new Float32Array(WA);
let changed = 0;
for (let v = 0; v < nV; v++) {
  let mass = 0; for (let k = 0; k < 4; k++) if (isWingChain[JA[v*4+k]]) mass += WA[v*4+k];
  if (mass < 0.9) continue;                                           // only the pieces that live on a wing feather chain
  const oi = [], ow = [];
  for (let k = 0; k < 4; k++) if (WO[v*4+k] > 0) { oi.push(toNew[JO[v*4+k]]); ow.push(WO[v*4+k]); }
  const order = ow.map((w, i) => i).sort((a, b) => ow[b] - ow[a]).slice(0, 2);
  const os = order.reduce((s, i) => s + ow[i], 0); if (!(os > 0)) continue;
  const entries = [];
  for (let k = 0; k < 4; k++) if (WA[v*4+k] > 0) entries.push([JA[v*4+k], WA[v*4+k] * ALPHA]);
  for (const i of order) if (oi[i] >= 0) entries.push([oi[i], (1 - ALPHA) * ow[i] / os]);
  const acc = new Map(); for (const [j, w] of entries) acc.set(j, (acc.get(j) ?? 0) + w);
  const top = [...acc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4), sum = top.reduce((s, e) => s + e[1], 0);
  for (let k = 0; k < 4; k++) { nJ[v*4+k] = top[k]?.[0] ?? 0; nW[v*4+k] = top[k] ? top[k][1] / sum : 0; }
  changed++;
}
const buffer = rootA.listBuffers()[0];
primA.setAttribute('JOINTS_0', docA.createAccessor('joints').setType('VEC4').setArray(nJ).setBuffer(buffer));
primA.setAttribute('WEIGHTS_0', docA.createAccessor('weights').setType('VEC4').setArray(nW).setBuffer(buffer));
await io.write(output, docA);
console.log(`ALPHA ${ALPHA}: blended ${changed} wing vertices with the original weights; wrote ${output}`);

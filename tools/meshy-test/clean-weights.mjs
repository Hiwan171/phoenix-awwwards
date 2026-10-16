// Cleans Meshy's mixed skin weights PER PIECE.   node tools/meshy-test/clean-weights.mjs [in.glb] [out.glb]
//
// Found by measuring which vertices stretch in flight (tools/meshy-test/README.md): they are pieces (back feathers, thigh feathers,
// wing coverts) that Meshy skinned to TWO groups of bones at once (back + tail root, back + leg, back + wing forearm): the groups
// move differently and the piece shears. Here every connected piece keeps only the weights of its DOMINANT group of bones
// (renormalised), inside the group the blending is untouched. Big pieces (the body) and pieces with no clear owner are left alone.
//
// Env: MAXN (largest piece to clean, vertices, default 3000), MIN (dominant group's share of the piece, default 0.45),
//      GROUPS (comma list of the groups that may own a cleaned piece, default back,tail,wingA,wingB,legs).
import { NodeIO } from '@gltf-transform/core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPrep, adjacency, components } from '../rigs/lib/mesh.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '../..');
const [, , inArg, outArg] = process.argv;
const input = inArg ?? path.join(REPO, 'model/meshy-test/Fenix_rig.glb'), output = outArg ?? path.join(REPO, 'model/meshy-test/Fenix_rig_clean.glb');
const MAXN = +(process.env.MAXN ?? 3000), MIN = +(process.env.MIN ?? 0.45);
const OWN = new Set((process.env.GROUPS ?? 'back,tail,wingA,wingB,legs').split(','));

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const GROUPS = {
  back: [43, 44, 45, 46, 47, 48], tail: range(14, 31), wingA: [36, 35, 34, 50, 49, 60, 59, 62, 61, 53, 52, 51], wingB: [39, 38, 37, 55, 54, 64, 63, 66, 65, 58, 57, 56],
  legs: [2, 3, 4, 5, 6, 9, 10, 11, 12, 13], spine: [0, 1, 7, 8, 32, 33, 40, 41, 42],
};

const { io, doc, root, prim, pos, idx, nV } = await loadPrep(input);
const joints = root.listSkins()[0].listJoints(), names = joints.map((j) => j.getName());
const groupOfJoint = names.map((nm) => { const m = /^Bone_(\d+)$/.exec(nm); if (m) { for (const [g, l] of Object.entries(GROUPS)) if (l.includes(+m[1])) return g; return 'other'; } return nm.startsWith('F_') ? 'chain' : nm.startsWith('Spine_') ? 'spineNew' : 'other'; });
const J = prim.getAttribute('JOINTS_0').getArray(), W = prim.getAttribute('WEIGHTS_0').getArray();

const ident = Int32Array.from({ length: nV }, (_, i) => i);
const adj = adjacency(ident, idx, nV);
const comps = components(adj);
const mass = Array.from({ length: comps.count }, () => ({}));
for (let v = 0; v < nV; v++) { const m = mass[comps.comp[v]]; for (let k = 0; k < 4; k++) { const w = W[v*4+k]; if (w > 0) { const g = groupOfJoint[J[v*4+k]]; m[g] = (m[g] ?? 0) + w; } } }
const owner = new Array(comps.count).fill(null);
let pieces = 0, verts = 0; const byGroup = {};
for (let c = 0; c < comps.count; c++) {
  if (comps.sizes[c] > MAXN) continue;
  const m = mass[c], total = Object.values(m).reduce((a, b) => a + b, 0) || 1;
  let g = null, best = 0; for (const [k, x] of Object.entries(m)) if (x > best) { best = x; g = k; }
  if (!g || !OWN.has(g) || best / total < MIN) continue;
  // only pieces that ARE mixed: another group weighs more than 8 % of them
  if ((total - best) / total < 0.08) continue;
  owner[c] = g; pieces++; verts += comps.sizes[c]; byGroup[g] = (byGroup[g] ?? 0) + comps.sizes[c];
}
console.log(`pieces cleaned ${pieces} of ${comps.count} (${verts} vertices of ${nV}); by owner`, byGroup);
if (process.env.DRY) process.exit(0);

// the dominant joint of each cleaned piece (fallback for vertices left with nothing)
const fallback = new Array(comps.count).fill(-1);
{ const jm = Array.from({ length: comps.count }, () => new Map());
  for (let v = 0; v < nV; v++) { const c = comps.comp[v]; if (!owner[c]) continue; for (let k = 0; k < 4; k++) if (groupOfJoint[J[v*4+k]] === owner[c]) jm[c].set(J[v*4+k], (jm[c].get(J[v*4+k]) ?? 0) + W[v*4+k]); }
  for (let c = 0; c < comps.count; c++) if (owner[c]) fallback[c] = [...jm[c].entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? -1; }
const nJ = new Uint16Array(J), nW = new Float32Array(W);
let changed = 0;
for (let v = 0; v < nV; v++) {
  const c = comps.comp[v], g = owner[c]; if (!g) continue;
  let sum = 0; for (let k = 0; k < 4; k++) { if (groupOfJoint[J[v*4+k]] !== g) nW[v*4+k] = 0; sum += nW[v*4+k]; }
  if (sum < 1e-6) { nJ[v*4] = fallback[c]; nW[v*4] = 1; for (let k = 1; k < 4; k++) nW[v*4+k] = 0; }
  else for (let k = 0; k < 4; k++) nW[v*4+k] /= sum;
  changed++;
}
const buffer = root.listBuffers()[0];
prim.setAttribute('JOINTS_0', doc.createAccessor('joints').setType('VEC4').setArray(nJ).setBuffer(buffer));
prim.setAttribute('WEIGHTS_0', doc.createAccessor('weights').setType('VEC4').setArray(nW).setBuffer(buffer));
await io.write(output, doc);
console.log(`cleaned ${changed} vertices; wrote ${output}`);

// Gives the Meshy phoenix a REAL spine: a chain of joints from the pelvis through the body and the neck to the head.
//   node tools/meshy-test/rig-spine.mjs [in.glb] [out.glb]          DRY=1 only reports
//
// Meshy carried the whole body, the neck and the head (51k vertices, everything from y = 0.4 to 1.7) with nine bones that sit
// below y = 1.15 (Bone_000/001/008/007/033/032 + the crest bones 042/041/040): the neck could not bend, the head could not
// stretch forward, the body could not undulate. Here:
//   1. alpha(v) = the weight a vertex already has on those old spine bones (0..1);
//   2. the vertices with alpha >= 0.35 form the body region; surface distance from the pelvis gives their parameter along the
//      body, and the centre line is the bin centroids (re-centred by closest-point projection);
//   3. K joints are put on that line (Spine_00 .. Spine_K-1, identity world rotation, Spine_00 hangs from Bone_001);
//   4. each vertex gives its alpha to the spine joints by a cubic B-spline along the centre line (smooth bending, no creases);
//      the weights it has on wings, legs, tail and feathers are untouched;
//   5. the subtrees that rode on the old chain (wings, crest chain, back feathers) are re-parented to the nearest spine joint,
//      keeping their world rest transform.
import { NodeIO } from '@gltf-transform/core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPrep } from '../rigs/lib/mesh.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '../..');
const [, , inArg, outArg] = process.argv;
const input = inArg ?? path.join(REPO, 'model/meshy-test/Fenix_rig.glb');
const output = outArg ?? path.join(REPO, 'model/meshy-test/Fenix_rig2.glb');
const K = +(process.env.K ?? 11);
const OLD = [0, 1, 8, 7, 33, 32, 42, 41, 40].map((k) => 'Bone_' + String(k).padStart(3, '0'));
const REPARENT = [36, 39, 42, 45, 48].map((k) => 'Bone_' + String(k).padStart(3, '0'));

const { io, doc, root, prim, pos, idx, nV } = await loadPrep(input);
const skin = root.listSkins()[0], joints = skin.listJoints(), names = joints.map((j) => j.getName());
const byName = new Map(joints.map((j) => [j.getName(), j]));
const J = prim.getAttribute('JOINTS_0').getArray(), Wt = prim.getAttribute('WEIGHTS_0').getArray();
const oldSet = new Set(OLD.map((nm) => names.indexOf(nm)));
const fitSet = new Set(oldSet);                                  // the centre line is fitted on the ORIGINAL spine vertices only
// The back feathers lie ON the back, between the chest and the tail root: their own chains hang from the chest and swing 35 cm away from
// the tail when the posture changes (measured). Skinning them to the spine BY POSITION, like the rest of the body, keeps them on it.
// (BACK_TO_SPINE=0 keeps the chains.)  Their bones stay in the rig, unused.
const BACK_JOINTS = process.env.BACK_TO_SPINE === '0' ? [] : names.map((nm, i) => (/^F_back_/.test(nm) || /^Bone_04[3-8]$/.test(nm) ? i : -1)).filter((i) => i >= 0);
for (const i of BACK_JOINTS) oldSet.add(i);
console.log(`back feather joints skinned to the spine: ${BACK_JOINTS.length}`);

// ── 1. alpha ──
const alphaFit = new Float32Array(nV);
for (let v = 0; v < nV; v++) { let a = 0; for (let k = 0; k < 4; k++) if (fitSet.has(J[v*4+k])) a += Wt[v*4+k]; alphaFit[v] = a; }
const alpha = new Float32Array(nV);
for (let v = 0; v < nV; v++) { let a = 0; for (let k = 0; k < 4; k++) if (oldSet.has(J[v*4+k])) a += Wt[v*4+k]; alpha[v] = a; }
let nRegion = 0; for (let v = 0; v < nV; v++) if (alpha[v] >= 0.35) nRegion++;
console.log(`vertices with spine mass >= 0.35: ${nRegion}`);

// ── 2. the centre line ──
// Surface distance does not work here (the body, neck and head are many separate pieces), so the line starts from a guide read
// off the height profile of the vertices that carry the old spine bones (the chest bulges forward at y 0.5-0.9, the neck curves
// back, the head is forward again), is resampled to K equally spaced joints and then re-centred on the vertices three times.
const pelvis = byName.get('Bone_001').getWorldTranslation();
const GUIDE = [[pelvis[0], pelvis[1], pelvis[2]], [-0.88, 0.46, 0.10], [-1.05, 0.50, 0.15], [-1.18, 0.62, 0.19], [-1.26, 0.78, 0.19], [-1.22, 0.93, 0.16], [-1.12, 1.08, 0.12], [-1.05, 1.22, 0.09], [-1.03, 1.38, 0.05]];
// vertices that shape the line: not the hair at the back of the head (it hangs far behind the neck and would pull the end back)
const reach = []; for (let v = 0; v < nV; v++) if (alphaFit[v] >= 0.5 && !(pos[v*3+1] > 1.0 && pos[v*3] > -0.92)) reach.push(v);
const gl = [0]; for (let i = 1; i < GUIDE.length; i++) gl.push(gl[i-1] + Math.hypot(...[0,1,2].map((c) => GUIDE[i][c] - GUIDE[i-1][c])));
const centres = Array.from({ length: K }, (_, k) => {
  const d = (gl[gl.length - 1] * k) / (K - 1); let i = 1; while (i < GUIDE.length - 1 && gl[i] < d) i++;
  const t = (d - gl[i-1]) / (gl[i] - gl[i-1] || 1); return [0, 1, 2].map((c) => GUIDE[i-1][c] + (GUIDE[i][c] - GUIDE[i-1][c]) * t);
});
console.log(`guide length ${gl[gl.length - 1].toFixed(2)}; ${reach.length} vertices carry the old spine`);
const project = (x, y, z) => {
  let bestD = Infinity, bestS = 0;
  for (let i = 0; i < K - 1; i++) {
    const a = centres[i], b = centres[i+1], dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], l2 = dx*dx + dy*dy + dz*dz || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy + (z - a[2]) * dz) / l2));
    const d = (x - a[0] - dx * t) ** 2 + (y - a[1] - dy * t) ** 2 + (z - a[2] - dz * t) ** 2;
    if (d < bestD) { bestD = d; bestS = (i + t) / (K - 1); }
  }
  return bestS;
};
for (let it = 0; it < 3; it++) {
  const a2 = Array.from({ length: K }, () => ({ x: 0, y: 0, z: 0, w: 0 }));
  for (const v of reach) {
    const u = project(pos[v*3], pos[v*3+1], pos[v*3+2]) * (K - 1), i0 = Math.min(K - 2, Math.floor(u)), t = u - i0;
    for (const [i, wt] of [[i0, 1 - t], [i0 + 1, t]]) { const a = a2[i]; a.x += pos[v*3] * wt; a.y += pos[v*3+1] * wt; a.z += pos[v*3+2] * wt; a.w += wt; }
  }
  a2.forEach((a, i) => { if (i > 0 && a.w > 1e-6) centres[i] = [a.x / a.w, a.y / a.w, a.z / a.w]; });
}
for (let it = 0; it < 3; it++) { const c2 = centres.map((c) => c.slice()); for (let i = 1; i < K - 1; i++) for (let c = 0; c < 3; c++) c2[i][c] = 0.25 * centres[i-1][c] + 0.5 * centres[i][c] + 0.25 * centres[i+1][c]; for (let i = 0; i < K; i++) centres[i] = c2[i]; }   // a smooth line (the centroids wobble)
console.log('spine joints:'); centres.forEach((c, i) => console.log('  Spine_' + String(i).padStart(2, '0'), c.map((x) => x.toFixed(2)).join(', ')));
if (process.env.DRY) process.exit(0);

// ── 3. the joints ──
const chain = []; let prev = byName.get('Bone_001'), prevPos = pelvis;
const pw = prev.getWorldMatrix();                                                   // Bone_001's world rotation (rest)
const matQuat = (m) => { const t = m[0] + m[5] + m[10]; let x, y, z, w;
  if (t > 0) { const s = Math.sqrt(t + 1) * 2; w = s / 4; x = (m[6] - m[9]) / s; y = (m[8] - m[2]) / s; z = (m[1] - m[4]) / s; }
  else if (m[0] > m[5] && m[0] > m[10]) { const s = Math.sqrt(1 + m[0] - m[5] - m[10]) * 2; w = (m[6] - m[9]) / s; x = s / 4; y = (m[4] + m[1]) / s; z = (m[8] + m[2]) / s; }
  else if (m[5] > m[10]) { const s = Math.sqrt(1 + m[5] - m[0] - m[10]) * 2; w = (m[8] - m[2]) / s; x = (m[4] + m[1]) / s; y = s / 4; z = (m[9] + m[6]) / s; }
  else { const s = Math.sqrt(1 + m[10] - m[0] - m[5]) * 2; w = (m[1] - m[4]) / s; x = (m[8] + m[2]) / s; y = (m[9] + m[6]) / s; z = s / 4; }
  const l = Math.hypot(x, y, z, w); return [x / l, y / l, z / l, w / l]; };
const qmul = (a, b) => [a[3]*b[0] + a[0]*b[3] + a[1]*b[2] - a[2]*b[1], a[3]*b[1] - a[0]*b[2] + a[1]*b[3] + a[2]*b[0], a[3]*b[2] + a[0]*b[1] - a[1]*b[0] + a[2]*b[3], a[3]*b[3] - a[0]*b[0] - a[1]*b[1] - a[2]*b[2]];
const qinv = (q) => [-q[0], -q[1], -q[2], q[3]];
const qrot = (q, v) => { const r = qmul(qmul(q, [v[0], v[1], v[2], 0]), qinv(q)); return [r[0], r[1], r[2]]; };
let prevQ = matQuat(pw);
for (let i = 0; i < K; i++) {
  const node = doc.createNode('Spine_' + String(i).padStart(2, '0'));
  node.setTranslation(qrot(qinv(prevQ), [centres[i][0] - prevPos[0], centres[i][1] - prevPos[1], centres[i][2] - prevPos[2]]));
  node.setRotation(i === 0 ? qinv(prevQ) : [0, 0, 0, 1]);                          // world rest rotation = identity for every joint
  prev.addChild(node); prev = node; prevPos = centres[i]; prevQ = [0, 0, 0, 1]; chain.push(node);
}

// ── 4. weights: alpha goes to the spine joints by a cubic B-spline along the centre line ──
const bs = (u) => {                                                                // uniform cubic B-spline basis at parameter u in [0, K-1]
  const i0 = Math.floor(u), t = u - i0, t2 = t * t, t3 = t2 * t;
  const b = [(1 - t) ** 3 / 6, (3 * t3 - 6 * t2 + 4) / 6, (-3 * t3 + 3 * t2 + 3 * t + 1) / 6, t3 / 6], o = new Map();
  for (let k = 0; k < 4; k++) { const j = Math.min(K - 1, Math.max(0, i0 - 1 + k)); o.set(j, (o.get(j) ?? 0) + b[k]); }   // clamped ends
  return o;
};
const nOld = joints.length, buffer = root.listBuffers()[0];
const nJ = new Uint16Array(nV * 4), nW = new Float32Array(nV * 4);
let changed = 0;
for (let v = 0; v < nV; v++) {
  if (alpha[v] <= 1e-4) { for (let k = 0; k < 4; k++) { nJ[v*4+k] = J[v*4+k]; nW[v*4+k] = Wt[v*4+k]; } continue; }
  const entries = new Map();
  for (let k = 0; k < 4; k++) if (!oldSet.has(J[v*4+k]) && Wt[v*4+k] > 0) entries.set(J[v*4+k], (entries.get(J[v*4+k]) ?? 0) + Wt[v*4+k]);
  const u = project(pos[v*3], pos[v*3+1], pos[v*3+2]) * (K - 1);
  for (const [j, b] of bs(Math.min(K - 1.0001, u))) entries.set(nOld + j, (entries.get(nOld + j) ?? 0) + alpha[v] * b);
  const top = [...entries.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4), sum = top.reduce((s, e) => s + e[1], 0);
  for (let k = 0; k < 4; k++) { nJ[v*4+k] = top[k]?.[0] ?? 0; nW[v*4+k] = top[k] ? top[k][1] / sum : 0; }
  changed++;
}
chain.forEach((node) => skin.addJoint(node));
const oldIBM = skin.getInverseBindMatrices().getArray(), ibm = new Float32Array((nOld + K) * 16); ibm.set(oldIBM);
centres.forEach((c, i) => ibm.set([1,0,0,0, 0,1,0,0, 0,0,1,0, -c[0], -c[1], -c[2], 1], (nOld + i) * 16));
skin.setInverseBindMatrices(doc.createAccessor('ibm').setType('MAT4').setArray(ibm).setBuffer(buffer));
prim.setAttribute('JOINTS_0', doc.createAccessor('joints').setType('VEC4').setArray(nJ).setBuffer(buffer));
prim.setAttribute('WEIGHTS_0', doc.createAccessor('weights').setType('VEC4').setArray(nW).setBuffer(buffer));

// ── 5. re-parent what rode on the old chain ──
const yWings = (byName.get('Bone_036').getWorldMatrix()[13] + byName.get('Bone_039').getWorldMatrix()[13]) / 2;      // both wings use the same height
for (const nm of REPARENT) {
  const node = byName.get(nm), wm = node.getWorldMatrix(), wp = [wm[12], wm[13], wm[14]], wq = matQuat(wm);
  let best = 0, bdist = Infinity; centres.forEach((c, i) => { const d = (nm === 'Bone_036' || nm === 'Bone_039') ? Math.abs(c[1] - yWings) : Math.hypot(c[0] - wp[0], c[1] - wp[1]); if (d < bdist) { bdist = d; best = i; } });   // the wings hang from the joint at the SAME height as their shoulders (both from the same one); the rest by x, y
  node.getParentNode()?.removeChild(node); chain[best].addChild(node);
  node.setTranslation([wp[0] - centres[best][0], wp[1] - centres[best][1], wp[2] - centres[best][2]]);
  node.setRotation(wq);
  console.log(`${nm} -> Spine_${String(best).padStart(2, '0')} (${bdist.toFixed(2)} away)`);
}
await io.write(output, doc);
console.log(`re-weighted ${changed} vertices onto ${K} spine joints; wrote ${output}`);

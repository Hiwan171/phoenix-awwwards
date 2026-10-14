// Rigs the Tripo phoenix GLB: skeleton + auto skin weights + flight clips -> rigged GLB
import { NodeIO, Accessor } from '@gltf-transform/core';
import { buildSkeleton, boneSegments, refine } from './skeleton.mjs';
import { smoothChains } from './skeleton-utils.mjs';
import { CLIPS, pose } from './anim.mjs';

const [,, input, output] = process.argv;
const SIGMA = parseFloat(process.env.SIGMA ?? '0.02');
const SMOOTH_ITERS = parseInt(process.env.SMOOTH ?? '4');
const FPS = 30;
const LOCAL = { head: 0.045, neck: 0.06 };   // max influence distance per group

const io = new NodeIO();
const doc = await io.read(input);
const root = doc.getRoot();
const mesh = root.listMeshes()[0];
const prim = mesh.listPrimitives()[0];
const pos = prim.getAttribute('POSITION').getArray();
const idx = prim.getIndices().getArray();
const nV = pos.length / 3;

// ---------- skeleton ----------
const sk = buildSkeleton();
refine(sk, pos, [
  { group: 'wingL', radius: 0.09 }, { group: 'wingR', radius: 0.09 },
  { group: 'tailA', radius: 0.06 }, { group: 'tailB', radius: 0.06 }, { group: 'tailC', radius: 0.06 },
]);
smoothChains(sk, ['wingL', 'wingR', 'tailA', 'tailB', 'tailC'], 3);
const segs = boneSegments(sk);
const J = sk.joints.length;
console.log('joints', J);

// ---------- skin weights ----------
// weld vertices by position so UV-seam duplicates always get identical weights
const key = (i) => `${Math.round(pos[i*3]*1e5)},${Math.round(pos[i*3+1]*1e5)},${Math.round(pos[i*3+2]*1e5)}`;
const weld = new Int32Array(nV); const map = new Map(); const rep = [];
for (let i = 0; i < nV; i++) { const k = key(i); let id = map.get(k); if (id === undefined) { id = rep.length; map.set(k, id); rep.push(i); } weld[i] = id; }
const nW = rep.length; console.log('verts', nV, 'welded', nW);

function segDist(px, py, pz, a, b) {
  const abx = b[0]-a[0], aby = b[1]-a[1], abz = b[2]-a[2];
  const apx = px-a[0], apy = py-a[1], apz = pz-a[2];
  const l2 = abx*abx + aby*aby + abz*abz;
  let t = l2 > 0 ? (apx*abx + apy*aby + apz*abz) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = apx - abx*t, dy = apy - aby*t, dz = apz - abz*t;
  return Math.sqrt(dx*dx + dy*dy + dz*dz);
}
let W = new Float32Array(nW * J);
for (let w = 0; w < nW; w++) {
  const i = rep[w], px = pos[i*3], py = pos[i*3+1], pz = pos[i*3+2];
  let dmin = 1e9; const d = new Float32Array(J);
  for (let j = 0; j < J; j++) { d[j] = segDist(px, py, pz, segs[j].a, segs[j].b); if (d[j] < dmin) dmin = d[j]; }
  let s = 0;
  for (let j = 0; j < J; j++) {
    const e = (d[j] - dmin) / SIGMA; let v = Math.exp(-e*e);
    if (LOCAL[sk.joints[j].group] && d[j] > LOCAL[sk.joints[j].group]) v = 0;   // head/neck bones must not grab wing membrane
    W[w*J + j] = v; s += v;
  }
  if (s === 0) { let b = 0; for (let j = 1; j < J; j++) if (d[j] < d[b]) b = j; W[w*J + b] = 1; s = 1; }
  for (let j = 0; j < J; j++) W[w*J + j] /= s;
}
// Laplacian smoothing over the welded mesh graph
{
  const deg = new Int32Array(nW + 1);
  const edges = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = weld[idx[t]], b = weld[idx[t+1]], c = weld[idx[t+2]];
    for (const [u, v] of [[a,b],[b,c],[c,a]]) if (u !== v) { edges.push(u, v); deg[u]++; deg[v]++; }
  }
  const start = new Int32Array(nW + 1); for (let i = 0; i < nW; i++) start[i+1] = start[i] + deg[i];
  const fill = start.slice(0, nW); const nb = new Int32Array(start[nW]);
  for (let e = 0; e < edges.length; e += 2) { const u = edges[e], v = edges[e+1]; nb[fill[u]++] = v; nb[fill[v]++] = u; }
  const lam = 0.6;
  for (let it = 0; it < SMOOTH_ITERS; it++) {
    const N = new Float32Array(nW * J);
    for (let w = 0; w < nW; w++) {
      const c = start[w+1] - start[w];
      if (!c) { for (let j = 0; j < J; j++) N[w*J+j] = W[w*J+j]; continue; }
      for (let j = 0; j < J; j++) {
        let s = 0; for (let e = start[w]; e < start[w+1]; e++) s += W[nb[e]*J + j];
        N[w*J+j] = (1 - lam) * W[w*J+j] + lam * s / c;
      }
    }
    W = N;
  }
}
// top-4 per vertex
const joints0 = new Uint8Array(nV * 4), weights0 = new Float32Array(nV * 4);
const topJ = new Uint16Array(nW * 4), topV = new Float32Array(nW * 4);
const order = new Array(J);
for (let w = 0; w < nW; w++) {
  for (let j = 0; j < J; j++) order[j] = j;
  order.sort((a, b) => W[w*J+b] - W[w*J+a]);
  let s = 0; for (let k = 0; k < 4; k++) s += W[w*J + order[k]];
  for (let k = 0; k < 4; k++) { topJ[w*4+k] = order[k]; topV[w*4+k] = s > 0 ? W[w*J + order[k]] / s : (k === 0 ? 1 : 0); }
}
for (let i = 0; i < nV; i++) for (let k = 0; k < 4; k++) { joints0[i*4+k] = topJ[weld[i]*4+k]; weights0[i*4+k] = topV[weld[i]*4+k]; }

// ---------- glTF skin ----------
const buffer = root.listBuffers()[0];
const nodes = new Map();
for (const j of sk.joints) nodes.set(j.name, doc.createNode(j.name));
for (const j of sk.joints) {
  const n = nodes.get(j.name);
  const p = j.parent ? sk.byName.get(j.parent).pos : [0, 0, 0];
  n.setTranslation([j.pos[0]-p[0], j.pos[1]-p[1], j.pos[2]-p[2]]);
  if (j.parent) nodes.get(j.parent).addChild(n);
}
const rootNode = nodes.get('Root');
const ibm = new Float32Array(J * 16);
sk.joints.forEach((j, i) => { // column-major translation(-pos)
  ibm.set([1,0,0,0, 0,1,0,0, 0,0,1,0, -j.pos[0], -j.pos[1], -j.pos[2], 1], i*16);
});
const ibmAcc = doc.createAccessor('ibm').setType(Accessor.Type.MAT4).setArray(ibm).setBuffer(buffer);
const skin = doc.createSkin('PhoenixSkin').setInverseBindMatrices(ibmAcc).setSkeleton(rootNode);
sk.joints.forEach((j) => skin.addJoint(nodes.get(j.name)));
prim.setAttribute('JOINTS_0', doc.createAccessor('joints0').setType(Accessor.Type.VEC4).setArray(joints0).setBuffer(buffer));
prim.setAttribute('WEIGHTS_0', doc.createAccessor('weights0').setType(Accessor.Type.VEC4).setArray(weights0).setBuffer(buffer));
const meshNode = root.listNodes().find((n) => n.getMesh() === mesh);
meshNode.setSkin(skin);
root.listScenes()[0].addChild(rootNode);

// ---------- animations ----------
const nameSet = new Set(sk.joints.map((j) => j.name));
const restT = new Map(sk.joints.map((j) => [j.name, nodes.get(j.name).getTranslation()]));
for (const [clipName, { T, P }] of Object.entries(CLIPS)) {
  const frames = Math.round(T * FPS);
  const times = new Float32Array(frames + 1);
  const rot = new Map(), trn = new Map();
  for (let f = 0; f <= frames; f++) {
    times[f] = f / FPS;
    const phi = (f % frames) / frames;           // last key == first key => seamless loop
    const pz = pose(P, phi, nameSet);
    for (const j of sk.joints) {
      const v = pz[j.name];
      let q = v?.q ?? [0, 0, 0, 1];
      const arr = rot.get(j.name) ?? [];
      const prev = arr.length ? arr[arr.length-1] : null;
      if (prev && prev[0]*q[0] + prev[1]*q[1] + prev[2]*q[2] + prev[3]*q[3] < 0) q = q.map((x) => -x);
      arr.push(q); rot.set(j.name, arr);
      if (v?.t) {
        const r = restT.get(j.name);
        if (!trn.has(j.name)) trn.set(j.name, []);
        trn.get(j.name).push([r[0]+v.t[0], r[1]+v.t[1], r[2]+v.t[2]]);
      }
    }
  }
  const anim = doc.createAnimation(clipName);
  const tAcc = doc.createAccessor(`${clipName}_time`).setType(Accessor.Type.SCALAR).setArray(times).setBuffer(buffer);
  for (const j of sk.joints) {
    const q = rot.get(j.name);
    const qAcc = doc.createAccessor(`${clipName}_${j.name}_rot`).setType(Accessor.Type.VEC4).setArray(new Float32Array(q.flat())).setBuffer(buffer);
    const sQ = doc.createAnimationSampler().setInput(tAcc).setOutput(qAcc).setInterpolation('LINEAR');
    anim.addSampler(sQ).addChannel(doc.createAnimationChannel().setTargetNode(nodes.get(j.name)).setTargetPath('rotation').setSampler(sQ));
    const t = trn.get(j.name);
    if (t) {
      const tOut = doc.createAccessor(`${clipName}_${j.name}_pos`).setType(Accessor.Type.VEC3).setArray(new Float32Array(t.flat())).setBuffer(buffer);
      const sT = doc.createAnimationSampler().setInput(tAcc).setOutput(tOut).setInterpolation('LINEAR');
      anim.addSampler(sT).addChannel(doc.createAnimationChannel().setTargetNode(nodes.get(j.name)).setTargetPath('translation').setSampler(sT));
    }
  }
  console.log('clip', clipName, `${T}s`, `${frames + 1} keys`);
}

await io.write(output, doc);
console.log('wrote', output);

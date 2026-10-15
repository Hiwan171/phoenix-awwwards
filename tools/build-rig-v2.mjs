// Rigs the prepped (sculpted) phoenix GLB: skeleton v2 + auto skin weights + flight clips -> rigged GLB
// usage: node build-rig-v2.mjs prepped.glb out.glb     (env: SIGMA, SMOOTH)
import { NodeIO, Accessor } from '@gltf-transform/core';
import { boneSegments, refine } from './skeleton.mjs';
import { buildSkeletonV2, TAIL_IDS } from './skeleton-v2.mjs';
import { smoothChains } from './skeleton-utils.mjs';
import { CLIPS, pose, MODEL } from './anim.mjs';

const [,, input, output] = process.argv;

const SMOOTH_ITERS = parseInt(process.env.SMOOTH ?? '4');
const FPS = 30;

const io = new NodeIO();
const doc = await io.read(input);
const root = doc.getRoot();
const mesh = root.listMeshes()[0];
const prim = mesh.listPrimitives()[0];
const pos = prim.getAttribute('POSITION').getArray();
const idx = prim.getIndices().getArray();
const nV = pos.length / 3;
// every length below is written for a model with half-height 1; SC rescales them to the actual (prepped) mesh
let yMin = 1e9, yMax = -1e9;
for (let i = 1; i < pos.length; i += 3) { if (pos[i] < yMin) yMin = pos[i]; if (pos[i] > yMax) yMax = pos[i]; }
const SC = (yMax - yMin) / 2;
console.log('mesh half-height', SC.toFixed(3), '(all rig lengths scaled by it)');
const SIGMA = parseFloat(process.env.SIGMA ?? String(0.04 * SC));
const LOCAL = { head: 0.09 * SC, neck: 0.12 * SC, crest: 0.08 * SC };   // max influence distance per group (keeps them off the wing feathers)


// ---------- skeleton ----------
const sk = buildSkeletonV2(SC);
const TAILS = TAIL_IDS.map((id) => `tail${id}`);
refine(sk, pos, [
  { group: 'wingL', radius: 0.14 * SC }, { group: 'wingR', radius: 0.14 * SC },
  ...TAILS.map((g) => ({ group: g, radius: 0.10 * SC })),
]);
smoothChains(sk, ['wingL', 'wingR', ...TAILS], 3);
// per-model animation constants: span axes of the wings (shoulder -> tip) and the body bob in this model's units
{
  const dirOf = (a, z) => { const p = sk.byName.get(a).pos, q = sk.byName.get(z).pos, d = q.map((v, i) => v - p[i]), l = Math.hypot(...d); return d.map((v) => v / l); };
  MODEL.wingDir = { L: dirOf('Wing_L_Shoulder', 'Wing_L_Tip2'), R: dirOf('Wing_R_Shoulder', 'Wing_R_Tip2') };
  MODEL.bob = 0.020 * SC;
}
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

// ---------- tear removal ----------
// The sculpt has thin slivers that bridge parts which move apart (head crest <-> inner wing feather ...). At rest they
// are invisible, in a flap they become needles. Skin the welded mesh in sampled poses of every clip and drop the
// triangles whose edges stretch beyond reason in any of them.
{
  const TEAR_RATIO = parseFloat(process.env.TEAR_RATIO ?? '3.0'), TEAR_LEN = parseFloat(process.env.TEAR_LEN ?? String(0.09 * SC));
  const jIdx = new Map(sk.joints.map((j, i) => [j.name, i]));
  const parIdx = sk.joints.map((j) => (j.parent ? jIdx.get(j.parent) : -1));
  const locT = sk.joints.map((j) => (j.parent ? j.pos.map((v, k) => v - sk.byName.get(j.parent).pos[k]) : [...j.pos]));
  const names = new Set(sk.joints.map((j) => j.name));
  const nTri = idx.length / 3;
  const torn = new Uint8Array(nTri);
  const restW = new Float32Array(nW * 3);
  for (let w = 0; w < nW; w++) { const i = rep[w]; restW[w*3] = pos[i*3]; restW[w*3+1] = pos[i*3+1]; restW[w*3+2] = pos[i*3+2]; }
  const qmat = ([x, y, z, w]) => [1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w), 2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w), 2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)];
  const posed = new Float32Array(nW * 3);
  const poseSamples = [];
  for (const [clipName, { P }] of Object.entries(CLIPS)) for (let s = 0; s < 12; s++) poseSamples.push([clipName, s / 12, P]);
  let totalTorn = 0;
  const perClip = {};
  for (const [clipName, phi, P] of poseSamples) {
    const pz = pose(P, phi, names);
    const Rw = new Array(J), Tw = new Array(J), S = new Array(J);
    for (let j = 0; j < J; j++) {
      const v = pz[sk.joints[j].name];
      const R = qmat(v?.q ?? [0, 0, 0, 1]);
      const t = locT[j].map((c, k) => c + (v?.t ? v.t[k] : 0));
      if (parIdx[j] < 0) { Rw[j] = R; Tw[j] = t; }
      else {
        const Pm = Rw[parIdx[j]], Pt = Tw[parIdx[j]];
        Rw[j] = [0,0,0,0,0,0,0,0,0].map((_, e) => { const r = Math.floor(e / 3), c = e % 3; return Pm[r*3]*R[c] + Pm[r*3+1]*R[3+c] + Pm[r*3+2]*R[6+c]; });
        Tw[j] = [Pm[0]*t[0] + Pm[1]*t[1] + Pm[2]*t[2] + Pt[0], Pm[3]*t[0] + Pm[4]*t[1] + Pm[5]*t[2] + Pt[1], Pm[6]*t[0] + Pm[7]*t[1] + Pm[8]*t[2] + Pt[2]];
      }
      const p0 = sk.joints[j].pos, Rr = Rw[j];
      S[j] = { R: Rr, t: [Tw[j][0] - (Rr[0]*p0[0] + Rr[1]*p0[1] + Rr[2]*p0[2]), Tw[j][1] - (Rr[3]*p0[0] + Rr[4]*p0[1] + Rr[5]*p0[2]), Tw[j][2] - (Rr[6]*p0[0] + Rr[7]*p0[1] + Rr[8]*p0[2])] };
    }
    for (let w = 0; w < nW; w++) {
      const x = restW[w*3], y = restW[w*3+1], z = restW[w*3+2];
      let ox = 0, oy = 0, oz = 0;
      for (let k = 0; k < 4; k++) {
        const wt = topV[w*4+k]; if (!wt) continue;
        const m = S[topJ[w*4+k]], R = m.R;
        ox += wt * (R[0]*x + R[1]*y + R[2]*z + m.t[0]);
        oy += wt * (R[3]*x + R[4]*y + R[5]*z + m.t[1]);
        oz += wt * (R[6]*x + R[7]*y + R[8]*z + m.t[2]);
      }
      posed[w*3] = ox; posed[w*3+1] = oy; posed[w*3+2] = oz;
    }
    let n = 0;
    for (let t = 0; t < nTri; t++) {
      if (torn[t]) continue;
      const a = weld[idx[t*3]], b2 = weld[idx[t*3+1]], c = weld[idx[t*3+2]];
      const e = [[a, b2], [b2, c], [c, a]];
      for (const [u, v] of e) {
        const lr = Math.hypot(restW[u*3]-restW[v*3], restW[u*3+1]-restW[v*3+1], restW[u*3+2]-restW[v*3+2]);
        const lp = Math.hypot(posed[u*3]-posed[v*3], posed[u*3+1]-posed[v*3+1], posed[u*3+2]-posed[v*3+2]);
        if (lp > TEAR_LEN && lp / Math.max(lr, 0.004 * SC) > TEAR_RATIO) { torn[t] = 1; n++; break; }
      }
    }
    totalTorn += n; perClip[clipName] = (perClip[clipName] ?? 0) + n;
  }
  // cutting a bridge leaves its two halves behind as tiny floating islands: drop every small disconnected component
  const par = new Int32Array(nW).map((_, i) => i);
  const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  for (let t = 0; t < nTri; t++) if (!torn[t]) { const a = find(weld[idx[t*3]]), b2 = find(weld[idx[t*3+1]]), c = find(weld[idx[t*3+2]]); par[b2] = a; par[c] = a; }
  const triOf = new Map();
  for (let t = 0; t < nTri; t++) if (!torn[t]) { const r = find(weld[idx[t*3]]); triOf.set(r, (triOf.get(r) ?? 0) + 1); }
  const MIN_ISLAND = parseInt(process.env.MIN_ISLAND ?? '600');
  let islands = 0, islandTris = 0;
  for (let t = 0; t < nTri; t++) if (!torn[t] && triOf.get(find(weld[idx[t*3]])) < MIN_ISLAND) { torn[t] = 1; islandTris++; }
  for (const c of triOf.values()) if (c < MIN_ISLAND) islands++;
  const keep = [];
  for (let t = 0; t < nTri; t++) if (!torn[t]) keep.push(idx[t*3], idx[t*3+1], idx[t*3+2]);
  console.log('tear removal: stretched triangles removed', totalTorn, 'of', nTri, '(per clip', JSON.stringify(perClip) + ')');
  console.log(`  + ${islands} floating islands (${islandTris} triangles, < ${MIN_ISLAND} each) removed`);
  prim.getIndices().setArray(new Uint32Array(keep));
}

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

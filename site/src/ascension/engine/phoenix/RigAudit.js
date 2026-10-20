// RigAudit — programmatic inspection + anatomical classification of the original
// SmartRigArmature. Nothing here modifies the rig: bind matrices, inverse bind
// matrices and skin weights are read, never rewritten.
import * as THREE from 'three';
import { RIG_MAPPING_OVERRIDE } from './rigMapping.js';

export const REGION = { BODY: 0, WING: 1, TAIL: 2, HEAD: 3, LEG: 4 };
export const REGION_NAMES = ['body', 'wing', 'tail', 'head', 'leg'];
const FEATHER_RX = /^F_([A-Za-z]+)_(\d+)_(\d+)$/;

export function auditRig(mesh) {
  const t0 = performance.now();
  const skeleton = mesh.skeleton, bones = skeleton.bones, n = bones.length;
  const index = new Map(bones.map((b, i) => [b, i]));
  const byName = new Map(bones.map((b, i) => [b.name, i]));
  const parent = bones.map(b => (index.has(b.parent) ? index.get(b.parent) : -1));
  const children = bones.map(() => []);
  parent.forEach((p, i) => { if (p >= 0) children[p].push(i); });
  const root = parent.indexOf(-1);
  const armature = bones[root].parent;
  armature.updateMatrixWorld(true);
  const invArm = armature.matrixWorld.clone().invert();

  // ---- rest / bind data (model space = armature space) ----
  const rest = { localQ: [], localP: [], pos: [], quat: [] };
  const m = new THREE.Matrix4(), sc = new THREE.Vector3();
  for (const b of bones) {
    rest.localQ.push(b.quaternion.clone()); rest.localP.push(b.position.clone());
    m.multiplyMatrices(invArm, b.matrixWorld);
    const p = new THREE.Vector3(), q = new THREE.Quaternion(); m.decompose(p, q, sc);
    rest.pos.push(p); rest.quat.push(q);
  }
  // Bind pose consistency: boneWorld * inverseBind must be identical for all joints
  // (here it equals the KHR_mesh_quantization de-quantisation matrix folded into the IBMs).
  const ref = new THREE.Matrix4().multiplyMatrices(bones[0].matrixWorld, skeleton.boneInverses[0]);
  let bindDev = 0;
  for (let i = 0; i < n; i++) {
    m.multiplyMatrices(bones[i].matrixWorld, skeleton.boneInverses[i]);
    for (let k = 0; k < 16; k++) bindDev = Math.max(bindDev, Math.abs(m.elements[k] - ref.elements[k]));
  }

  // ---- name parsing (hint only, validated geometrically below) ----
  const info = bones.map(b => {
    const f = b.name.match(FEATHER_RX);
    if (f) return { kind: 'feather', group: f[1], chain: +f[2], seg: +f[3] };
    return { kind: /^Spine_/.test(b.name) ? 'spine' : 'bone' };
  });
  const isF = i => info[i].kind === 'feather';
  const subtree = (i, nonFeatherOnly = false) => {
    const out = [], st = [i];
    while (st.length) { const k = st.pop(); if (nonFeatherOnly && isF(k) && k !== i) continue; out.push(k); for (const c of children[k]) st.push(c); }
    return out;
  };
  // feather chains (root = first feather whose parent is not a feather)
  const chains = [];
  const chainOf = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    if (!isF(i) || (parent[i] >= 0 && isF(parent[i]))) continue;
    const list = [i]; let c = i;
    while (children[c].length === 1 && isF(children[c][0])) { c = children[c][0]; list.push(c); }
    const id = chains.length;
    list.forEach(k => (chainOf[k] = id));
    const a = rest.pos[list[0]], b = rest.pos[list[list.length - 1]];
    chains.push({ id, bones: list, attach: parent[i], group: info[i].group, dir: b.clone().sub(a), length: a.distanceTo(b), region: -1, side: 0 });
  }

  // ---- global frame ----
  let minY = Infinity, maxY = -Infinity;
  rest.pos.forEach(p => { minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); });
  const H = maxY - minY;
  let pelvis = root;
  while (children[pelvis].filter(c => !isF(c)).length < 3 && children[pelvis].length) pelvis = children[pelvis].filter(c => !isF(c))[0];
  const reachY = i => Math.max(...subtree(i, true).map(k => rest.pos[k].y));
  // spine = pelvis child whose non-feather subtree reaches highest; walk by highest reach
  const pc = children[pelvis].filter(c => !isF(c));
  const spine = [pc.reduce((a, b) => (reachY(b) > reachY(a) ? b : a))];
  for (;;) {
    const cands = children[spine[spine.length - 1]].filter(c => !isF(c));
    if (!cands.length) break;
    const best = cands.reduce((a, b) => (reachY(b) > reachY(a) + 1e-4 || (Math.abs(reachY(b) - reachY(a)) < 1e-4 && info[b].kind === 'spine') ? b : a));
    // stop when the best branch is not on the midline progression (head reached)
    if (reachY(best) < rest.pos[spine[spine.length - 1]].y - 0.02) break;
    spine.push(best);
  }
  const head = spine[spine.length - 1];
  const tailBones = [];
  pc.forEach(c => { if (c !== spine[0]) tailBones.push(c); });
  const P = rest.pos;
  const midZ = spine.reduce((s, i) => s + P[i].z, 0) / spine.length;
  // forward axis = tail centroid -> head (horizontal)
  const backReach = c => Math.max(...subtree(c).map(k => P[k].x - P[pelvis].x));
  const hasFeathers = c => subtree(c).some(k => isF(k));
  const tailRoots = pc.filter(c => c !== spine[0] && hasFeathers(c) && backReach(c) > 0.35 * H);
  const tailCentroid = new THREE.Vector3();
  let tc = 0; tailRoots.forEach(r => subtree(r).forEach(k => { tailCentroid.add(P[k]); tc++; }));
  tailCentroid.divideScalar(Math.max(1, tc));
  const forward = new THREE.Vector3(P[head].x - tailCentroid.x, 0, P[head].z - tailCentroid.z).normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const left = new THREE.Vector3().crossVectors(up, forward).normalize();
  const lat = i => (P[i].z - midZ) * left.z + (P[i].x - P[spine[0]].x) * left.x;

  // legs: pelvis children reaching the ground, no feathers
  const legRoots = pc.filter(c => c !== spine[0] && !tailRoots.includes(c) && !hasFeathers(c) && Math.min(...subtree(c).map(k => P[k].y)) < minY + 0.15 * H);
  const chestRoots = pc.filter(c => c !== spine[0] && !tailRoots.includes(c) && !legRoots.includes(c));
  const pathChain = r => { const out = [r]; let c = r; for (;;) { const nf = children[c].filter(k => !isF(k)); if (nf.length !== 1) break; c = nf[0]; out.push(c); } return out; };
  const legs = { R: null, L: null };
  const meanLat = r => { const st = subtree(r); return st.reduce((a, k) => a + lat(k), 0) / st.length; };
  legRoots.forEach(r => { legs[meanLat(r) > 0 ? 'L' : 'R'] = pathChain(r); });

  // wings: non-spine children of spine bones with the largest lateral reach per side
  const wingCands = [];
  spine.forEach(s => children[s].forEach(c => {
    if (isF(c) || spine.includes(c)) return;
    const st = subtree(c, true); const reach = Math.max(...st.map(k => Math.abs(lat(k))));
    const side = Math.sign(st.reduce((a, k) => a + lat(k), 0));
    const hasWingFeathers = subtree(c).some(k => isF(k) && /wing/i.test(info[k].group));
    wingCands.push({ c, attach: s, reach, side, hasWingFeathers });
  }));
  const pickWing = side => wingCands.filter(w => w.side === side).sort((a, b) => b.reach - a.reach)[0];
  const buildWing = (cand, sideSign) => {
    const reachLat = i => Math.max(...subtree(i, true).map(k => lat(k) * sideSign));
    const path = [cand.c]; let c = cand.c; const branches = [];
    for (;;) {
      const nf = children[c].filter(k => !isF(k)); if (!nf.length) break;
      const next = nf.reduce((a, b) => (reachLat(b) > reachLat(a) ? b : a));
      nf.filter(k => k !== next).forEach(k => branches.push({ at: c, root: k, bones: subtree(k, true) }));
      path.push(next); c = next;
    }
    const role = ['clavicle', 'shoulder', 'elbow', 'wrist', 'hand', 'digit', 'digitTip'];
    const w = { attach: cand.attach, path, branches, side: sideSign };
    role.forEach((r, k) => { w[r] = path[k] ?? -1; });
    const inner = branches.find(b => b.at === w.hand);
    w.innerDigit = inner ? inner.root : -1;
    w.innerDigitTip = inner && inner.bones.length > 1 ? inner.bones[1] : -1;
    w.tertial = branches.filter(b => b.at !== w.hand).map(b => b.bones);
    return w;
  };
  const wR = pickWing(-1), wL = pickWing(1);
  const wings = { R: wR ? buildWing(wR, -1) : null, L: wL ? buildWing(wL, 1) : null };
  // the neck starts above the last spine joint that carries wings or hanging (back) plumage;
  // plumage whose mass sits above its spine joint is crest
  const centroidY = c => { const st = subtree(c); return st.reduce((a, k) => a + P[k].y, 0) / st.length; };
  let wingAttach = wings.R ? spine.indexOf(wings.R.attach) : spine.length - 4;
  spine.forEach((s, si) => children[s].forEach(c => { if (!isF(c) && !spine.includes(c) && centroidY(c) < P[s].y) wingAttach = Math.max(wingAttach, si); }));
  const neck = spine.slice(wingAttach + 1, spine.length - 1);
  const torso = spine.slice(0, wingAttach + 1);
  const crestRoots = [];
  [...neck, head].forEach(s => children[s].forEach(c => { if (!isF(c) && !spine.includes(c) && centroidY(c) >= P[s].y) crestRoots.push(c); }));
  const backRoots = wingCands.filter(w => w !== wR && w !== wL && !crestRoots.includes(w.c)).map(w => w.c);

  // ---- region per bone ----
  const region = new Int8Array(n).fill(REGION.BODY);
  const sideOf = new Int8Array(n);
  const mark = (rootIdx, reg, side = 0) => subtree(rootIdx).forEach(k => { region[k] = reg; sideOf[k] = side; });
  tailRoots.forEach(r => mark(r, REGION.TAIL));
  legRoots.forEach(r => mark(r, REGION.LEG, Math.sign(meanLat(r))));
  if (wings.R) mark(wings.R.path[0], REGION.WING, -1);
  if (wings.L) mark(wings.L.path[0], REGION.WING, 1);
  [...neck, head].forEach(k => (region[k] = REGION.HEAD));
  crestRoots.forEach(r => mark(r, REGION.HEAD));
  chains.forEach(c => { c.region = region[c.bones[0]]; c.side = sideOf[c.bones[0]]; });

  // tip gradient per bone (0 root .. 1 tip of its chain / limb)
  const tipT = new Float32Array(n);
  chains.forEach(c => c.bones.forEach((k, s) => (tipT[k] = (s + 1) / c.bones.length)));
  ['R', 'L'].forEach(s => { const w = wings[s]; if (w) w.path.forEach((k, j) => (tipT[k] = Math.max(tipT[k], j / (w.path.length - 1) * 0.6))); });

  // ---- name ↔ geometry cross-validation ----
  const groupRegion = {}; const groupSide = {};
  chains.forEach(c => {
    (groupRegion[c.group] = groupRegion[c.group] || {})[REGION_NAMES[c.region]] = ((groupRegion[c.group] || {})[REGION_NAMES[c.region]] || 0) + c.bones.length;
    (groupSide[c.group] = groupSide[c.group] || {})[c.side] = ((groupSide[c.group] || {})[c.side] || 0) + 1;
  });

  const names = i => (i >= 0 ? bones[i].name : null);
  const auto = {
    root: names(root), pelvis: names(pelvis), torso: torso.map(names), neck: neck.map(names), head: names(head),
    crestRoots: crestRoots.map(names), chest: chestRoots.map(names), back: backRoots.map(names), tail: tailRoots.map(names),
    legR: legs.R ? legs.R.map(names) : [], legL: legs.L ? legs.L.map(names) : [],
    wingR: wings.R ? Object.fromEntries(['clavicle', 'shoulder', 'elbow', 'wrist', 'hand', 'digit', 'digitTip', 'innerDigit', 'innerDigitTip'].map(k => [k, names(wings.R[k])])) : null,
    wingL: wings.L ? Object.fromEntries(['clavicle', 'shoulder', 'elbow', 'wrist', 'hand', 'digit', 'digitTip', 'innerDigit', 'innerDigitTip'].map(k => [k, names(wings.L[k])])) : null,
  };
  // apply editable override (by name) on top of the automatic classification
  const mapping = JSON.parse(JSON.stringify(auto));
  const overrides = [];
  for (const [k, v] of Object.entries(RIG_MAPPING_OVERRIDE || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && mapping[k]) { Object.assign(mapping[k], v); overrides.push(k); }
    else { mapping[k] = v; overrides.push(k); }
  }
  const I = nm => (nm && byName.has(nm) ? byName.get(nm) : -1);
  ['R', 'L'].forEach(s => {
    const mw = mapping['wing' + s]; if (!mw || !wings[s]) return;
    for (const key of Object.keys(mw)) wings[s][key] = I(mw[key]);
  });

  return {
    mesh, bones, n, byName, parent, children, info, chains, chainOf, rest, region, sideOf, tipT,
    root, pelvis: I(mapping.pelvis), spine, torso: mapping.torso.map(I), neck: mapping.neck.map(I), head: I(mapping.head),
    crestRoots: mapping.crestRoots.map(I), chestRoots: mapping.chest.map(I), tailRoots: mapping.tail.map(I),
    tailChains: mapping.tail.map(nm => pathChain(I(nm))),
    legs: { R: mapping.legR.map(I), L: mapping.legL.map(I) }, wings,
    frame: { forward, up, left, midZ, height: H, minY, maxY },
    mapping, autoMapping: auto, overrides,
    report: {
      joints: n, chains: chains.length, bindDeviation: bindDev,
      forwardDeviationDeg: THREE.MathUtils.radToDeg(Math.acos(Math.min(1, -forward.x))),
      groupRegion, groupSide, ms: 0,
      counts: REGION_NAMES.reduce((o, r, k) => ((o[r] = region.reduce((a, v) => a + (v === k ? 1 : 0), 0)), o), {}),
    },
    t0,
  };
}

// Per-vertex anatomical data derived from the original skin weights:
//   aRegion  (wing, tail, head, leg) weights — body = 1 - sum
//   aFeather (tip gradient, featherness)
// plus rest-pose skinned positions and dominant joint per vertex.
export function analyseSkin(rig) {
  const { mesh, bones, n, region, tipT, info } = rig;
  const g = mesh.geometry;
  const si = g.attributes.skinIndex, sw = g.attributes.skinWeight, pa = g.attributes.position;
  const count = pa.count;
  const mats = [];
  for (let i = 0; i < n; i++) mats.push(new THREE.Matrix4().multiplyMatrices(bones[i].matrixWorld, mesh.skeleton.boneInverses[i]));
  const bindInv = mesh.bindMatrixInverse, bind = mesh.bindMatrix;
  const aRegion = new Float32Array(count * 4), aFeather = new Float32Array(count * 2);
  const restPos = new Float32Array(count * 3), dominant = new Uint16Array(count);
  const perBone = new Uint32Array(n);
  const v = new THREE.Vector3(), base = new THREE.Vector3(), acc = new THREE.Vector3();
  let maxSumErr = 0, unweighted = 0;
  for (let i = 0; i < count; i++) {
    base.fromBufferAttribute(pa, i).applyMatrix4(bind);
    acc.set(0, 0, 0);
    let best = -1, bw = -1, sum = 0, tip = 0, fea = 0;
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(i, k); if (w <= 0) continue;
      const j = si.getComponent(i, k);
      sum += w;
      acc.addScaledVector(v.copy(base).applyMatrix4(mats[j]), w);
      const r = region[j];
      if (r > 0) aRegion[i * 4 + (r - 1)] += w;
      tip += w * tipT[j]; fea += w * (info[j].kind === 'feather' ? 1 : 0);
      if (w > bw) { bw = w; best = j; }
    }
    if (sum <= 0) { unweighted++; continue; }
    maxSumErr = Math.max(maxSumErr, Math.abs(1 - sum));
    for (let k = 0; k < 4; k++) aRegion[i * 4 + k] /= sum;
    aFeather[i * 2] = tip / sum; aFeather[i * 2 + 1] = fea / sum;
    acc.divideScalar(sum).applyMatrix4(bindInv);
    restPos[i * 3] = acc.x; restPos[i * 3 + 1] = acc.y; restPos[i * 3 + 2] = acc.z;
    dominant[i] = best; perBone[best]++;
  }
  g.setAttribute('aRegion', new THREE.BufferAttribute(aRegion, 4));
  g.setAttribute('aFeather', new THREE.BufferAttribute(aFeather, 2));
  g.setAttribute('aRestPos', new THREE.BufferAttribute(restPos, 3));
  const bounds = new THREE.Box3().setFromArray(restPos);
  const silent = perBone.reduce((a, c) => a + (c === 0 ? 1 : 0), 0);
  rig.skin = { restPos, dominant, perBone, bounds, count };
  Object.assign(rig.report, { vertices: count, triangles: g.index ? g.index.count / 3 : count / 3, maxWeightSumError: maxSumErr, unweighted, jointsWithoutDominantVertices: silent });
  return rig.skin;
}

// Centroid of the skin mass a bone carries (itself + its directly attached feather
// chains + non-limb branches). Used as the "trailing" secondary axis of wing bones.
export function skinCentroid(rig, boneIdx, extraRoots = []) {
  const { children, info, skin } = rig;
  const set = new Set([boneIdx]);
  const addFeathers = b => children[b].forEach(c => { if (info[c].kind === 'feather') { const st = [c]; while (st.length) { const k = st.pop(); set.add(k); children[k].forEach(x => info[x].kind === 'feather' && st.push(x)); } } });
  addFeathers(boneIdx);
  extraRoots.forEach(r => { const st = [r]; while (st.length) { const k = st.pop(); set.add(k); children[k].forEach(x => st.push(x)); } });
  const c = new THREE.Vector3(); let cnt = 0;
  for (let i = 0; i < skin.count; i++) if (set.has(skin.dominant[i])) { c.x += skin.restPos[i * 3]; c.y += skin.restPos[i * 3 + 1]; c.z += skin.restPos[i * 3 + 2]; cnt++; }
  return cnt ? c.divideScalar(cnt) : null;
}

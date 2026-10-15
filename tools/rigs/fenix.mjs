// Rig builder for the phoenix (Zhuque / Fenghuang): skeleton + skin weights from the prepped (canonical frame) GLB.
//   node rigs/fenix.mjs <prep.glb> <out.glb> [web|lite]
//
// Canonical frame: Y up, faces -Z, height 1, centred. All rest rotations are identity (see lib/gltfskin.mjs).
// Skeleton (names are what site/src/beasts/fenix.js reads):
//   Pelvis (ROOT) -> Spine_1..4 (torso/chest) -> Neck_1..6 -> Head -> HeadTip
//   Wing_{L,R}_{Shoulder,Elbow,Wrist,Hand}        the arm (the thick leading edge: covert-covered)
//   Wing_{L,R}_F{00..}_{1..3}+Tip                 feather columns hanging from the arm: they FAN open about the wing normal
//   Tail_<k>_{1..8}+Tip                           one short chain per main plume (2 controllers each at runtime)
//   Leg_{L,R}_{1..4}+Tip, Crest_*, Streamer_*     legs, crest feathers and the two long face streamers
// "L" is the creature's left (-X): it faces -Z with Y up, so its right hand is +X.
import { loadPrep, weldByPosition, adjacency, components, len, sub, add, mul, dot, R4, pathLength, resample } from './lib/mesh.mjs';
import { voxelize, edt, medialPath, resampleWithRadius, localThickness, snapInside, voxelOf } from './lib/volume.mjs';
import { tubeWeights, smoothWeights, topInfluences, weightReport, bsplineBasis } from './lib/skin.mjs';
import { maskComponents, maskedDijkstra, maskedPath, smoothstep } from './lib/strands.mjs';
import { writeSkin } from './lib/gltfskin.mjs';
import fs from 'node:fs';

const [, , input, output, variant = 'web'] = process.argv;
const DEBUG = process.env.DEBUG_OVERLAY;               // path: write an overlay json for the viewer and stop before weights
const T0 = Date.now(), log = (...a) => console.log(`[fenix ${((Date.now() - T0) / 1000).toFixed(1)}s]`, ...a);

const CFG = {
  voxel: 0.006,
  thickArm: 0.034,                 // local thickness that marks the wing arm (the covert-covered leading edge)
  armZone: { xMin: 0.12, y: [-0.10, 0.36], z: [-0.56, 0.05] },
  shoulderX: 0.06,                 // the arm's inner end is carried to this |x| (it disappears into the chest)
  armFractions: { elbow: 0.42, wrist: 0.76 },
  columns: 12, columnBones: 3,     // feather columns per wing and bones per column
  plumes: 8, plumeMinLength: 0.22, plumeSeparation: 0.045, plumeBones: 8,
  armClear: 0.09,                 // columns ignore vertices closer than this to the arm line
  columnRadius: 0.035, plumeRadius: 0.03, thinStrand: 0.02, strandMinVerts: 40, strandMinLength: 0.10, strandBones: 6,
  kappa: 6, smooth: 9, smoothLambda: 0.5,
  columnRootClear: 0.13,           // ... or whose arm point is this close: the shoulder feathers stay with the body (no accordion stretch)
  bodyBias: 1.5,                   // ownership bias of the torso tube over feather columns
  columnBodyClear: 0.14,           // a column whose tip ends this close to the body axis belongs to the chest, not to the wing
  armExtend: 0.14,                 // virtual extension of the arm beyond the hand (outer primaries)
  neckBones: 6, spineBones: 4,
};

const { io, doc, prim, pos, idx } = await loadPrep(input);
const W = weldByPosition(pos), adj = adjacency(W.weld, idx, W.nW), C = components(adj);
const p = W.p;
const P = (i) => [p[i*3], p[i*3+1], p[i*3+2]];
log('welded', W.nW, 'components', C.count);
const V = voxelize(pos, idx, CFG.voxel);
const dt = edt(V);
const thickV = localThickness(V, dt, pos, 0.03);
const thick = new Float32Array(W.nW);                  // per welded vertex
for (let i = 0; i < pos.length / 3; i++) thick[W.weld[i]] = Math.max(thick[W.weld[i]], thickV[i]);
log('voxels', V.n.join('x'), 'solid', V.inside);

const joints = [];
const pushJoint = (name, parent, pos3) => { joints.push({ name, parent, pos: pos3 }); return joints.length - 1; };
const overlay = { lines: [], points: [] };
const addLine = (pts, color = '#ffe000') => { overlay.lines.push({ pts: pts.map(R4), color }); pts.forEach((q) => overlay.points.push({ p: R4(q), color, size: 0.005 })); };

// ───────────────────────── body axis: pelvis -> chest -> neck -> head ─────────────────────────
let head = null;
{
  // the head: the highest thick vertices near the centre line
  const central = []; for (let v = 0; v < W.nW; v++) if (Math.abs(p[v*3]) < 0.14 && thick[v] >= 0.035) central.push(v);
  central.sort((a, b) => p[b*3+1] - p[a*3+1]);
  const top = central.slice(0, 60);
  head = [0, 1, 2].map((k) => top.reduce((s, v) => s + p[v*3+k], 0) / top.length);
}
const pelvisPoint = [0.0, -0.14, -0.20];
const bodyPath = resampleWithRadius(medialPath(V, dt, pelvisPoint, head, { smooth: 6 }), 120);
log('head', head.map((v) => v.toFixed(3)).join(' '), 'body axis length', bodyPath.length.toFixed(3));
const bodyCum = [0]; for (let i = 1; i < bodyPath.pts.length; i++) bodyCum.push(bodyCum[i-1] + len(sub(bodyPath.pts[i], bodyPath.pts[i-1])));
const bodyAt = (s) => {
  s = Math.min(Math.max(s, 0), bodyCum[bodyCum.length - 1]);
  let lo = 0, hi = bodyCum.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (bodyCum[m] <= s) lo = m; else hi = m; }
  const t = (s - bodyCum[lo]) / ((bodyCum[hi] - bodyCum[lo]) || 1);
  return { p: [0, 1, 2].map((c) => bodyPath.pts[lo][c] + (bodyPath.pts[hi][c] - bodyPath.pts[lo][c]) * t), r: bodyPath.r[lo] + (bodyPath.r[hi] - bodyPath.r[lo]) * t };
};
const Lbody = bodyCum[bodyCum.length - 1];
// the neck is the last 40 % of the axis, the head joint sits 0.07 below the top point
const sNeckBase = Lbody * 0.58, sHeadJoint = Lbody - 0.09;
const pelvis = pushJoint('Pelvis', null, bodyAt(0).p);
const spineJ = [pelvis];
for (let k = 1; k <= CFG.spineBones; k++) spineJ.push(pushJoint(`Spine_${k}`, spineJ[k-1], bodyAt((sNeckBase * k) / CFG.spineBones).p));
const neckJ = [];
for (let k = 1; k <= CFG.neckBones; k++) neckJ.push(pushJoint(`Neck_${k}`, k === 1 ? spineJ[spineJ.length - 1] : neckJ[k-2], bodyAt(sNeckBase + ((sHeadJoint - sNeckBase) * k) / CFG.neckBones).p));
const headJ = pushJoint('Head', neckJ[neckJ.length - 1], bodyAt(sHeadJoint).p);
const headTipJ = pushJoint('HeadTip', headJ, bodyAt(Lbody).p);
addLine(bodyPath.pts.filter((_, i) => i % 6 === 0), '#00e0ff');
overlay.points.push({ p: R4(head), color: '#00ff66', size: 0.012 });

// ───────────────────────── wing arms ─────────────────────────
const wings = [];
for (const side of [-1, 1]) {
  const tag = side < 0 ? 'L' : 'R';
  const sel = [];
  const z = CFG.armZone;
  for (let v = 0; v < W.nW; v++) {
    const x = p[v*3], y = p[v*3+1], zz = p[v*3+2];
    if (side * x >= z.xMin && y >= z.y[0] && y <= z.y[1] && zz >= z.z[0] && zz <= z.z[1] && thick[v] >= CFG.thickArm) sel.push(v);
  }
  let c = [0, 0, 0]; for (const v of sel) c = add(c, P(v)); c = mul(c, 1 / sel.length);
  let ax = [side, 0.3, -0.5];
  for (let it = 0; it < 80; it++) {
    let a = [0, 0, 0];
    for (const v of sel) { const d = sub(P(v), c), pr = dot(d, ax); a = add(a, mul(d, pr)); }
    const l = len(a) || 1; ax = mul(a, 1 / l);
  }
  let lo = 1e9, hi = -1e9, vLo = sel[0], vHi = sel[0];
  for (const v of sel) { const pr = dot(sub(P(v), c), ax); if (pr < lo) { lo = pr; vLo = v; } if (pr > hi) { hi = pr; vHi = v; } }
  let a = P(vLo), b = P(vHi);
  if (Math.abs(a[0]) > Math.abs(b[0])) [a, b] = [b, a];          // a = inner end, b = outer end
  const inner = [side * CFG.shoulderX, a[1], a[2]];
  const path = resampleWithRadius(medialPath(V, dt, inner, b, { smooth: 6 }), 60);
  log(`wing ${tag}: thick ${sel.length}, inner ${a.map((v) => v.toFixed(2))} outer ${b.map((v) => v.toFixed(2))} arm length ${path.length.toFixed(3)}`);
  const cum = [0]; for (let i = 1; i < path.pts.length; i++) cum.push(cum[i-1] + len(sub(path.pts[i], path.pts[i-1])));
  const at = (f) => { const s = f * cum[cum.length - 1]; let lo2 = 0, hi2 = cum.length - 1; while (hi2 - lo2 > 1) { const m = (lo2 + hi2) >> 1; if (cum[m] <= s) lo2 = m; else hi2 = m; } const t = (s - cum[lo2]) / ((cum[hi2] - cum[lo2]) || 1); return { p: [0, 1, 2].map((q) => path.pts[lo2][q] + (path.pts[hi2][q] - path.pts[lo2][q]) * t), r: path.r[lo2] + (path.r[hi2] - path.r[lo2]) * t }; };
  const parent = spineJ[spineJ.length - 1];                       // the shoulder hangs from the top of the chest
  const S = at(0), E = at(CFG.armFractions.elbow), Wr = at(CFG.armFractions.wrist), H = at(1);
  const jS = pushJoint(`Wing_${tag}_Shoulder`, parent, S.p);
  const jE = pushJoint(`Wing_${tag}_Elbow`, jS, E.p);
  const jW = pushJoint(`Wing_${tag}_Wrist`, jE, Wr.p);
  const jH = pushJoint(`Wing_${tag}_Hand`, jW, H.p);
  wings.push({ side, tag, path, cum, at, S, E, Wr, H, jS, jE, jW, jH, arm: [S, E, Wr, H] });
  addLine([S.p, E.p, Wr.p, H.p], side < 0 ? '#ff8c00' : '#00ff66');
}

// ───────────────────────── feather columns: rays hanging from the arm ─────────────────────────
// every wing vertex gets a foot point on the (extended) arm; the vertices are binned by the foot's position along the arm.
// A column's ray goes from its arm point to the mean of the farthest feather vertices of its bin: that is where the
// feathers of that column actually point (they fan out from the arm), and how far they reach.
for (const wg of wings) {
  const arm = wg.path.pts, n = arm.length;
  // extend the arm beyond the hand so that the outermost primaries get their own columns
  const tail = sub(arm[n - 1], arm[n - 4]); const tl = len(tail);
  const ext = []; for (let k = 1; k <= 6; k++) ext.push(add(arm[n - 1], mul(tail, (CFG.armExtend * k) / (6 * tl))));
  const poly = arm.concat(ext);
  const pc = [0]; for (let i = 1; i < poly.length; i++) pc.push(pc[i-1] + len(sub(poly[i], poly[i-1])));
  const Ltot = pc[pc.length - 1];
  const foot = (q) => {                       // nearest point on the polyline: { s (arc), d, p }
    let best = { d: 1e9 };
    for (let i = 0; i + 1 < poly.length; i++) {
      const a0 = poly[i], b0 = poly[i+1], ab = sub(b0, a0), l2 = dot(ab, ab);
      let t = l2 > 0 ? dot(sub(q, a0), ab) / l2 : 0; t = Math.min(1, Math.max(0, t));
      const f = add(a0, mul(ab, t)), d = len(sub(q, f));
      if (d < best.d) best = { d, s: pc[i] + t * Math.sqrt(l2), p: f };
    }
    return best;
  };
  wg.poly = poly; wg.pc = pc; wg.Ltot = Ltot; wg.foot = foot;
  const K = CFG.columns, bins = Array.from({ length: K }, () => []);
  const sMin = pc[Math.round(n * 0.05)], sMax = Ltot;
  for (let v = 0; v < W.nW; v++) {
    const q = P(v);
    if (wg.side * q[0] < 0.07 || q[1] < -0.2 || q[2] > 0.42) continue;
    if (Math.abs(q[0]) < 0.2 && q[2] > -0.1 && q[1] < -0.02) continue;          // tail plumes live there
    const f = foot(q);
    if (f.d < 0.05) continue;                                                   // the arm mass itself
    { let nearBody = 1e9; for (let i = 0; i < bodyPath.pts.length; i += 3) { const d2 = len(sub(q, bodyPath.pts[i])); if (d2 < nearBody) nearBody = d2; } if (nearBody < 0.10) continue; }   // torso / neck feathers
    const k = Math.min(K - 1, Math.max(0, Math.floor(((f.s - sMin) / (sMax - sMin)) * K)));
    bins[k].push({ v, d: f.d, fp: f.p, s: f.s });
  }
  wg.columns = [];
  for (let k = 0; k < K; k++) {
    const b = bins[k]; if (b.length < 25) { wg.columns.push(null); continue; }
    const sMid = b.reduce((s2, e2) => s2 + e2.s, 0) / b.length;
    const rootP = (() => { const t = Math.min(sMid, Ltot); let i = 1; while (i < pc.length - 1 && pc[i] < t) i++; const u = (t - pc[i-1]) / ((pc[i] - pc[i-1]) || 1); return [0, 1, 2].map((c) => poly[i-1][c] + (poly[i][c] - poly[i-1][c]) * u); })();
    // robust feather direction: start from the mean direction of everything hanging off the arm point, then keep only the
    // vertices inside a 35 degree cone around it (chest feathers / other plumes fall out), repeat
    const items = b.filter((e2) => e2.d > 0.08).map((e2) => { const r = sub(P(e2.v), rootP), l = len(r) || 1e-6; return { r, l, u: mul(r, 1 / l) }; });
    if (items.length < 12) { wg.columns.push(null); continue; }
    let dir = [0, 0, 0]; for (const it of items) dir = add(dir, mul(it.u, it.l));
    dir = mul(dir, 1 / (len(dir) || 1));
    let kept = items;
    for (let iter = 0; iter < 4; iter++) {
      kept = items.filter((it) => dot(it.u, dir) > Math.cos(0.61));
      if (kept.length < 8) break;
      let nd = [0, 0, 0]; for (const it of kept) nd = add(nd, mul(it.u, it.l));
      dir = mul(nd, 1 / (len(nd) || 1));
    }
    if (kept.length < 4) kept = items.filter((it) => dot(it.u, dir) > 0);
    if (kept.length < 1) kept = items;
    const proj = kept.map((it) => dot(it.r, dir)).sort((x, y) => x - y);
    const L = proj[Math.min(proj.length - 1, Math.floor(proj.length * 0.9))];
    const tip = add(rootP, mul(dir, L));
    wg.columns.push({ k, s: sMid, root: rootP, tip, verts: b.map((e) => e.v), reach: len(sub(tip, rootP)) });
  }
  // Every bin gets a column (the fan must be continuous along the whole arm, or the skin tears between a moving column and
  // a still gap): the missing ones are interpolated from the nearest valid neighbours on both sides.
  {
    const sOf = (k) => sMin + ((k + 0.5) / K) * (sMax - sMin);
    const pointAt = (t) => { t = Math.min(t, Ltot); let i = 1; while (i < pc.length - 1 && pc[i] < t) i++; const u = (t - pc[i-1]) / ((pc[i] - pc[i-1]) || 1); return [0, 1, 2].map((c) => poly[i-1][c] + (poly[i][c] - poly[i-1][c]) * u); };
    const valid = wg.columns.map((c, i) => (c ? i : -1)).filter((i) => i >= 0);
    for (let k = 0; k < K; k++) {
      if (wg.columns[k]) continue;
      const lo = valid.filter((i) => i < k).pop(), hi = valid.find((i) => i > k);
      const A = wg.columns[lo ?? hi], B = wg.columns[hi ?? lo];
      const u = lo === undefined || hi === undefined ? 0 : (k - lo) / (hi - lo);
      const va = sub(A.tip, A.root), vb = sub(B.tip, B.root);
      const v = [0, 1, 2].map((c) => va[c] + (vb[c] - va[c]) * u);
      const root = pointAt(sOf(k));
      wg.columns[k] = { k, s: sOf(k), root, tip: add(root, v), verts: [], reach: len(v), filled: true };
    }
    wg.columns.forEach((c) => { c.s = Math.min(c.s, Ltot); });
  }
  const ok = wg.columns.filter(Boolean);
  log(`wing ${wg.tag}: ${ok.length}/${K} columns, reach ${ok.map((c) => c.reach.toFixed(2)).join(' ')}`);
  for (const c of ok) overlay.lines.push({ pts: [R4(c.root), R4(c.tip)], color: wg.side < 0 ? '#ffd24a' : '#7dff7d' });
}

// ───────────────────────── tail plumes ─────────────────────────
// root = the base of the tail; tips = the far ends of the plumes by farthest-point sampling on the surface distance;
// each plume's line is the surface path from the root to its tip (thin ribbons: the surface IS the centre line)
const tailRoot = [0.0, -0.12, 0.0];
const plumes = [];
{
  const tailMask = new Uint8Array(W.nW);
  for (let v = 0; v < W.nW; v++) { const q = P(v); if (q[2] > -0.02 && q[1] < 0.2) tailMask[v] = 1; }
  let r0 = -1, rd = 1e9;
  for (let v = 0; v < W.nW; v++) if (tailMask[v]) { const d = len(sub(P(v), tailRoot)); if (d < rd) { rd = d; r0 = v; } }
  const { dist, prev } = maskedDijkstra(adj, p, tailMask, r0);
  // candidate tips = local maxima of the surface distance (the end of a plume), found with a spatial hash
  const cell = 0.05, hash = new Map();
  const key = (q) => Math.floor(q[0] / cell) + ',' + Math.floor(q[1] / cell) + ',' + Math.floor(q[2] / cell);
  const members = [];
  for (let v = 0; v < W.nW; v++) if (tailMask[v] && isFinite(dist[v])) { members.push(v); const k = key(P(v)); (hash.get(k) ?? hash.set(k, []).get(k)).push(v); }
  const cands = [];
  for (const v of members) {
    if (dist[v] < CFG.plumeMinLength) continue;
    const q = P(v), cx = Math.floor(q[0] / cell), cy = Math.floor(q[1] / cell), cz = Math.floor(q[2] / cell);
    let isMax = true;
    scan: for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const list = hash.get((cx + dx) + ',' + (cy + dy) + ',' + (cz + dz)); if (!list) continue;
      for (const u of list) if (u !== v && dist[u] > dist[v] && len(sub(P(u), q)) < cell) { isMax = false; break scan; }
    }
    if (isMax) cands.push(v);
  }
  cands.sort((x, y) => dist[y] - dist[x]);
  const pathOf = (t) => { const path = []; for (let u = t; u >= 0; u = prev[u]) { path.push(u); if (u === r0) break; } return path.reverse(); };
  const accepted = [];
  for (const t of cands) {
    if (accepted.length >= CFG.plumes) break;
    const pv = pathOf(t);
    // the last stretch of the path (0.08 .. 0.22 back from the tip) must be clear of every accepted plume
    let ok = true;
    const tail = pv.filter((u) => dist[t] - dist[u] > 0.08 && dist[t] - dist[u] < 0.22);
    if (tail.length < 3) continue;
    for (const acc of accepted) {
      let near = 0;
      for (const u of tail) { let md = 1e9; for (const w of acc.pv) { const d = len(sub(P(u), P(w))); if (d < md) md = d; if (md < CFG.plumeSeparation) break; } if (md < CFG.plumeSeparation) near++; }
      if (near / tail.length > 0.6) { ok = false; break; }
    }
    if (ok) accepted.push({ t, pv });
  }
  for (const acc of accepted) plumes.push({ tip: acc.t, path: acc.pv.map(P), length: dist[acc.t] });
  plumes.sort((x, y) => x.path[x.path.length - 1][0] - y.path[y.path.length - 1][0]);       // by x of the tip: -x ... +x
  log('plumes', plumes.length, plumes.map((q) => q.length.toFixed(2)).join(' '));
  for (const q of plumes) {
    let pts = resample(q.path, 40);
    for (let it = 0; it < 6; it++) { const n2 = pts.map((a) => a.slice()); for (let i = 1; i < pts.length - 1; i++) for (let c = 0; c < 3; c++) n2[i][c] = 0.25 * pts[i-1][c] + 0.5 * pts[i][c] + 0.25 * pts[i+1][c]; pts = n2; }
    q.line = pts;
    addLine(pts.filter((_, i) => i % 3 === 0), '#c850ff');
  }
}

// ───────────────────────── legs ─────────────────────────
const legs = [];
{
  let ymin = 1e9; for (let v = 0; v < W.nW; v++) ymin = Math.min(ymin, p[v*3+1]);
  const yFoot = ymin + 0.05, cell = 0.025, occ = new Map();
  for (let v = 0; v < W.nW; v++) {
    if (p[v*3+1] > yFoot || Math.abs(p[v*3]) > 0.3 || p[v*3+2] > 0.0) continue;
    const k = Math.floor(p[v*3] / cell) + ',' + Math.floor(p[v*3+2] / cell);
    const c = occ.get(k) ?? occ.set(k, { n: 0, sx: 0, sy: 0, sz: 0 }).get(k);
    c.n++; c.sx += p[v*3]; c.sy += p[v*3+1]; c.sz += p[v*3+2];
  }
  const seen = new Set(), clusters = [];
  for (const k of occ.keys()) {
    if (seen.has(k)) continue;
    const st = [k], cl = { n: 0, sx: 0, sy: 0, sz: 0 }; seen.add(k);
    while (st.length) {
      const u = st.pop(), c = occ.get(u); cl.n += c.n; cl.sx += c.sx; cl.sy += c.sy; cl.sz += c.sz;
      const [x, z] = u.split(',').map(Number);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { const kk = (x + dx) + ',' + (z + dz); if (occ.has(kk) && !seen.has(kk)) { seen.add(kk); st.push(kk); } }
    }
    clusters.push({ n: cl.n, c: [cl.sx / cl.n, cl.sy / cl.n, cl.sz / cl.n] });
  }
  clusters.sort((x, y) => y.n - x.n);
  const feet = clusters.filter((c) => c.n >= 0.25 * clusters[0].n).slice(0, 2);
  log('feet', feet.length, feet.map((f) => f.c.map((v) => v.toFixed(2)).join(',')).join(' | '));
  for (const f of feet) {
    let bi = 0, bd = 1e9;
    spineJ.forEach((j, i) => { const d = len(sub(joints[j].pos, [f.c[0], f.c[1] + 0.25, f.c[2]])); if (d < bd) { bd = d; bi = i; } });
    const hipTarget = joints[spineJ[bi]].pos;
    const path = resampleWithRadius(medialPath(V, dt, f.c, hipTarget, { smooth: 4 }), 60);
    let cut = path.pts.length - 1;
    for (let k = 0; k < path.pts.length; k++) if (path.r[k] >= 0.07) { cut = k; break; }
    cut = Math.max(cut, Math.floor(path.pts.length * 0.5));
    const pts = path.pts.slice(0, cut + 1), rr = path.r.slice(0, cut + 1);
    const cumL = [0]; for (let k = 1; k < pts.length; k++) cumL.push(cumL[k-1] + len(sub(pts[k], pts[k-1])));
    const total = cumL[cumL.length - 1];
    const at = (fr) => { const t0 = fr * total; let k = 1; while (k < cumL.length - 1 && cumL[k] < t0) k++; const u = (t0 - cumL[k-1]) / ((cumL[k] - cumL[k-1]) || 1); return { p: [0, 1, 2].map((c) => pts[k-1][c] + (pts[k][c] - pts[k-1][c]) * u), r: rr[k-1] + (rr[k] - rr[k-1]) * u }; };
    const tag = f.c[0] < 0 ? 'L' : 'R', js = [], samples = [];
    [1.0, 0.66, 0.36, 0.14, 0.0].forEach((fr, k) => {
      const q = at(fr), nm = k < 4 ? `Leg_${tag}_${k + 1}` : `Leg_${tag}_Tip`;
      js.push(pushJoint(nm, k === 0 ? spineJ[bi] : js[k-1], q.p)); samples.push(q);
    });
    legs.push({ tag, joints: js, samples });
    addLine(samples.map((q) => q.p), '#00e0ff');
  }
}

// ───────────────────────── plume chains ─────────────────────────
for (const [i, q] of plumes.entries()) {
  const line = q.line ?? resample(q.path, 40);
  const pts = resample(line, CFG.plumeBones + 1);
  q.name = String(i); q.joints = []; q.samples = pts;
  pts.forEach((pt, k) => {
    const nm = k < CFG.plumeBones ? `Tail_${q.name}_${k + 1}` : `Tail_${q.name}_Tip`;
    q.joints.push(pushJoint(nm, k === 0 ? pelvis : q.joints[k-1], pt));
  });
}

// ───────────────────────── wing feather columns -> joints ─────────────────────────
for (const wg of wings) {
  wg.colJoints = [];
  for (const c of wg.columns) {
    if (!c) { wg.colJoints.push(null); continue; }
    // parent = the arm joint just before the column's arm point
    const armLen = wg.cum[wg.cum.length - 1];
    const sArm = Math.min(c.s, armLen) / armLen;
    const parent = sArm < CFG.armFractions.elbow ? wg.jS : sArm < CFG.armFractions.wrist ? wg.jE : wg.jW;
    const js = [], pts = [];
    for (let k = 0; k <= CFG.columnBones; k++) {
      const q = [0, 1, 2].map((m) => c.root[m] + (c.tip[m] - c.root[m]) * (k / CFG.columnBones));
      const id = String(c.k).padStart(2, '0');
      const nm = k < CFG.columnBones ? `Wing_${wg.tag}_F${id}_${k + 1}` : `Wing_${wg.tag}_F${id}_Tip`;
      js.push(pushJoint(nm, k === 0 ? parent : js[k-1], q)); pts.push(q);
    }
    c.joints = js; c.pts = pts;
    wg.colJoints.push(js);
  }
}

// ───────────────────────── crest feathers and face streamers: thin strands near the head ─────────────────────────
const strands = [];
{
  const thin = new Uint8Array(W.nW);
  for (let v = 0; v < W.nW; v++) { const q = P(v); if (thick[v] < CFG.thinStrand && len(sub(q, head)) < 0.45 && q[1] > 0.0) thin[v] = 1; }
  const headPos = joints[headJ].pos;
  const comps = maskComponents(adj, thin).filter((c) => c.length >= CFG.strandMinVerts);
  for (const c of comps) {
    let root = c[0], rd = 1e9;
    for (const v of c) { const d = len(sub(P(v), headPos)); if (d < rd) { rd = d; root = v; } }
    if (rd > 0.22) continue;
    const mask = new Uint8Array(W.nW); for (const v of c) mask[v] = 1;
    const { dist: dd } = maskedDijkstra(adj, p, mask, root);
    let tip = root, td = 0; for (const v of c) if (isFinite(dd[v]) && dd[v] > td) { td = dd[v]; tip = v; }
    if (td < CFG.strandMinLength) continue;
    strands.push({ verts: c, mask, root, tip, length: td, path: maskedPath(adj, p, mask, root, tip), dist: dd });
  }
  strands.sort((a2, b2) => P(a2.tip)[0] - P(b2.tip)[0]);
  strands.forEach((st, i) => {
    st.name = String(i).padStart(2, '0');
    const rs = resample(st.path, CFG.strandBones + 1);
    st.joints = [];
    rs.forEach((q, k) => {
      const nm = k < CFG.strandBones ? `Crest_${st.name}_${k + 1}` : `Crest_${st.name}_Tip`;
      st.joints.push(pushJoint(nm, k === 0 ? headJ : st.joints[k-1], q));
    });
    addLine(rs, '#ffffff');
  });
  log('crest/streamer strands', strands.length, strands.map((st) => st.length.toFixed(2)).join(' '));
}

if (DEBUG) {
  fs.writeFileSync(DEBUG, JSON.stringify(overlay));
  log('overlay written, stopping (DEBUG_OVERLAY)');
  process.exit(0);
}

// ───────────────────────── weights ─────────────────────────
const J = joints.length;
log('joints', J);
const tubes = [];
// 1. the body: B-spline over pelvis..neck, then a long gradient to the head joint (the chest never feels the head turn)
{
  const chain = [pelvis, ...spineJ.slice(1), ...neckJ];
  const arcOf = (pt) => { let bi = 0, bd = 1e9; bodyPath.pts.forEach((q, i) => { const d = len(sub(q, pt)); if (d < bd) { bd = d; bi = i; } }); return bi; };
  const pts = chain.map((j) => joints[j].pos);
  const r = chain.map((j) => Math.max(0.035, bodyPath.r[arcOf(joints[j].pos)]));
  const js = chain.slice(), pp = pts.slice(), rr = r.slice();
  for (let k = 1; k <= 3; k++) { const q = bodyAt(sHeadJoint + ((Lbody - sHeadJoint) * k) / 3); js.push(-1); pp.push(q.p); rr.push(Math.max(0.05, q.r)); }
  const n = chain.length, bs = bsplineBasis(n), zone = CFG.neckBones + 1.0;
  const sm = (x) => { const t = Math.min(1, Math.max(0, x)); return t * t * t * (t * (t * 6 - 15) + 10); };
  tubes.push({ name: 'body', weight: CFG.bodyBias, joints: js, pts: pp, r: rr, basis: (i, t) => {
    const x = i + t;
    if (x >= n - 1) return [[headJ, 1]];
    const beta = sm((x - (n - 1 - zone)) / zone);
    const w = bs(x).map(([k, wk]) => [chain[k], wk * (1 - beta)]);
    if (beta > 0) w.push([headJ, beta]);
    return w;
  } });
}
// 2. arms
for (const wg of wings) tubes.push({ name: `arm${wg.tag}`, joints: [wg.jS, wg.jE, wg.jW, wg.jH], pts: wg.arm.map((a2) => a2.p), r: wg.arm.map((a2) => Math.max(0.04, a2.r)) });
// 3. feather columns
// (a column never competes for the arm itself / the shoulder mass: the arm tube and the torso own those vertices outright)
// (the feather columns are not tubes: they are skinned by the continuous arm-parametric pass below)
// 4. plumes
for (const q of plumes) tubes.push({ name: `plume${q.name}`, joints: q.joints.slice(0, CFG.plumeBones).concat([-1]), pts: q.samples, r: q.samples.map(() => CFG.plumeRadius) });
// 5. legs
for (const lg of legs) tubes.push({ name: `leg${lg.tag}`, joints: lg.joints.slice(), pts: lg.samples.map((q) => q.p), r: lg.samples.map((q) => Math.max(0.02, q.r)) });

const { W: Wd } = tubeWeights({ p, nW: W.nW, tubes, J, kappa: CFG.kappa });
const hat = (js, t) => { const m = js.length, x = Math.min(Math.max(t, 0), 1) * (m - 1), i = Math.min(m - 2, Math.floor(x)), f = x - i; return [[js[i], 1 - f], [js[i+1], f]]; };
// wings: continuous skinning of the feather sheet. A vertex with foot point (s along the arm, d from it) takes the transform
// of the two columns that bracket s (linear in s) and, along each column, of the chain bone at d / reach. Because s and d
// vary smoothly over the sheet the whole deformation field is continuous: nothing tears between a fanning column and a
// still gap, which is what nearest-ray ownership did.
{
  const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  let blended = 0;
  for (const wg of wings) {
    const cols = wg.columns.slice().sort((x, y) => x.s - y.s);
    for (let v = 0; v < W.nW; v++) {
      const q = P(v);
      if (wg.side * q[0] < 0.07 || q[1] < -0.2 || q[2] > 0.42) continue;
      if (Math.abs(q[0]) < 0.2 && q[2] > -0.1 && q[1] < -0.02) continue;
      if (len(sub(q, head)) < 0.30 || (q[1] > 0.27 && Math.abs(q[0]) < 0.22)) continue;      // the head (beak, crest) is never a wing
      const f = wg.foot(q);
      let nb = 1e9; for (let i = 0; i < bodyPath.pts.length; i += 3) { const d2 = len(sub(q, bodyPath.pts[i])); if (d2 < nb) nb = d2; }
      const beta = sm(CFG.armClear * 0.7, CFG.armClear * 1.6, f.d) * sm(0.06, 0.14, nb);
      if (beta <= 0.001) continue;
      // bracketing columns
      let i1 = 0; while (i1 < cols.length - 1 && cols[i1 + 1].s < f.s) i1++;
      const c0 = cols[i1], c1 = cols[Math.min(cols.length - 1, i1 + 1)];
      const u = c1.s > c0.s ? Math.min(1, Math.max(0, (f.s - c0.s) / (c1.s - c0.s))) : 0;
      const acc = new Map();
      for (const [c, wc] of [[c0, 1 - u], [c1, u]]) {
        if (wc <= 0) continue;
        const t = Math.min(1, f.d / Math.max(c.reach, 1e-3));
        for (const [j, wj] of hat(c.joints, t)) acc.set(j, (acc.get(j) ?? 0) + wc * wj);
      }
      for (let j = 0; j < J; j++) Wd[v*J + j] *= (1 - beta);
      for (const [j, w] of acc) Wd[v*J + j] += beta * w;
      blended++;
    }
  }
  log('wing vertices skinned by arm-parametric fan:', blended);
}
// strands: explicit membership with a gradient from the head
for (const st of strands) {
  for (const v of st.verts) {
    const t = isFinite(st.dist[v]) ? st.dist[v] / st.length : 0, beta = smoothstep(0.0, 0.15, t);
    for (let j = 0; j < J; j++) Wd[v*J + j] *= (1 - beta);
    for (const [j, w] of hat(st.joints, t)) Wd[v*J + j] += beta * w;
  }
}
const Ws = smoothWeights(Wd, adj, J, CFG.smooth, CFG.smoothLambda);
const top = topInfluences(Ws, W.nW, J, 4);
const rep = weightReport(top, W.nW, joints.map((j) => j.name));
log('dominant-joint share', (rep.dominantShare * 100).toFixed(1) + '%', 'unused', rep.unused.length, rep.unused.slice(0, 12).join(','));

// ───────────────────────── export ─────────────────────────
const extras = {
  rig: 'fenix', variant,
  spine: { pelvis: 'Pelvis', spine: spineJ.length - 1, neck: CFG.neckBones, head: 'Head' },
  wings: wings.map((wg) => ({ tag: wg.tag, side: wg.side, columns: wg.columns.map((c) => (c ? c.k : null)),
    fan: wg.columns.map((c) => (c ? { k: c.k, s: +(Math.min(c.s, wg.cum[wg.cum.length - 1]) / wg.cum[wg.cum.length - 1]).toFixed(3) } : null)).filter(Boolean) })),
  plumes: plumes.map((q) => q.name), legs: legs.map((l) => l.tag), crest: strands.map((st) => st.name),
};
// triangles that stretch too much in some pose of the beat are cut (list from rigs/scan-tears.mjs; indices of the prepped mesh)
{
  const cutFile = new URL(`./cuts/fenix-${variant}.json`, import.meta.url);
  if (fs.existsSync(cutFile)) {
    const cut = new Set(JSON.parse(fs.readFileSync(cutFile, 'utf8')).cut);
    const keep = [];
    for (let t = 0; t < idx.length / 3; t++) if (!cut.has(t)) keep.push(idx[t*3], idx[t*3+1], idx[t*3+2]);
    // cutting a bridge leaves its halves as small floating islands: drop every component under MIN_ISLAND triangles
    const par = new Int32Array(W.nW).map((_, i) => i);
    const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
    for (let t = 0; t < keep.length; t += 3) { const r = find(W.weld[keep[t]]); par[find(W.weld[keep[t+1]])] = r; par[find(W.weld[keep[t+2]])] = r; }
    const cnt = new Map(); for (let t = 0; t < keep.length; t += 3) { const r = find(W.weld[keep[t]]); cnt.set(r, (cnt.get(r) ?? 0) + 1); }
    const MIN_ISLAND = +(process.env.MIN_ISLAND ?? 150);
    const kept2 = []; let islands = 0;
    for (let t = 0; t < keep.length; t += 3) { if (cnt.get(find(W.weld[keep[t]])) >= MIN_ISLAND) kept2.push(keep[t], keep[t+1], keep[t+2]); }
    for (const c of cnt.values()) if (c < MIN_ISLAND) islands++;
    prim.getIndices().setArray(new Uint32Array(kept2));
    log('stretch cuts applied:', cut.size, 'triangles removed;', islands, 'floating islands dropped (<', MIN_ISLAND, 'tris)');
  }
}
writeSkin(doc, prim, joints, top, W.weld, { skinName: 'FenixSkin', extras });
await io.write(output, doc);
fs.writeFileSync(output.replace(/\.glb$/, '.skeleton.json'), JSON.stringify({ extras, joints: joints.map((j) => ({ name: j.name, parent: j.parent == null ? null : joints[j.parent].name, pos: R4(j.pos) })) }, null, 1));
log('wrote', output, joints.length + ' joints');

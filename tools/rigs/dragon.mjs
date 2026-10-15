// Rig builder for the dragon (Qinglong): skeleton + skin weights, from the prepped (canonical frame) GLB.
//   node rigs/dragon.mjs <prep.glb> <out.glb> [web|lite]
//
// Canonical frame: Y up, faces -Z, height 1, centred. Skeleton (all rest rotations identity, see lib/gltfskin.mjs):
//   Spine_51 (ROOT, neck top / skull base) -> Spine_50 ... Spine_00 (tail tip): one dense chain (52) through the medial axis,
//       skinned with a clamped cubic B-spline (Bendy-Bone smoothness); the body hangs from the head like a rope from a handle.
//   Head, HeadTip                      skull joint under Spine_51 (own rotation), leaf at the snout
//   Whisker_{L,R}{A,B}_{1..6}+Tip      FK strands grown from the muzzle (thin surface components), parented to Head
//   Mane_<bin>_{1..3}+Tip              FK locks of the dorsal fringe / hair, one chain per spine bin, parented to the nearest spine joint
//   HeadTip                       leaf at the snout (direction reference only; carries no vertices)
//   Leg_{FL,FR,HL,HR}_{1..4}+Tip  hip, knee, ankle, toe base, toe tip (digitigrade chain, parented to the nearest spine joint)
// The axis comes from a voxelised copy of the mesh: the minimum-cost path through its distance field (= the centre of the
// tube; the shortest SURFACE path hugs the inside of every bend and ends up on the back).
import { loadPrep, weldByPosition, adjacency, components, len, sub, add, mul, R4, pathLength, resample } from './lib/mesh.mjs';
import { voxelize, edt, medialPath, resampleWithRadius, localThickness } from './lib/volume.mjs';
import { tubeWeights, smoothWeights, topInfluences, weightReport, bsplineBasis } from './lib/skin.mjs';
import { maskComponents, maskedDijkstra, maskedPath, smoothstep } from './lib/strands.mjs';
import { writeSkin } from './lib/gltfskin.mjs';
import fs from 'node:fs';

const [, , input, output, variant = 'web'] = process.argv;
const T0 = Date.now(), log = (...a) => console.log(`[dragon ${((Date.now() - T0) / 1000).toFixed(1)}s]`, ...a);

const CFG = {
  spineJoints: 52,        // Spine_00..Spine_51 (the last one is the head)
  headLength: 0.29,       // skull base -> snout, in canonical units (height = 1)
  voxel: 0.008,
  legFractions: [1.0, 0.66, 0.36, 0.14, 0.0],   // hip, knee, ankle, toe base, tip: position along the foot->hip path, from the foot
  hipClearance: 0.85,     // the leg ends where its clearance reaches this share of the body radius at the attach point
  kappa: 6, smooth: 2, smoothLambda: 0.4,
  neckBlend: 0.10,        // arc length over which the neck gradually follows the head's own joint
  thin: 0.02,             // local thickness (clearance) below which a surface is a strand
  whiskerMinVerts: 60, whiskerMinLength: 0.18, whiskerRootDist: 0.16, whiskerBones: 6,
  maneRigidRamp: 0.06,    // vertices this far beyond the body surface take the lock's attachment skinning completely
  maneBin: 0.12, maneOutside: 1.3, maneMinVerts: 40, maneMinReach: 0.05, maneBones: 3, maneBlend: [0.05, 0.45],
};

const { io, doc, prim, pos, idx } = await loadPrep(input);
const W = weldByPosition(pos), adj = adjacency(W.weld, idx, W.nW), C = components(adj);
const p = W.p, big = C.sizes.indexOf(Math.max(...C.sizes));
const P = (i) => [p[i*3], p[i*3+1], p[i*3+2]];
log('welded', W.nW, 'components', C.count);

// ---- body axis ----
let a = -1, b = -1, za = -1e9, zb = 1e9, ymin = 1e9;
for (let i = 0; i < W.nW; i++) {
  if (C.comp[i] !== big) continue;
  ymin = Math.min(ymin, p[i*3+1]);
  if (p[i*3+2] > za) { za = p[i*3+2]; a = i; }                                  // tail tip: furthest back
  if (p[i*3+1] > 0.05 && p[i*3+2] < zb) { zb = p[i*3+2]; b = i; }               // snout: furthest forward, above the toes
}
const V = voxelize(pos, idx, CFG.voxel);
const dt = edt(V);
log('voxels', V.n.join('x'), 'solid', V.inside);
const raw = medialPath(V, dt, P(a), P(b));
const axis = resampleWithRadius(raw, 600);
const L = axis.length;
log('axis length', L.toFixed(3), 'tail tip', P(a).map((v) => v.toFixed(3)).join(' '), 'snout', P(b).map((v) => v.toFixed(3)).join(' '));

// arc length -> position / radius along the dense axis
const cum = [0];
for (let i = 1; i < axis.pts.length; i++) cum.push(cum[i-1] + len(sub(axis.pts[i], axis.pts[i-1])));
const atArc = (s) => {
  s = Math.min(Math.max(s, 0), cum[cum.length - 1]);
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
  const t = (s - cum[lo]) / ((cum[hi] - cum[lo]) || 1);
  return { p: [0, 1, 2].map((c) => axis.pts[lo][c] + (axis.pts[hi][c] - axis.pts[lo][c]) * t), r: axis.r[lo] + (axis.r[hi] - axis.r[lo]) * t };
};

// ---- spine joints ----
const N = CFG.spineJoints, sHead = L - CFG.headLength;
const joints = [];            // { name, parent, pos }
const spine = [];
for (let i = 0; i < N; i++) {
  const q = atArc((i * sHead) / (N - 1));
  spine.push({ i, pos: q.p, r: q.r, arc: (i * sHead) / (N - 1) });
}
// root = the HEAD: the body hangs from it like a rope from a handle, so every bone carries exactly one segment (toward the
// tail) and a controller can lead with the head (path following) and let the body trail behind.
const R = N - 1;
log('spine joints', N, 'root', 'Spine_' + (N - 1), 'at', spine[R].pos.map((v) => v.toFixed(3)).join(' '));
const nameOf = (i) => `Spine_${String(i).padStart(2, '0')}`;
const spineJoint = new Array(N);
const pushJoint = (name, parent, pos) => { joints.push({ name, parent, pos }); return joints.length - 1; };
spineJoint[R] = pushJoint(nameOf(R), null, spine[R].pos);
for (let i = R - 1; i >= 0; i--) spineJoint[i] = pushJoint(nameOf(i), spineJoint[i+1], spine[i].pos);
const snout = atArc(L).p;
// the skull has its OWN joint under the neck top: turning the head must not drag the neck's last joint off the curve
const headJoint = pushJoint('Head', spineJoint[N-1], spine[N-1].pos);
const headTip = pushJoint('HeadTip', headJoint, snout);

// ---- legs ----
// feet = clusters of the lowest vertices on an xz grid
const yFoot = ymin + 0.045, cell = 0.02, occ = new Map();
for (let i = 0; i < W.nW; i++) {
  if (C.comp[i] !== big || p[i*3+1] > yFoot) continue;
  const k = `${Math.floor(p[i*3] / cell)},${Math.floor(p[i*3+2] / cell)}`;
  let c = occ.get(k); if (!c) occ.set(k, c = { n: 0, sx: 0, sy: 0, sz: 0 });
  c.n++; c.sx += p[i*3]; c.sy += p[i*3+1]; c.sz += p[i*3+2];
}
const seen = new Set(), clusters = [];
for (const k of occ.keys()) {
  if (seen.has(k)) continue;
  const st = [k], cl = { n: 0, sx: 0, sy: 0, sz: 0 }; seen.add(k);
  while (st.length) {
    const u = st.pop(), c = occ.get(u); cl.n += c.n; cl.sx += c.sx; cl.sy += c.sy; cl.sz += c.sz;
    const [x, z] = u.split(',').map(Number);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { const kk = `${x+dx},${z+dz}`; if (occ.has(kk) && !seen.has(kk)) { seen.add(kk); st.push(kk); } }
  }
  clusters.push({ n: cl.n, c: [cl.sx / cl.n, cl.sy / cl.n, cl.sz / cl.n] });
}
clusters.sort((x, y) => y.n - x.n);
const feet = clusters.filter((c) => c.n >= 0.2 * clusters[0].n).slice(0, 4);
log('feet found', feet.length, feet.map((f) => f.c.map((v) => v.toFixed(2)).join(',')).join(' | '));
if (feet.length !== 4) console.warn('WARNING: expected 4 feet, found', feet.length);

const legs = [];
// front vs hind legs: attached on the head side or the tail side of the middle of the body (the joint nearest the origin)
let bodyMid = 0; { let d0 = 1e9; spine.forEach((s2, i) => { const d = len(s2.pos); if (d < d0) { d0 = d; bodyMid = i; } }); }
for (const f of feet) {
  // attach point: the spine sample nearest to a point above the foot
  let bi = 0, bd = 1e9;
  spine.forEach((s, i) => { const d = len(sub(s.pos, [f.c[0], f.c[1] + 0.25, f.c[2]])); if (d < bd) { bd = d; bi = i; } });
  const path = resampleWithRadius(medialPath(V, dt, f.c, spine[bi].pos, { smooth: 4 }), 80);
  // cut where the leg disappears into the body: first sample (from the foot) whose clearance reaches the body radius
  let cut = path.pts.length - 1;
  for (let k = 0; k < path.pts.length; k++) if (path.r[k] >= CFG.hipClearance * spine[bi].r) { cut = k; break; }
  cut = Math.max(cut, Math.floor(path.pts.length * 0.5));
  const leg = { foot: f.c, attach: bi, pts: path.pts.slice(0, cut + 1), r: path.r.slice(0, cut + 1) };
  leg.length = pathLength(leg.pts);
  legs.push(leg);
}
const sideOf = (x) => (x < 0 ? 'L' : 'R');
const seenNames = new Set();
for (const leg of legs) {
  const front = leg.attach > bodyMid, name = `${front ? 'F' : 'H'}${sideOf(leg.foot[0])}`;
  leg.name = seenNames.has(name) ? `${name}2` : name; seenNames.add(name);
  // joints from the hip down: fractions are measured from the foot
  const cumL = [0];
  for (let k = 1; k < leg.pts.length; k++) cumL.push(cumL[k-1] + len(sub(leg.pts[k], leg.pts[k-1])));
  const total = cumL[cumL.length - 1];
  const at = (frac) => {                       // frac 0 = foot, 1 = hip
    const s = frac * total; let k = 1; while (k < cumL.length - 1 && cumL[k] < s) k++;
    const t = (s - cumL[k-1]) / ((cumL[k] - cumL[k-1]) || 1);
    return { p: [0, 1, 2].map((c) => leg.pts[k-1][c] + (leg.pts[k][c] - leg.pts[k-1][c]) * t), r: leg.r[k-1] + (leg.r[k] - leg.r[k-1]) * t };
  };
  const parent = spineJoint[leg.attach];
  leg.joints = []; leg.samples = [];
  CFG.legFractions.forEach((fr, k) => {
    const q = at(fr);
    const nm = k < 4 ? `Leg_${leg.name}_${k + 1}` : `Leg_${leg.name}_Tip`;
    const j = pushJoint(nm, k === 0 ? parent : leg.joints[k-1], q.p);
    leg.joints.push(j); leg.samples.push(q);
  });
  log('leg', leg.name, 'attach spine', leg.attach, 'length', total.toFixed(3), 'hip', leg.samples[0].p.map((v) => v.toFixed(3)).join(' '));
}

// ---- base weights: spine (cubic B-spline along the chain) + legs (tube ownership) ----
const tubes = [];
{
  const js = [], pts = [], r = [];
  for (let i = 0; i < N; i++) { js.push(spineJoint[i]); pts.push(spine[i].pos); r.push(spine[i].r); }
  // beyond the head joint the tube continues to the snout WITHOUT a joint: everything there stays on the head
  const steps = 4;
  for (let k = 1; k <= steps; k++) { const q = atArc(sHead + (CFG.headLength * k) / steps); js.push(-1); pts.push(q.p); r.push(Math.max(q.r, 0.05)); }
  const bs = bsplineBasis(N);                       // joint index space: Spine_00 = 0 ... Spine_51 (neck top) = N-1
  const zone = CFG.neckBlend / (sHead / (N - 1));    // blend length in joint-index units
  const smooth01 = (x) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
  tubes.push({ name: 'spine', joints: js, pts, r, basis: (i, t) => {
    const x = i + t;
    if (x >= N - 1) return [[headJoint, 1]];
    const beta = smooth01((x - (N - 1 - zone)) / zone);
    const w = bs(x).map(([k, wk]) => [spineJoint[k], wk * (1 - beta)]);
    if (beta > 0) w.push([headJoint, beta]);
    return w;
  } });
}
for (const leg of legs) {
  tubes.push({ name: `leg${leg.name}`, joints: leg.joints.slice(), pts: leg.samples.map((s) => s.p), r: leg.samples.map((s) => Math.max(s.r, 0.02)) });
}
const J0 = joints.length;
const base = tubeWeights({ p, nW: W.nW, tubes, J: J0, kappa: CFG.kappa }).W;
const legJoint = new Uint8Array(J0); legs.forEach((l) => l.joints.forEach((j) => { legJoint[j] = 1; }));
const legShare = new Float32Array(W.nW);
for (let v = 0; v < W.nW; v++) { let s = 0; for (let j = 0; j < J0; j++) if (legJoint[j]) s += base[v*J0 + j]; legShare[v] = s; }
log('base weights done, joints', J0);

// ---- distance of every vertex to the body axis ----
const nearest = new Int32Array(W.nW), dAxis = new Float32Array(W.nW);
for (let v = 0; v < W.nW; v++) {
  let bi = 0, bd = 1e9;
  for (let k = 0; k < axis.pts.length; k++) {
    const q = axis.pts[k], dx = p[v*3] - q[0], dy = p[v*3+1] - q[1], dz = p[v*3+2] - q[2], d = dx*dx + dy*dy + dz*dz;
    if (d < bd) { bd = d; bi = k; }
  }
  nearest[v] = bi; dAxis[v] = Math.sqrt(bd);
}

// ---- whiskers: thin strands near the head ----
const thickV = localThickness(V, dt, pos, 0.03);          // per original vertex
const thin = new Uint8Array(W.nW);
for (let i = 0; i < pos.length / 3; i++) if (thickV[i] < CFG.thin) thin[W.weld[i]] = 1;
const whiskers = [];
{
  const comps = maskComponents(adj, thin).filter((c) => c.length >= CFG.whiskerMinVerts);
  for (const c of comps) {
    let mnx = 1e9, mny = 1e9, mnz = 1e9, mxx = -1e9, mxy = -1e9, mxz = -1e9;
    for (const v of c) { mnx = Math.min(mnx, p[v*3]); mxx = Math.max(mxx, p[v*3]); mny = Math.min(mny, p[v*3+1]); mxy = Math.max(mxy, p[v*3+1]); mnz = Math.min(mnz, p[v*3+2]); mxz = Math.max(mxz, p[v*3+2]); }
    const diag = Math.hypot(mxx - mnx, mxy - mny, mxz - mnz);
    if (diag < CFG.whiskerMinLength) continue;
    // the root is the end nearest to the snout (the whisker grows out of the muzzle)
    let root = c[0], rd = 1e9;
    for (const v of c) { const d = len(sub([p[v*3], p[v*3+1], p[v*3+2]], snout)); if (d < rd) { rd = d; root = v; } }
    if (rd > CFG.whiskerRootDist) continue;                // thin and long but not attached to the muzzle: a horn, not a whisker
    const mask = new Uint8Array(W.nW); for (const v of c) mask[v] = 1;
    const { dist } = maskedDijkstra(adj, p, mask, root);
    let tip = root, td = 0; for (const v of c) if (isFinite(dist[v]) && dist[v] > td) { td = dist[v]; tip = v; }
    const path = maskedPath(adj, p, mask, root, tip);
    whiskers.push({ verts: c, mask, root, tip, path, length: td });
  }
  whiskers.sort((a, b) => b.length - a.length);
}
log('whiskers', whiskers.length, whiskers.map((w) => w.length.toFixed(2)).join(' '));
const wSeen = {};
for (const w of whiskers) {
  const mid = w.path[w.path.length >> 1], side = mid[0] < 0 ? 'L' : 'R';
  wSeen[side] = (wSeen[side] ?? 0) + 1;
  w.name = `${side}${String.fromCharCode(64 + wSeen[side])}`;
  const rs = resample(w.path, CFG.whiskerBones + 1);
  w.joints = []; w.pts = rs;
  rs.forEach((q, k) => {
    const nm = k < CFG.whiskerBones ? `Whisker_${w.name}_${k + 1}` : `Whisker_${w.name}_Tip`;
    w.joints.push(pushJoint(nm, k === 0 ? headJoint : w.joints[k - 1], q));
  });
}

// ---- mane: every connected lock of hair/fringe sticking out of the body becomes one FK chain ----
// (connected on the surface: a blade that curls back along the body stays ONE piece, attached by its own base)
const whiskerOf = new Int32Array(W.nW).fill(-1); whiskers.forEach((w, i) => { for (const v of w.verts) whiskerOf[v] = i; });
const outMask = new Uint8Array(W.nW), margin = new Float32Array(W.nW);
for (let v = 0; v < W.nW; v++) {
  if (whiskerOf[v] >= 0 || legShare[v] > 0.35) continue;
  const k = nearest[v], s = cum[k], rBody = axis.r[k];
  if (s > sHead - 0.01) continue;
  margin[v] = dAxis[v] - (CFG.maneOutside * rBody + 0.012);
  if (margin[v] > 0) outMask[v] = 1;
}
const manes = [];
{
  const comps = maskComponents(adj, outMask).filter((c) => c.length >= CFG.maneMinVerts).sort((x, y) => y.length - x.length);
  comps.forEach((vs, ci) => {
    // base = the vertices closest to the body: where the lock grows out
    const byBase = vs.slice().sort((x, y) => margin[x] - margin[y]);
    const base = byBase.slice(0, Math.max(6, Math.floor(vs.length * 0.12)));
    let sx = 0, sy = 0, sz = 0, sArc = 0;
    for (const v of base) { const q = axis.pts[nearest[v]]; sx += p[v*3] - q[0]; sy += p[v*3+1] - q[1]; sz += p[v*3+2] - q[2]; sArc += cum[nearest[v]]; }
    let dir = [sx / base.length, sy / base.length, sz / base.length]; const dl = len(dir) || 1; dir = dir.map((c) => c / dl);
    const arc = sArc / base.length, a0 = atArc(arc);
    const rootPos = add(a0.p, mul(dir, a0.r * 0.8));
    const far = byBase.slice(-Math.max(6, Math.floor(vs.length * 0.12)));
    let tx = 0, ty = 0, tz = 0; for (const v of far) { tx += p[v*3]; ty += p[v*3+1]; tz += p[v*3+2]; }
    const tipPos = [tx / far.length, ty / far.length, tz / far.length];
    const reach = len(sub(tipPos, rootPos));
    if (reach < CFG.maneMinReach) return;
    let pj = 0, pd = 1e9; spine.forEach((s2, i) => { const d = len(sub(s2.pos, a0.p)); if (d < pd) { pd = d; pj = i; } });
    const id = String(manes.length).padStart(2, '0'), js = [];
    for (let k = 0; k <= CFG.maneBones; k++) {
      const q = [0, 1, 2].map((c) => rootPos[c] + (tipPos[c] - rootPos[c]) * (k / CFG.maneBones));
      const nm = k < CFG.maneBones ? `Mane_${id}_${k + 1}` : `Mane_${id}_Tip`;
      js.push(pushJoint(nm, k === 0 ? spineJoint[pj] : js[k - 1], q));
    }
    manes.push({ id, verts: vs, root: rootPos, tip: tipPos, reach, joints: js, rBody: a0.r, arc });
  });
  log('mane components', comps.length, 'sizes', comps.slice(0, 8).map((c) => c.length).join(','));
}
log('mane groups', manes.length, 'bones', manes.reduce((s, m) => s + m.joints.length, 0));

// ---- assemble the dense weights ----
const J = joints.length;
const Wd = new Float32Array(W.nW * J);
for (let v = 0; v < W.nW; v++) for (let j = 0; j < J0; j++) Wd[v*J + j] = base[v*J0 + j];
// hat weight along a joint chain for parameter t in [0,1] (joints at k / (m-1))
const hat = (js, t) => {
  const m = js.length, x = Math.min(Math.max(t, 0), 1) * (m - 1), i = Math.min(m - 2, Math.floor(x)), f = x - i;
  return [[js[i], 1 - f], [js[i+1], f]];
};
const blend = (v, chainWeights, beta) => {           // (1-beta) * existing + beta * chain
  for (let j = 0; j < J; j++) Wd[v*J + j] *= (1 - beta);
  for (const [j, w] of chainWeights) Wd[v*J + j] += beta * w;
};
const bsSpine = bsplineBasis(N);
const arcStep = sHead / (N - 1);
for (const m of manes) {
  const dirv = sub(m.tip, m.root), L2 = len(dirv);
  // skinning of the attachment point: every vertex of the lock far from the body rides on THIS, as one rigid piece
  const att = bsSpine(Math.min(N - 1, m.arc / arcStep)).map(([k, w]) => [spineJoint[k], w]);
  for (const v of m.verts) {
    const dOut = dAxis[v] - (CFG.maneOutside * axis.r[nearest[v]] + 0.012);
    const gamma = smoothstep(0, CFG.maneRigidRamp, dOut);
    if (gamma > 0) {
      for (let j = 0; j < J; j++) Wd[v*J + j] *= (1 - gamma);
      for (const [j, w] of att) Wd[v*J + j] += gamma * w;
    }
    const q = sub([p[v*3], p[v*3+1], p[v*3+2]], m.root);
    const t = (q[0]*dirv[0] + q[1]*dirv[1] + q[2]*dirv[2]) / (L2 * L2);
    // gradient: the base of the lock stays on the body, the free end follows its own chain
    blend(v, hat(m.joints, t), smoothstep(CFG.maneBlend[0], CFG.maneBlend[1], t));
  }
}
for (const w of whiskers) {
  const { dist } = maskedDijkstra(adj, p, w.mask, w.root);
  for (const v of w.verts) {
    const t = isFinite(dist[v]) ? dist[v] / w.length : 0;
    blend(v, hat(w.joints, t), smoothstep(0.0, 0.12, t));      // root end glued to the head, the rest follows the whisker
  }
}
const Ws = smoothWeights(Wd, adj, J, CFG.smooth, CFG.smoothLambda);
const top = topInfluences(Ws, W.nW, J, 4);
const rep = weightReport(top, W.nW, joints.map((j) => j.name));
log('joints', J, ' dominant-joint share', (rep.dominantShare * 100).toFixed(1) + '%', ' unused', rep.unused.length ? rep.unused.join(',') : 'none');

// ---- export ----
const extras = {
  rig: 'dragon', variant, spine: { count: N, root: N - 1, head: 'Head' }, legs: legs.map((l) => l.name),
  whiskers: whiskers.map((w) => w.name), mane: manes.map((m) => m.id),
  // clearance radius of the body at every spine joint (Spine_00 .. Spine_NN): lets a controller keep bends from pinching
  spineRadius: spine.map((s) => +s.r.toFixed(4)),
};
writeSkin(doc, prim, joints, top, W.weld, { skinName: 'DragonSkin', extras });
await io.write(output, doc);
fs.writeFileSync(output.replace(/\.glb$/, '.skeleton.json'), JSON.stringify({
  extras, joints: joints.map((j) => ({ name: j.name, parent: j.parent == null ? null : joints[j.parent].name, pos: R4(j.pos) })),
}, null, 1));
log('wrote', output, `${joints.length} joints`);

// Adds a procedural "Hover" animation (flying, staying in the air) to the Meshy-rigged dragon, to test its rig in any glTF viewer.
//   node tools/meshy-test/make-dragon-walk.mjs [in.glb] [out.glb]
// Roles (read off the hierarchy and rest positions; the dragon faces -x, tail toward +x, y up, left = +z):
//   pelvis 000 001 003 002   back 006 005 004   chest 028 027 026   neck + head 041..037 (+ head ornaments 043..042 / 045..044)
//   front legs 032..029 (L) / 036..033 (R)   hind legs 016..012 (L) / 011..007 (R)   tail 021..017   side chains 023/022, 025/024
// Every bone is posed in WORLD space (rotation delta on top of the rest world rotation, local derived from the posed parent).
import { NodeIO } from '@gltf-transform/core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '../..');
const [, , inArg, outArg] = process.argv;
const input = inArg ?? path.join(REPO, 'model/dragon/dragon-RIG.glb'), output = outArg ?? path.join(REPO, 'model/meshy-test/Dragon_fly.glb');

// ── quaternion / vector maths ([x,y,z,w]) ──
const qmul = (a, b) => [a[3]*b[0] + a[0]*b[3] + a[1]*b[2] - a[2]*b[1], a[3]*b[1] - a[0]*b[2] + a[1]*b[3] + a[2]*b[0], a[3]*b[2] + a[0]*b[1] - a[1]*b[0] + a[2]*b[3], a[3]*b[3] - a[0]*b[0] - a[1]*b[1] - a[2]*b[2]];
const qinv = (q) => [-q[0], -q[1], -q[2], q[3]];
const qaxis = (ax, ang) => { const s = Math.sin(ang / 2); return [ax[0]*s, ax[1]*s, ax[2]*s, Math.cos(ang / 2)]; };
const qrot = (q, v) => { const r = qmul(qmul(q, [v[0], v[1], v[2], 0]), qinv(q)); return [r[0], r[1], r[2]]; };
const qnorm = (q) => { const l = Math.hypot(...q); return q.map((x) => x / l); };
const matQuat = (m) => {
  const t = m[0] + m[5] + m[10]; let x, y, z, w;
  if (t > 0) { const s = Math.sqrt(t + 1) * 2; w = s / 4; x = (m[6] - m[9]) / s; y = (m[8] - m[2]) / s; z = (m[1] - m[4]) / s; }
  else if (m[0] > m[5] && m[0] > m[10]) { const s = Math.sqrt(1 + m[0] - m[5] - m[10]) * 2; w = (m[6] - m[9]) / s; x = s / 4; y = (m[4] + m[1]) / s; z = (m[8] + m[2]) / s; }
  else if (m[5] > m[10]) { const s = Math.sqrt(1 + m[5] - m[0] - m[10]) * 2; w = (m[8] - m[2]) / s; x = (m[4] + m[1]) / s; y = s / 4; z = (m[9] + m[6]) / s; }
  else { const s = Math.sqrt(1 + m[10] - m[0] - m[5]) * 2; w = (m[1] - m[4]) / s; x = (m[8] + m[2]) / s; y = (m[9] + m[6]) / s; z = s / 4; }
  return qnorm([x, y, z, w]);
};
const X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];
const Rx = (a) => qaxis(X, a), Ry = (a) => qaxis(Y, a), Rz = (a) => qaxis(Z, a);
const TAU = Math.PI * 2;
const ease = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };

const io = new NodeIO();
const doc = await io.read(input);
const root = doc.getRoot();
const byName = new Map(); root.listNodes().forEach((n) => byName.set(n.getName(), n));
const B = (n) => { const b = byName.get('Bone_' + String(n).padStart(3, '0')); if (!b) throw new Error('missing Bone_' + n); return b; };
const arm = byName.get('SmartRigArmature');
const armW = arm.getWorldMatrix();
if (!armW.every((x, i) => Math.abs(x - (i % 5 === 0 ? 1 : 0)) < 1e-5)) console.warn('WARNING: the armature is not at the identity transform');

// ── rest data ──
const rest = new Map();               // node -> { lrot, lpos, wrot, wpos }
const walk = (node) => {
  const m = node.getWorldMatrix();
  rest.set(node, { lrot: node.getRotation(), lpos: node.getTranslation(), wrot: matQuat(m), wpos: [m[12], m[13], m[14]] });
  node.listChildren().forEach(walk);
};
arm.listChildren().filter((c) => c.getName().startsWith('Bone_')).forEach(walk);
const order = [];                      // DFS order of bones
const dfs = (n) => { order.push(n); n.listChildren().forEach(dfs); };
arm.listChildren().filter((c) => c.getName().startsWith('Bone_')).forEach(dfs);

// ── the hover ──
const T = 3.0, FPS = 30, N = Math.round(T * FPS);
const spec = new Map();                // node -> { rot?: t -> world delta quat, pos?: t -> world position delta }
const setRot = (n, fn) => { const o = spec.get(n) ?? {}; o.rot = fn; spec.set(n, o); };
const setPos = (n, fn) => { const o = spec.get(n) ?? {}; o.pos = fn; spec.set(n, o); };
const ph = (t) => (t / T) % 1;
const S = (t, k, lag = 0) => Math.sin(TAU * (k * ph(t) - lag));     // k whole cycles per loop (the clip closes cleanly)

// an eastern dragon flies without wings: it swims through the air. The whole body floats a little above the ground, a slow
// wave runs from the head to the tail (vertical and sideways), and the legs hang tucked and trail behind.
const LIFT = 0.55;
setPos(B(0), (t) => [0.02 * S(t, 1, 0.1), LIFT + 0.035 * S(t, 1, 0.0) + 0.012 * S(t, 2, 0.3), 0]);

const body = [0, 1, 3, 2, 6, 5, 4, 28, 27, 26, 41, 40, 39, 38, 37, 21, 20, 19, 18, 17];
for (const k of body) {
  const x = rest.get(B(k)).wpos[0];
  const e = Math.min(1, Math.abs(x - 0.1) / 0.9);                  // 0 at the pelvis, 1 at the ends
  const aZ = 0.06 + 0.11 * e, aY = 0.05 + 0.09 * e;
  setRot(B(k), (t) => qmul(Ry(aY * S(t, 1, 0.55 * x + 0.1)), Rz(aZ * S(t, 1, 0.42 * x))));
}
// the head stays attentive: it counter-nods against the neck wave
[43, 42, 45, 44].forEach((k, i) => setRot(B(k), (t) => qmul(Ry(0.2 * S(t, 2, 0.1 * i)), Rz(0.15 * S(t, 2, 0.15 * i + 0.2)))));
// side chains (mane / fins): they stream in the wind of the movement
[23, 22, 25, 24].forEach((k, i) => setRot(B(k), (t) => qmul(Rz(0.25 + 0.2 * S(t, 2, 0.12 * i)), Ry(0.18 * S(t, 1, 0.1 * i + 0.3)))));

// legs: front legs fold forward against the chest, hind legs trail back; all of them drift with a little lag
const tuckF = [-0.25, -0.55, -1.25, -1.6], tuckH = [0.25, 0.55, 1.0, 0.9, 0.6];
const legs = [
  { chain: [32, 31, 30, 29], tuck: tuckF, lag: 0.00 },
  { chain: [36, 35, 34, 33], tuck: tuckF, lag: 0.12 },
  { chain: [16, 15, 14, 13, 12], tuck: tuckH, lag: 0.20 },
  { chain: [11, 10, 9, 8, 7], tuck: tuckH, lag: 0.32 },
];
for (const leg of legs) leg.chain.forEach((k, i) => setRot(B(k), (t) => Rz(leg.tuck[i] + (0.08 + 0.05 * i) * S(t, 1, leg.lag + 0.06 * i))));

// ── evaluate the clip: forward kinematics frame by frame ──
const times = new Float32Array(N + 1); for (let i = 0; i <= N; i++) times[i] = i / FPS;
const rotOut = new Map(), posOut = new Map();
const prevQ = new Map();
for (let f = 0; f <= N; f++) {
  const t = f === N ? 0 : times[f];
  const world = new Map();            // node -> { rot, pos }
  for (const node of order) {
    const r = rest.get(node), parent = node.getParentNode(), pw = parent && world.get(parent) ? world.get(parent) : { rot: [0, 0, 0, 1], pos: [0, 0, 0] };
    const s = spec.get(node);
    let lrot = r.lrot, lpos = r.lpos;
    if (s?.rot) lrot = qnorm(qmul(qinv(pw.rot), qmul(s.rot(t), r.wrot)));
    if (s?.pos) { const d = s.pos(t), want = [r.wpos[0] + d[0], r.wpos[1] + d[1], r.wpos[2] + d[2]]; lpos = qrot(qinv(pw.rot), [want[0] - pw.pos[0], want[1] - pw.pos[1], want[2] - pw.pos[2]]); }
    const wrot = qnorm(qmul(pw.rot, lrot)), off = qrot(pw.rot, lpos);
    world.set(node, { rot: wrot, pos: [pw.pos[0] + off[0], pw.pos[1] + off[1], pw.pos[2] + off[2]] });
    if (s?.rot) {
      let q = lrot; const prev = prevQ.get(node);
      if (prev && prev[0]*q[0] + prev[1]*q[1] + prev[2]*q[2] + prev[3]*q[3] < 0) q = q.map((x) => -x);   // keep the sign continuous
      prevQ.set(node, q);
      if (!rotOut.has(node)) rotOut.set(node, new Float32Array((N + 1) * 4));
      rotOut.get(node).set(q, f * 4);
    }
    if (s?.pos) { if (!posOut.has(node)) posOut.set(node, new Float32Array((N + 1) * 3)); posOut.get(node).set(lpos, f * 3); }
  }
}
// ── write ──
const buffer = root.listBuffers()[0];
const timeAcc = doc.createAccessor('times').setType('SCALAR').setArray(times).setBuffer(buffer);
const anim = doc.createAnimation('Hover');
const addChannel = (node, pathName, acc) => {
  const sampler = doc.createAnimationSampler().setInput(timeAcc).setOutput(acc).setInterpolation('LINEAR');
  anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(pathName).setSampler(sampler));
};
for (const [node, arr] of rotOut) addChannel(node, 'rotation', doc.createAccessor('q_' + node.getName()).setType('VEC4').setArray(arr).setBuffer(buffer));
for (const [node, arr] of posOut) addChannel(node, 'translation', doc.createAccessor('p_' + node.getName()).setType('VEC3').setArray(arr).setBuffer(buffer));
await io.write(output, doc);
console.log(`wrote ${output}: Hover ${T}s, ${rotOut.size} rotating bones, ${posOut.size} translating`);

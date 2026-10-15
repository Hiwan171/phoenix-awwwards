// Adds a procedural "Walk" animation (in place, a slow heavy walk) to the Meshy-rigged tortoise (Xuanwu: a tortoise with a serpent
// coiled on its shell), to test its rig in any glTF viewer.   node tools/meshy-test/make-tortoise-walk.mjs [in.glb] [out.glb]
// Roles (from the hierarchy and rest positions; the animal faces +z, its tail is at -z, y up; "A" legs are at -x, "B" at +x):
//   body 000 001 004 003 002    tortoise head/neck 027 026 (+ 042 041, 049 048 058..056 061..059)
//   serpent neck + head 035..028 (+ 053..050, 055 054)    serpent tail 025..015 (11 bones)
//   front legs 047..043 (A) / 040..036 (B)    hind legs 009..005 (A) / 014..010 (B)
// Every bone is posed in WORLD space (rotation delta on top of its rest world rotation; local derived from the posed parent).
import { NodeIO } from '@gltf-transform/core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '../..');
const [, , inArg, outArg] = process.argv;
const input = inArg ?? path.join(REPO, 'model/tortoise/tortoise-RIG.glb'), output = outArg ?? path.join(REPO, 'model/meshy-test/Tortoise_walk.glb');

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

// ── the walk ──
const T = 2.4, FPS = 30, N = Math.round(T * FPS);
const spec = new Map();
const setRot = (n, fn) => { const o = spec.get(n) ?? {}; o.rot = fn; spec.set(n, o); };
const setPos = (n, fn) => { const o = spec.get(n) ?? {}; o.pos = fn; spec.set(n, o); };
const stride = (t) => (t / T) % 1;
const S = (t, k, lag = 0) => Math.sin(TAU * (k * stride(t) - lag));

// legs: lateral-sequence walk, long stance (0.7). The animal faces +z, so a positive rotation about x swings a paw BACKWARDS.
const DUTY = 0.7;
function legPhase(u) {
  u = ((u % 1) + 1) % 1;
  if (u < DUTY) return { swing: -1 + 2 * (u / DUTY), lift: 0 };
  const s = (u - DUTY) / (1 - DUTY);
  return { swing: 1 - 2 * ease(s), lift: Math.sin(Math.PI * s) };
}
const legs = {
  FA: { chain: [47, 46, 45, 44, 43], off: 0.0, front: true },
  HB: { chain: [14, 13, 12, 11, 10], off: 0.25, front: false },
  FB: { chain: [40, 39, 38, 37, 36], off: 0.5, front: true },
  HA: { chain: [9, 8, 7, 6, 5], off: 0.75, front: false },
};
for (const leg of Object.values(legs)) {
  const A = leg.front ? 0.30 : 0.26;
  leg.chain.forEach((k, i) => {
    setRot(B(k), (t) => {
      const { swing, lift } = legPhase(stride(t) + leg.off), th = A * swing;
      const a = [0.4 * th, th, th + 0.7 * lift, 0.4 * th + 0.5 * lift, 0.3 * lift][i];
      return Rx(a);
    });
  });
}

// shell / body: heavy, a small roll and yaw with each step, and a slow bob
const bodyBones = [0, 1, 4, 3, 2];
bodyBones.forEach((k, i) => setRot(B(k), (t) => qmul(Rz(0.035 * S(t, 2, 0.15 + 0.03 * i)), Ry(0.03 * S(t, 1, 0.05 * i)))));
setPos(B(0), (t) => [0, 0.012 * Math.cos(TAU * 2 * stride(t) + 0.3), 0]);

// tortoise head: nods with the step; the serpent's neck and head sway, slowly and out of phase
[27, 26].forEach((k, i) => setRot(B(k), (t) => qmul(Rx(0.06 * S(t, 2, 0.2 + 0.1 * i)), Ry(0.08 * S(t, 1, 0.3)))));
[42, 41, 49, 48, 58, 57, 56, 61, 60, 59].forEach((k, i) => setRot(B(k), (t) => qmul(Rx(0.10 * S(t, 2, 0.1 * (i % 5))), Ry(0.08 * S(t, 1, 0.05 * i)))));
const serpentNeck = [35, 34, 33, 32, 31, 30, 29, 28];
serpentNeck.forEach((k, i) => setRot(B(k), (t) => qmul(Ry(0.10 * (0.4 + i / 8) * S(t, 1, 0.12 * i + 0.4)), Rx(0.08 * (0.4 + i / 8) * S(t, 1, 0.1 * i)))));
[53, 52, 51, 50, 55, 54].forEach((k, i) => setRot(B(k), (t) => qmul(Ry(0.25 * S(t, 2, 0.1 * i)), Rx(0.18 * S(t, 2, 0.1 * i + 0.25)))));

// serpent tail: a wave running to the tip, mostly sideways
const tail = [25, 24, 23, 22, 21, 20, 19, 18, 17, 16, 15];
tail.forEach((k, i) => setRot(B(k), (t) => qmul(Ry(0.16 * (0.3 + i / 10) * S(t, 1, 0.09 * i + 0.1)), Rx(0.07 * (0.3 + i / 10) * S(t, 2, 0.08 * i)))));

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
const anim = doc.createAnimation('Walk');
const addChannel = (node, pathName, acc) => {
  const sampler = doc.createAnimationSampler().setInput(timeAcc).setOutput(acc).setInterpolation('LINEAR');
  anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(pathName).setSampler(sampler));
};
for (const [node, arr] of rotOut) addChannel(node, 'rotation', doc.createAccessor('q_' + node.getName()).setType('VEC4').setArray(arr).setBuffer(buffer));
for (const [node, arr] of posOut) addChannel(node, 'translation', doc.createAccessor('p_' + node.getName()).setType('VEC3').setArray(arr).setBuffer(buffer));
await io.write(output, doc);
console.log(`wrote ${output}: Walk ${T}s, ${rotOut.size} rotating bones, ${posOut.size} translating`);

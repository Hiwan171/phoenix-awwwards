// Adds a procedural "Walk" animation (in place) to the Meshy-rigged tiger, to test its rig in any glTF viewer.
//   node tools/meshy-test/make-walk.mjs [in.glb] [out.glb]
// The skeleton has no semantic names (Bone_NNN); roles were read off the hierarchy and the rest positions (the animal faces -x,
// the tail is at +x, y is up, left = +z):
//   spine   000 (pelvis) 001 003 002 (chest) 015 014 013 (neck) 030 029 028 (head)      tail  012 .. 004
//   legs    front-left 036..031   front-right 042..037   hind-left 027..022   hind-right 021..016
// Every bone is posed in WORLD space (a rotation delta applied on top of its rest world rotation); its local rotation is derived
// from the posed parent. That matters here: Meshy hangs the legs under the head-base / chest bones, so a plain local rotation of
// the spine would swing the legs with it.
import { NodeIO } from '@gltf-transform/core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '../..');
const [, , inArg, outArg] = process.argv;
const input = inArg ?? path.join(REPO, 'model/tiger/Tiger-RIG.glb'), output = outArg ?? path.join(REPO, 'model/meshy-test/Tiger_walk.glb');

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
const T = 1.2, FPS = 30, N = Math.round(T * FPS);
const spec = new Map();                // node -> { rot?: t -> world delta quat, pos?: t -> world position delta }
const setRot = (n, fn) => { const o = spec.get(n) ?? {}; o.rot = fn; spec.set(n, o); };
const setPos = (n, fn) => { const o = spec.get(n) ?? {}; o.pos = fn; spec.set(n, o); };

// body: pelvis bobs twice per stride; the spine undulates (yaw) and nods (pitch) with a travelling phase
const spine = [0, 1, 3, 2, 15, 14, 13, 30, 29, 28];
const stride = (t) => (t / T) % 1;
setPos(B(0), (t) => [0, 0.022 * Math.cos(TAU * 2 * stride(t) + 0.4) , 0]);
spine.forEach((k, i) => {
  setRot(B(k), (t) => qmul(Ry(0.07 * Math.sin(TAU * stride(t) - 0.5 * i)), Rz(0.025 * Math.sin(TAU * 2 * stride(t) - 0.35 * i + 0.8))));
});

// legs: lateral sequence walk (LF, RH, RF, LH), duty 0.6
const DUTY = 0.6;
function legPhase(u) {                // u in 0..1 -> { swing: -1..1 (forward .. back), lift: 0..1 }
  u = ((u % 1) + 1) % 1;
  if (u < DUTY) return { swing: -1 + 2 * (u / DUTY), lift: 0 };                       // stance: the paw travels backwards
  const s = (u - DUTY) / (1 - DUTY);                                                   // swing: back to front, with lift
  return { swing: 1 - 2 * ease(s), lift: Math.sin(Math.PI * s) };
}
const legs = {
  FL: { chain: [36, 35, 34, 33, 32, 31], off: 0.0, front: true },
  HR: { chain: [21, 20, 19, 18, 17, 16], off: 0.25, front: false },
  FR: { chain: [42, 41, 40, 39, 38, 37], off: 0.5, front: true },
  HL: { chain: [27, 26, 25, 24, 23, 22], off: 0.75, front: false },
};
for (const leg of Object.values(legs)) {
  const A = leg.front ? 0.36 : 0.34;                        // rad of swing amplitude
  leg.chain.forEach((k, i) => {
    setRot(B(k), (t) => {
      const { swing, lift } = legPhase(stride(t) + leg.off), th = A * swing;
      let a;
      if (leg.front) a = [0.3 * th, th, th + 0.95 * lift, 0.35 * th + 0.55 * lift, 0.35 * lift, 0.2 * lift][i];
      else a = [0.8 * th, 0.8 * th + 0.75 * lift, 0.25 * th - 0.55 * lift, -0.45 * lift, -0.15 * lift, 0][i];
      return Rz(a);                                          // + about z swings the paw backwards (+x), - forwards
    });
  });
}

// tail: a travelling wave, sideways and a little vertical; the head nods against the stride
const tail = [12, 11, 10, 9, 8, 7, 6, 5, 4];
tail.forEach((k, i) => setRot(B(k), (t) => qmul(Ry(0.20 * (0.35 + i / 8) * Math.sin(TAU * stride(t) - 0.55 * i)), Rz(0.07 * Math.sin(TAU * 2 * stride(t) - 0.5 * i)))));

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

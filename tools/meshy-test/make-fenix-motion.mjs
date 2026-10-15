// "Hover" clip for the Meshy phoenix after rig-feathers.mjs (every feather has its own chain): symmetric wing beat with
// shoulder / arm / forearm / hand, outer wing folding back on the upstroke, every feather following with its own lag, tail
// feathers waving independently, body bob. A glTF clip, in place (the hero holds her in the air).
//   node tools/meshy-test/make-fenix-motion.mjs [in.glb] [out.glb]
// Every bone is posed in WORLD space (rotation delta on top of its rest world rotation; the local rotation is derived from the
// posed parent), so the order of the hierarchy does not matter.
import { NodeIO } from '@gltf-transform/core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '../..');
const [, , inArg, outArg] = process.argv;
const input = inArg ?? path.join(REPO, 'model/meshy-test/Fenix_rig.glb'), output = outArg ?? path.join(REPO, 'model/meshy-test/Fenix_motion.glb');
const AMP = +(process.env.FLAP_AMP ?? 1);          // 2 = stress test
const BALANCE = process.env.BALANCE !== '0';        // even out the sculpt's two wings (they are sculpted in different poses)

const qmul = (a, b) => [a[3]*b[0] + a[0]*b[3] + a[1]*b[2] - a[2]*b[1], a[3]*b[1] - a[0]*b[2] + a[1]*b[3] + a[2]*b[0], a[3]*b[2] + a[0]*b[1] - a[1]*b[0] + a[2]*b[3], a[3]*b[3] - a[0]*b[0] - a[1]*b[1] - a[2]*b[2]];
const qinv = (q) => [-q[0], -q[1], -q[2], q[3]];
const qaxis = (ax, ang) => { const s = Math.sin(ang / 2); return [ax[0]*s, ax[1]*s, ax[2]*s, Math.cos(ang / 2)]; };
const qrot = (q, v) => { const r = qmul(qmul(q, [v[0], v[1], v[2], 0]), qinv(q)); return [r[0], r[1], r[2]]; };
const qnorm = (q) => { const l = Math.hypot(...q); return q.map((x) => x / l); };
const ID = [0, 0, 0, 1];
const matQuat = (m) => {
  const t = m[0] + m[5] + m[10]; let x, y, z, w;
  if (t > 0) { const s = Math.sqrt(t + 1) * 2; w = s / 4; x = (m[6] - m[9]) / s; y = (m[8] - m[2]) / s; z = (m[1] - m[4]) / s; }
  else if (m[0] > m[5] && m[0] > m[10]) { const s = Math.sqrt(1 + m[0] - m[5] - m[10]) * 2; w = (m[6] - m[9]) / s; x = s / 4; y = (m[4] + m[1]) / s; z = (m[8] + m[2]) / s; }
  else if (m[5] > m[10]) { const s = Math.sqrt(1 + m[5] - m[0] - m[10]) * 2; w = (m[8] - m[2]) / s; x = (m[4] + m[1]) / s; y = s / 4; z = (m[9] + m[6]) / s; }
  else { const s = Math.sqrt(1 + m[10] - m[0] - m[5]) * 2; w = (m[1] - m[4]) / s; x = (m[8] + m[2]) / s; y = (m[9] + m[6]) / s; z = s / 4; }
  return qnorm([x, y, z, w]);
};
const Rx = (a) => qaxis([1, 0, 0], a), Ry = (a) => qaxis([0, 1, 0], a), Rz = (a) => qaxis([0, 0, 1], a);
const TAU = Math.PI * 2;
const norm3 = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
const arc = (a, b) => { // shortest rotation taking unit vector a to unit vector b
  const d = a[0]*b[0] + a[1]*b[1] + a[2]*b[2], c = [a[1]*b[2] - a[2]*b[1], a[2]*b[0] - a[0]*b[2], a[0]*b[1] - a[1]*b[0]];
  return qnorm([c[0], c[1], c[2], 1 + d]);
};
const hash = (k, s) => { const x = Math.sin(k * 127.1 + s * 311.7) * 43758.5453; return x - Math.floor(x); };

const io = new NodeIO();
const doc = await io.read(input);
const root = doc.getRoot();
const byName = new Map(); root.listNodes().forEach((n) => byName.set(n.getName(), n));
const B = (k) => { const b = byName.get('Bone_' + String(k).padStart(3, '0')); if (!b) throw new Error('missing Bone_' + k); return b; };
const arm = byName.get('SmartRigArmature');

// ── rest data ──
const rest = new Map();
const order = [];
const walk = (node) => {
  const m = node.getWorldMatrix();
  rest.set(node, { lrot: node.getRotation(), lpos: node.getTranslation(), wrot: matQuat(m), wpos: [m[12], m[13], m[14]] });
  order.push(node);
  node.listChildren().forEach(walk);
};
arm.listChildren().filter((c) => c.getName().startsWith('Bone_')).forEach(walk);

// ── timing ──
const PERIOD = 1.25, LOOP = 2 * PERIOD, FPS = 30, N = Math.round(LOOP * FPS);
const ph = (t) => (t % PERIOD) / PERIOD;              // wing phase 0..1 (0 = top of the stroke)
const lift = (t) => 0.5 + 0.5 * Math.cos(TAU * ph(t)) + 0.04 * Math.sin(2 * TAU * ph(t) + 0.6);     // 1 top .. 0 bottom
const fold = (t) => Math.max(0, -Math.sin(TAU * ph(t)));                                              // outer wing folds on the upstroke
const S = (t, k, lag = 0) => Math.sin(TAU * (k * t / LOOP - lag));                                    // k whole cycles per loop

const spec = new Map();
const setRot = (n, fn) => { const o = spec.get(n) ?? {}; o.rot = fn; spec.set(n, o); };
const setPos = (n, fn) => { const o = spec.get(n) ?? {}; o.pos = fn; spec.set(n, o); };
const deltaOf = (node, t) => { for (let n = node; n; n = n.getParentNode()) { const s = spec.get(n); if (s?.rot) return s.rot(t); } return ID; };

// ── wings: even out the sculpt's two poses, then the same beat on both sides ──
const WINGS = [
  { side: -1, bones: [36, 35, 34, 50], shoulder: 36, leaves: [59, 61, 51] },     // wing A, z < 0
  { side: +1, bones: [39, 38, 37, 55], shoulder: 39, leaves: [63, 65, 56] },     // wing B, z > 0
];
const axisOf = (w) => { const s = rest.get(B(w.shoulder)).wpos, m = [0, 0, 0]; for (const k of w.leaves) { const p = rest.get(B(k)).wpos; for (let c = 0; c < 3; c++) m[c] += p[c] / w.leaves.length; } return norm3([m[0] - s[0], m[1] - s[1], m[2] - s[2]]); };
const dA = axisOf(WINGS[0]), dB = axisOf(WINGS[1]);
const mirror = (v) => [v[0], v[1], -v[2]];
const target = norm3([dB[0] + dA[0], dB[1] + dA[1], dB[2] - dA[2]]);                 // B's side; A is its mirror image
const qBal = new Map([[WINGS[0], BALANCE ? arc(dA, mirror(target)) : ID], [WINGS[1], BALANCE ? arc(dB, target) : ID]]);
const ang = (q) => (2 * Math.acos(Math.min(1, Math.abs(q[3]))) * 180) / Math.PI;
console.log(`wing axes: A ${dA.map((x) => x.toFixed(2))}  B ${dB.map((x) => x.toFixed(2))}  balance A ${ang(qBal.get(WINGS[0])).toFixed(0)} deg, B ${ang(qBal.get(WINGS[1])).toFixed(0)} deg`);

for (const w of WINGS) {
  const s = w.side, qb = qBal.get(w);
  const flap = (t) => AMP * 0.62 * (lift(t) - 0.5) * 2;                              // rad, + = raised
  // shoulder: balance, sweep back a little on the upstroke, beat about the body axis
  setRot(B(w.bones[0]), (t) => qmul(Rx(-s * flap(t)), qmul(Ry(s * 0.14 * fold(t)), qb)));
  // arm, forearm, hand: each adds its own share (the wing opens on the downstroke, folds back on the upstroke)
  const share = [[0.10, 0.18, 0.10], [0.16, 0.30, 0.10], [0.18, 0.32, 0.08]];
  w.bones.slice(1).forEach((k, i) => {
    const node = B(k), parent = node.getParentNode();
    setRot(node, (t) => qmul(deltaOf(parent, t), qmul(Rx(-s * share[i][0] * flap(t)), Ry(s * share[i][1] * fold(t) * AMP))));
  });
  // the second branch of the forearm (Bone_053 / 058) carries outer feathers like the hand does: it takes the hand's share, so the
  // pieces that span both branches are not sheared by the fold
  const side = w.side === -1 ? 53 : 58, node2 = B(side), par2 = node2.getParentNode();
  setRot(node2, (t) => qmul(deltaOf(par2, t), qmul(Rx(-s * share[2][0] * flap(t)), Ry(s * share[2][1] * fold(t) * AMP))));
}

// ── every feather chain: follows its parent, plus its own wave (lag grows toward the tip and with the feather's index) ──
const feathers = new Map();               // "region_si" -> [joint nodes by index]
for (const n of order) { const m = /^F_(\w+?)_(\d+)_(\d+)$/.exec(n.getName()); if (m) { const key = m[1] + '_' + m[2]; if (!feathers.has(key)) feathers.set(key, []); feathers.get(key)[+m[3]] = n; } }
for (const [key, chain] of feathers) {
  const region = key.split('_')[0], k = +key.split('_')[1];
  const side = region === 'wingA' ? -1 : region === 'wingB' ? 1 : 0;
  const f1 = [1, 1, 2, 2, 3][Math.floor(hash(k, 1) * 5)], f2 = [1, 2, 2, 3][Math.floor(hash(k, 2) * 4)];
  const ph1 = hash(k, 3) * TAU, ph2 = hash(k, 4) * TAU, lagBeat = hash(k, 5) * 0.35;
  const A = (0.05 + 0.05 * hash(k, 7)) * (region.startsWith('wing') ? 1.0 : 1.4);
  const K = chain.length;
  chain.forEach((node, i) => {
    const parent = node.getParentNode(), g = 0.35 + 0.65 * (i / Math.max(1, K - 1)), lag = 0.5 * i;
    const wave = (t, f, p) => Math.sin(TAU * f * (t / LOOP) + p - lag);
    setRot(node, (t) => {
      const base = deltaOf(parent, t);
      if (side !== 0) {               // wing feathers: the beat's wake (trailing the stroke) + a flutter of their own
        const trail = Math.sin(TAU * (t / PERIOD - lagBeat) - 0.45 * i);
        return qmul(base, qmul(Rx(-side * A * g * 0.9 * trail), Ry(A * g * 0.6 * (0.6 * wave(t, f1, ph1) + 0.4 * wave(t, f2, ph2)))));
      }
      return qmul(base, qmul(Ry(A * g * (0.6 * wave(t, f1, ph1) + 0.4 * wave(t, f2, ph2))), Rz(A * g * 0.8 * Math.sin(TAU * (t / PERIOD - lagBeat) - 0.4 * i))));
    });
  });
}

// ── tail bones, crest, back feathers, body ──
[14, 20, 26].forEach((first, c) => {
  let b = B(first);
  for (let i = 0; b; i++) {
    const node = b, idx = i;
    setRot(node, (t) => qmul(deltaOf(node.getParentNode(), t), qmul(Ry(0.045 * S(t, 2, 0.5 + 0.09 * idx + 0.12 * c)), Rz(0.03 * S(t, 2, 0.35 + 0.1 * idx)))));
    b = b.listChildren().find((x) => x.getName().startsWith('Bone_'));
  }
});
[42, 41, 40].forEach((k, i) => { const node = B(k); setRot(node, (t) => qmul(deltaOf(node.getParentNode(), t), Rz(0.12 * S(t, 2, 0.18 * i)))); });
// back feathers sit over the wing roots and Meshy mixed their weights with the wing bones: they follow their wing's shoulder
// (rotation AND position about the shoulder pivot, scaled by KAPPA) so the mixed vertices do not shear when the wing beats
const KAPPA = 0.6;
const slerpID = (q, k) => { const a = Math.acos(Math.min(1, Math.max(-1, q[3]))), s0 = Math.sin(a); if (a < 1e-5) return ID; return qaxis([q[0] / s0, q[1] / s0, q[2] / s0], 2 * a * k); };
[[45, 44, 43, 39], [48, 47, 46, 36]].forEach(([r0, r1, r2, sh]) => {
  const shoulder = B(sh), sp = rest.get(shoulder).wpos;
  const part = (t) => slerpID(spec.get(shoulder).rot(t), KAPPA);
  [r0, r1, r2].forEach((k, i) => {
    const node = B(k);
    setRot(node, (t) => qmul(part(t), Rz(0.04 * S(t, 2, 0.2 + 0.12 * i))));
  });
  const root0 = B(r0), p0 = rest.get(root0).wpos;
  setPos(root0, (t) => { const q = part(t), v = qrot(q, [p0[0] - sp[0], p0[1] - sp[1], p0[2] - sp[2]]); return [sp[0] + v[0] - p0[0], sp[1] + v[1] - p0[1], sp[2] + v[2] - p0[2]]; });
});
const rootB = B(0);
setPos(rootB, (t) => [0, 0.05 * Math.cos(TAU * ph(t) + Math.PI), 0]);

// ── evaluate: forward kinematics frame by frame ──
const times = new Float32Array(N + 1); for (let i = 0; i <= N; i++) times[i] = i / FPS;
const rotOut = new Map(), posOut = new Map(), prevQ = new Map();
for (let f = 0; f <= N; f++) {
  const t = f === N ? 0 : times[f];
  const world = new Map();
  for (const node of order) {
    const r = rest.get(node), parent = node.getParentNode(), pw = parent && world.get(parent) ? world.get(parent) : { rot: ID, pos: [0, 0, 0] };
    const sp = spec.get(node);
    let lrot = r.lrot, lpos = r.lpos;
    if (sp?.rot) lrot = qnorm(qmul(qinv(pw.rot), qmul(sp.rot(t), r.wrot)));
    if (sp?.pos) { const d = sp.pos(t), want = [r.wpos[0] + d[0], r.wpos[1] + d[1], r.wpos[2] + d[2]]; lpos = qrot(qinv(pw.rot), [want[0] - pw.pos[0], want[1] - pw.pos[1], want[2] - pw.pos[2]]); }
    const wrot = qnorm(qmul(pw.rot, lrot)), off = qrot(pw.rot, lpos);
    world.set(node, { rot: wrot, pos: [pw.pos[0] + off[0], pw.pos[1] + off[1], pw.pos[2] + off[2]] });
    if (sp?.rot) {
      let q = lrot; const prev = prevQ.get(node);
      if (prev && prev[0]*q[0] + prev[1]*q[1] + prev[2]*q[2] + prev[3]*q[3] < 0) q = q.map((x) => -x);
      prevQ.set(node, q);
      if (!rotOut.has(node)) rotOut.set(node, new Float32Array((N + 1) * 4));
      rotOut.get(node).set(q, f * 4);
    }
    if (sp?.pos) { if (!posOut.has(node)) posOut.set(node, new Float32Array((N + 1) * 3)); posOut.get(node).set(lpos, f * 3); }
  }
}
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
console.log(`wrote ${output}: Hover ${LOOP}s, ${rotOut.size} rotating joints (${feathers.size} feather chains), ${posOut.size} translating`);

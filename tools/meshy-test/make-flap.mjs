// Adds a procedural "Flap" animation (wings beating, body bob, tail wave) to the Meshy auto-rig test, so it can be played in any
// glTF viewer.   node tools/meshy-test/make-flap.mjs [in.glb] [out.glb]
// The Meshy skeleton has no semantic names (Bone_000...), so the roles come from the hierarchy / rest positions:
//   wings    Bone_036 chain (z<0) and Bone_039 chain (z>0), each with three feather branches
//   back     Bone_045 / Bone_048 chains      head crest  Bone_042 chain      tails  Bone_014 / Bone_020 / Bone_026 chains
//   legs     Bone_006 / Bone_013 chains      root        Bone_000
import { NodeIO } from '@gltf-transform/core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '../..');
const [, , inArg, outArg] = process.argv;
const RIG = path.join(REPO, 'model/meshy-test/Meshy_rig.glb');          // from rig-tail.mjs (one bone chain per tail strip)
const input = inArg ?? (fs.existsSync(RIG) ? RIG : path.join(REPO, 'model/fenix/Fenix-RIG.glb'));
const output = outArg ?? path.join(REPO, 'model/meshy-test/Meshy_flap.glb');

// ── tiny quaternion maths ([x,y,z,w]) ──
const qmul = (a, b) => [a[3]*b[0] + a[0]*b[3] + a[1]*b[2] - a[2]*b[1], a[3]*b[1] - a[0]*b[2] + a[1]*b[3] + a[2]*b[0], a[3]*b[2] + a[0]*b[1] - a[1]*b[0] + a[2]*b[3], a[3]*b[3] - a[0]*b[0] - a[1]*b[1] - a[2]*b[2]];
const qinv = (q) => [-q[0], -q[1], -q[2], q[3]];
const qaxis = (ax, ang) => { const s = Math.sin(ang / 2), l = Math.hypot(...ax) || 1; return [ax[0]/l*s, ax[1]/l*s, ax[2]/l*s, Math.cos(ang / 2)]; };
const qrot = (q, v) => { const r = qmul(qmul(q, [v[0], v[1], v[2], 0]), qinv(q)); return [r[0], r[1], r[2]]; };
const qnorm = (q) => { const l = Math.hypot(...q); return q.map((x) => x / l); };
const matQuat = (m) => { // column-major 4x4, no scale assumed
  const t = m[0] + m[5] + m[10]; let x, y, z, w;
  if (t > 0) { const s = Math.sqrt(t + 1) * 2; w = s / 4; x = (m[6] - m[9]) / s; y = (m[8] - m[2]) / s; z = (m[1] - m[4]) / s; }
  else if (m[0] > m[5] && m[0] > m[10]) { const s = Math.sqrt(1 + m[0] - m[5] - m[10]) * 2; w = (m[6] - m[9]) / s; x = s / 4; y = (m[4] + m[1]) / s; z = (m[8] + m[2]) / s; }
  else if (m[5] > m[10]) { const s = Math.sqrt(1 + m[5] - m[0] - m[10]) * 2; w = (m[8] - m[2]) / s; x = (m[4] + m[1]) / s; y = s / 4; z = (m[9] + m[6]) / s; }
  else { const s = Math.sqrt(1 + m[10] - m[0] - m[5]) * 2; w = (m[1] - m[4]) / s; x = (m[8] + m[2]) / s; y = (m[9] + m[6]) / s; z = s / 4; }
  return qnorm([x, y, z, w]);
};

const io = new NodeIO();
const doc = await io.read(input);
const root = doc.getRoot();
const byName = new Map(); root.listNodes().forEach((n) => byName.set(n.getName(), n));
const bone = (n) => byName.get('Bone_' + String(n).padStart(3, '0'));
const isBone = (n) => n.getName().startsWith('Bone_');
const chainOf = (n) => { const out = []; let b = bone(n); while (b) { out.push(b); b = b.listChildren().find(isBone); } return out; };
const worldQ = (n) => matQuat(n.getWorldMatrix());

// ── motion definition ──
// the wings / body repeat every PERIOD; the loop is two beats long so the tail strips can use slower rhythms (0.5x, 1x, 1.5x...)
const PERIOD = 1.25, LOOP = 2 * PERIOD, FPS = 30, N = Math.round(LOOP * FPS);
const TAU = Math.PI * 2;
// phase 0 = wings at the top, downstroke 0 -> 0.5. lift in [0,1]: 1 = up, 0 = bottom of the stroke.
const lift = (p) => 0.5 + 0.5 * Math.cos(TAU * p) + 0.04 * Math.sin(2 * TAU * p + 0.6);
const FLAP_AMP = +(process.env.FLAP_AMP ?? 1);   // stress tests: 2 = double stroke
const AXIS = [1, 0, 0];                        // the body runs along x: a wing beats about the world x axis
const tracks = [];
function addRot(node, axisWorld, angleFn) {
  const q0 = node.getRotation(), parent = node.getParentNode();
  const P = parent && isBone(parent) ? worldQ(parent) : (parent ? worldQ(parent) : [0, 0, 0, 1]);
  const axisLocal = qrot(qinv(P), axisWorld);   // the world axis as seen from the parent's rest frame
  tracks.push({ node, rot: (t) => qnorm(qmul(qaxis(axisLocal, angleFn(t)), q0)) });
}
const sideOf = (n) => (n.getWorldTranslation()[2] >= 0 ? 1 : -1);   // +1: the wing is at +z

// wings: shoulder -> mid -> tip share the stroke; the outer bones lag (the wave travels out)
for (const first of [36, 39]) {
  const wing = chainOf(first), s = sideOf(wing[0]);       // raising a wing at +z = rotating by -angle about x
  const amp = [0.50, 0.32, 0.22, 0.18, 0.14], lag = [0, 0.05, 0.10, 0.15, 0.20];
  wing.forEach((b, i) => {
    const k = Math.min(i, 4);
    addRot(b, AXIS, (t) => -s * 1.7 * FLAP_AMP * amp[k] * (lift(t / PERIOD - lag[k]) - 0.85));
  });
  // feather branches hang off the wing bones: a soft follow-through of their own
  const branches = [];
  const collect = (n) => n.listChildren().forEach((c) => { if (isBone(c)) { branches.push(c); collect(c); } });
  collect(wing[0]);
  const spine = new Set(wing);
  branches.filter((b) => !spine.has(b)).forEach((b, i) => addRot(b, AXIS, (t) => -s * 0.12 * Math.sin(TAU * (t / PERIOD - 0.25 - 0.04 * i))));
}
// back feathers / crest: follow-through
for (const first of [45, 48, 42]) chainOf(first).forEach((b, i) => addRot(b, [0, 0, 1], (t) => 0.10 * Math.sin(TAU * (t / PERIOD - 0.2 - 0.06 * i))));
// tails: a travelling wave, side to side and up/down
[14, 20, 26].forEach((first, k) => chainOf(first).forEach((b, i) => {
  addRot(b, [0, 1, 0], (t) => 0.10 * Math.sin(TAU * (t / PERIOD - 0.5 - 0.09 * i - 0.12 * k)));
  addRot(b, [0, 0, 1], (t) => 0.07 * Math.sin(TAU * (t / PERIOD - 0.35 - 0.10 * i - 0.08 * k)));
}));
// tail strips (rig-tail.mjs): every strip is its own chain and gets its own rhythm, so they never move in lockstep.
//  - the rhythm is a mix of two sines whose frequencies are whole numbers of cycles per LOOP (the clip loops cleanly);
//  - a wave travels down the strip (phase lag per joint), the amplitude grows toward the tip;
//  - the strips also lag the body bob (the tail drags behind the beat), each by a different amount.
{
  const hash = (k, s) => { const x = Math.sin(k * 127.1 + s * 311.7) * 43758.5453; return x - Math.floor(x); };
  const strips = new Map();
  for (const n of root.listNodes()) { const m = /^Strip_(\d+)_(\d+)$/.exec(n.getName()); if (m) { if (!strips.has(+m[1])) strips.set(+m[1], []); strips.get(+m[1])[+m[2]] = n; } }
  const cyc = [1, 1, 2, 2, 3];                                         // cycles per LOOP (2.5 s): 0.4, 0.8, 1.2 Hz
  for (const [k, chain] of strips) {
    const f1 = cyc[Math.floor(hash(k, 1) * cyc.length)], f2 = cyc[Math.floor(hash(k, 2) * cyc.length)];
    const ph1 = hash(k, 3) * TAU, ph2 = hash(k, 4) * TAU, lagBeat = hash(k, 5) * 0.5;
    const mixY = 0.4 + 0.6 * hash(k, 6), mixZ = 1 - 0.5 * mixY;       // side-to-side vs up/down
    const A = (0.06 + 0.05 * hash(k, 7)) * +(process.env.STRIP_AMP ?? 1);                                // rad per joint at the tip
    const K = chain.length;
    chain.forEach((b, i) => {
      const g = 0.35 + 0.65 * (i / (K - 1));                           // grows toward the tip
      const lag = 0.55 * i;                                            // travelling wave (radians per joint)
      const wave = (t, f, ph) => Math.sin(TAU * f * (t / LOOP) + ph - lag);
      addRot(b, [0, 1, 0], (t) => A * g * mixY * (0.6 * wave(t, f1, ph1) + 0.4 * wave(t, f2, ph2)));
      addRot(b, [0, 0, 1], (t) => A * g * mixZ * (0.5 * wave(t, f2, ph2 + 1.3) + 0.5 * Math.sin(TAU * (t / PERIOD - lagBeat) - 0.4 * i)));
    });
  }
  console.log(`tail strips animated: ${strips.size}`);
}
// body: bobs with the stroke (rises on the downstroke), a little pitch
const rootB = bone(0), r0 = rootB.getTranslation();
const posTrack = { node: rootB, pos: (t) => [r0[0], r0[1] + 0.05 * Math.cos(TAU * (t / PERIOD - 0.05) + Math.PI), r0[2]] };
addRot(rootB, [0, 0, 1], (t) => 0.05 * Math.sin(TAU * (t / PERIOD)));
// legs: dangle, lag the body
for (const first of [6, 13]) chainOf(first).forEach((b, i) => addRot(b, [0, 0, 1], (t) => 0.06 * Math.sin(TAU * (t / PERIOD - 0.15 - 0.05 * i))));

// ── write the animation (several rotation contributions on one node are composed as deltas from the rest rotation) ──
const buffer = root.listBuffers()[0];
const times = new Float32Array(N + 1); for (let i = 0; i <= N; i++) times[i] = i / FPS;
const timeAcc = doc.createAccessor('times').setType('SCALAR').setArray(times).setBuffer(buffer);
const anim = doc.createAnimation('Flap');
const rotByNode = new Map();
for (const tr of tracks) { if (!rotByNode.has(tr.node)) rotByNode.set(tr.node, []); rotByNode.get(tr.node).push(tr); }
const addChannel = (node, path, acc) => {
  const sampler = doc.createAnimationSampler().setInput(timeAcc).setOutput(acc).setInterpolation('LINEAR');
  anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(sampler));
};
for (const [node, list] of rotByNode) {
  const q0 = node.getRotation(), out = new Float32Array((N + 1) * 4);
  for (let i = 0; i <= N; i++) {
    const t = i === N ? 0 : times[i];                                      // last key = first key: a clean loop
    let q = q0;
    for (const tr of list) { const d = qmul(tr.rot(t), qinv(q0)); q = qmul(d, q); }
    out.set(qnorm(q), i * 4);
  }
  addChannel(node, 'rotation', doc.createAccessor('q_' + node.getName()).setType('VEC4').setArray(out).setBuffer(buffer));
}
{
  const out = new Float32Array((N + 1) * 3);
  for (let i = 0; i <= N; i++) out.set(posTrack.pos(i === N ? 0 : times[i]), i * 3);
  addChannel(rootB, 'translation', doc.createAccessor('p_root').setType('VEC3').setArray(out).setBuffer(buffer));
}
await io.write(output, doc);
console.log(`wrote ${output}: Flap ${LOOP}s loop, ${rotByNode.size} rotating bones + root translation`);

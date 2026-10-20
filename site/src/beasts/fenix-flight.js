// Pose controller of the Meshy phoenix (694 bones: Bone_NNN + one chain F_<region>_<n>_<i> per feather).
// A pure function of a parameter set:  pose(P)  ->  every bone's rotation.  No state, no integration, no springs: the same P gives
// the same pose, so a scroll-driven timeline can run it forwards AND backwards.
//
//   P.t         s, continuous clock for the small flutters (the timeline gives it as a function of progress)
//   P.phase     wing-beat phase in cycles (the timeline integrates it, so it is continuous and monotone)
//   P.flap      0..1  beat amplitude                      P.open   0 = wings folded .. 1 = fully open
//   P.sweep     0..1  extra swept-back (dives, speed)     P.legs   -1 = reaching forward (landing) .. 0 hanging .. 1 tucked
//   P.tail      0..1  tail feathers spread               P.bank   rad, body roll (adds a little wing differential)
//   P.pitch     rad, body pitch (the head counter-rotates to stay level)
//   P.pitchRate, P.yawRate   rad per unit of timeline: the tail and the long feathers trail behind the turn
//   P.lookYaw, P.lookPitch   head
//   P.fly       0 = standing posture .. 1 = flight posture: the body lies horizontal, the neck stretches forward, the head is level
//   P.rate      Hz, how fast the wing phase is advancing right now (from the scroll speed): above ~2 Hz the stroke shrinks (a blur, not a frenzy)
//   P.load      -1..1  the flight's acceleration load (pull-up +, push-over -): wings flex, tail and legs trail, the neck lags
//   P.alert     0..1  how much the bird looks around (scanning); drops when she is diving at a target. Also scales the head's life
//   P.stretch   0..1  how far the neck and body are stretched out (glide, dive) -- the spine chain (Spine_00..) does all of it
//   P.sleep     0..1  asleep on a perch: the neck curls down, the chin rests on the chest, the gaze stops, the breathing deepens
//   P.wind      0..1  strength of the wind on the feathers; P.windX/Y/Z its direction in the MODEL frame (the bird faces -x).
//                     Gusts travel across the body downwind: every feather chain bends with the wind and flutters, tips most
//   P.shake     0..1  feathers ruffled and shaken out (waking up): a quick shiver of the body and the plumage; P.shakePh its phase
//               in cycles (from the timeline, like the wing beat: it plays as the scroll passes and holds when it stops)
//   P.hug       0..1  folded wings drawn in against the body (seen from the front the plain fold holds them out like arms)
//   P.legAdj    null | 10 numbers: per-leg extra rotation (rad, like CROUCH) of hip, knee, ankle, foot, toes, leg A then leg B: the
//               scene's foot placement (each foot reaches its own ground, the toes follow its slope)
//   P.ground    0..1  standing on something: the legs and the pelvis (which carries them) hold STILL, no sway; the life is above them
//   P.tailLift  rad   the tail raised (spread over its root chains): the scene uses it to keep the plumes off the ground
//   P.crouch    0..1  standing crouch: the legs flex with the feet kept flat where they stand, the body comes down (roosting)
//
// Every bone is posed in WORLD space: a rotation delta applied on top of its rest world rotation (so a wing beats about the BODY
// axis whatever the bones' own axes are), and its local rotation is derived from the posed parent.  A bone with no rule inherits
// its parent's delta (its rest local rotation is kept).  This is the same maths as tools/meshy-test/make-fenix-motion.mjs.
//
// Limbs are never rigid: every joint of a chain gets its own share of the movement and its own lag, and every feather chain
// follows its parent plus a wave of its own, delayed along the chain and with the feather's index.
import * as THREE from 'three';

const TAU = Math.PI * 2;

export const FLIGHT_DEFAULTS = {
  t: 0, phase: 0, flap: 1, open: 1, sweep: 0, legs: 0, tail: 0.5, bank: 0, pitch: 0, pitchRate: 0, yawRate: 0, lookYaw: 0, lookPitch: 0,
  fly: 0, stretch: 0.5, alert: 1, rate: 0, load: 0, sleep: 0, wind: 0, windX: 0, windY: 0, windZ: 1, shake: 0, shakePh: 0, hug: 0, crouch: 0, tailLift: 0, plumeLift: 0, ground: 0, legAdj: null,
};

// Poses of a fully folded wing (cl = 1). Angles are added on top of the open pose; they are what the lab's "fold" sliders edit.
export const FOLD = {
  down: 1.15,        // shoulder: the wing hangs down along the body (rad, about the body axis)
  sweep: 0.85,       // shoulder: swung back (about the vertical axis)
  arm: 0.12,         // arm / forearm / hand: a mild Z-fold (a big one pushes the wing tip up behind the back; found in the lab)
  forearm: -0.2,
  hand: 0.15,
  fan: 0.25,         // feathers close like a fan about their roots (rad per unit of position along the arm)
  fanBias: 0.0,
  tuckLegs: 1,
  rollA: 0.25, rollB: 0.42,  // radians: roll of each wing about its own axis (the sculpt's two wings are not mirror images; found in the lab)
  corrK: 1,
  wingFlex: 0.35,       // how much the wing bends along its length (arm/forearm/hand shares of the beat, wave, load): 0 = one rigid piece. 1 bent it
                        // 34 degrees at the elbow ("asa quebrada no meio", measured); 0.35 -> ~13 degrees, one wing that flexes
  featherFlex: 1,       // scale of the wing feathers' own wave / flutter
  shoulderBody: 0,      // how much the SHOULDER follows the body's rotation where it is attached (the arm joint gives it back, so the rest of the
                        // wing keeps its orientation): the root of the wing stays on the body (armpit) in the flight posture             // share of the symmetry correction applied at the shoulder (the rest at the arm): 1 = all at the shoulder
  backK: 0.7,
};

// ───────────── small quaternion kit on Float64Array scratch ([x, y, z, w]) ─────────────
const qmul = (o, a, b) => {
  const ax = a[0], ay = a[1], az = a[2], aw = a[3], bx = b[0], by = b[1], bz = b[2], bw = b[3];
  o[0] = aw * bx + ax * bw + ay * bz - az * by; o[1] = aw * by - ax * bz + ay * bw + az * bx;
  o[2] = aw * bz + ax * by - ay * bx + az * bw; o[3] = aw * bw - ax * bx - ay * by - az * bz; return o;
};
const qset = (o, x, y, z, w) => { o[0] = x; o[1] = y; o[2] = z; o[3] = w; return o; };
const qaxis = (o, ax, ay, az, ang) => { const s = Math.sin(ang / 2); o[0] = ax * s; o[1] = ay * s; o[2] = az * s; o[3] = Math.cos(ang / 2); return o; };
const qconj = (o, a) => { o[0] = -a[0]; o[1] = -a[1]; o[2] = -a[2]; o[3] = a[3]; return o; };
const qnorm = (o) => { const l = Math.hypot(o[0], o[1], o[2], o[3]) || 1; o[0] /= l; o[1] /= l; o[2] /= l; o[3] /= l; return o; };

const smoothstep = (x) => { x = x < 0 ? 0 : x > 1 ? 1 : x; return x * x * (3 - 2 * x); };
const hash = (k, s) => { const x = Math.sin(k * 127.1 + s * 311.7) * 43758.5453; return x - Math.floor(x); };
const lift = (ph) => 0.5 + 0.5 * Math.cos(TAU * ph) + 0.04 * Math.sin(2 * TAU * ph + 0.6);      // 1 top .. 0 bottom of the stroke
const foldBeat = (ph) => Math.max(0, -Math.sin(TAU * ph));                                         // outer wing flexes on the upstroke

// ── gaze: a living head. Everything is a pure function of time (saccades on a jittered grid, drifts, tremor) ──
const HEAD_W = [0.10, 0.22, 0.42, 0.72, 1.0];                  // share of the head's orientation carried by the last five spine segments (neck base .. head)
const G = new Float64Array(3);
export const HEAD_STAB = { v: 0.75 };      // how much of the body's pitch the head cancels (1 = looks at the horizon, 0 = follows the body)
const hash1 = (k, sd) => { const x = Math.sin(k * 12.9898 + sd * 78.233) * 43758.5453; return x - Math.floor(x); };
const sstep = (x) => { x = x < 0 ? 0 : x > 1 ? 1 : x; return x * x * (3 - 2 * x); };
/** target of the k-th fixation (rad): yaw, pitch */
const fix = (k) => [(hash1(k, 1) - 0.5) * 0.95, (hash1(k, 2) - 0.5) * 0.42];
/** the gaze direction at time t: fixations of 1.4 to 3.4 s joined by quick saccades (0.2 s, eased), plus slow drift and a tremor */
function gazeAt(t, out) {
  const T = 2.4, k0 = Math.floor(t / T);
  let k = k0, bk = k0 * T + 0.9 * hash1(k0, 3);
  if (bk > t) { k = k0 - 1; bk = k * T + 0.9 * hash1(k, 3); }
  const a = fix(k - 1), b = fix(k), s = sstep((t - bk) / 0.2);
  out[0] = a[0] + (b[0] - a[0]) * s + 0.05 * Math.sin(TAU * (0.37 * t) + 1.1) + 0.012 * Math.sin(TAU * 6.3 * t);
  out[1] = a[1] + (b[1] - a[1]) * s + 0.035 * Math.sin(TAU * (0.51 * t) + 0.4) + 0.008 * Math.sin(TAU * 7.7 * t + 2.0);
  out[2] = 0.06 * Math.sin(TAU * 0.29 * t + 0.7) + 0.35 * (b[0] - a[0]) * s * (1 - s) * 2;      // head roll: a slow tilt, and a quick tilt into every saccade
  return out;
}
/** the wing stroke shrinks smoothly when the scroll makes the beat faster than a bird could (> ~2 Hz): 1 up to 1.6 Hz, ~0.35 at 6 Hz */
const RATE_DAMP = (hz) => { const x = Math.max(0, hz - 1.6) / 1.2; return 1 / (1 + 0.55 * x * x); };
const clampT = (x, m) => (x < -m ? -m : x > m ? m : x);
const num = (name) => +name.replace(/\D/g, '');
// segment angles (degrees above the horizontal, forward) of the flight posture, chest to head; the stretch flattens the neck
export const HEAD_TARGET = { v: 121 };      // calibrated by measuring the BEAK tip: the tip sits ~26 degrees below the head bone's axis, so ~104 puts the beak ~10 degrees below the horizon
// The head joint's bone is VERTICAL at rest (the standing bird's neck and head), the beak is perpendicular to it: a head segment at ~85
// degrees keeps the beak pointing FORWARD (horizontal). The neck rises in between (an S), so the head sits high and looks ahead.
const FLIGHT_THETA = [-8, -6, -3, 0, 8, 18, 28, 38, 62, HEAD_TARGET.v - 4, HEAD_TARGET.v];
// asleep: extra pitch (degrees, + = the front goes down) of each spine segment, pelvis .. head. The neck is nearly VERTICAL at rest, so
// tilting it forward only moves the head forward: it folds in an S instead (the base leans back into the shoulders, the middle bends
// forward), and the head SINKS into the shoulders rather than bowing (the big crest is part of the head mesh: a head bowed past ~50
// degrees stands it straight up). Measured: the head joint drops 0.17 and sits just in front of the chest, tilted 40 degrees down
export const SLEEP_THETA = [0, 0, 0, 0, -60, -40, -10, 60, 85, 50, 40];
// breathing: share of the breath's pitch per segment (the chest rises and falls, the head barely)
const BREATH_W = [0.4, 1.0, 1.0, 0.8, 0.5, 0.3, 0.2, 0.1, 0.05, 0.03, 0.02];
/** breathing, -1..1: ~4.6 s a breath, the in-breath a little quicker than the out-breath */
export const breathAt = (t) => { const x = (((t / 4.6) % 1) + 1) % 1; return Math.sin(TAU * (x + 0.08 * Math.sin(TAU * x))); };
/** wind strength at time t for a point `s` model units downwind: a slow swell, travelling gusts, and every ~6.5 s a burst that rises
 *  in ~0.6 s and dies away. The field moves downwind (x = t - s * 0.6) so a gust crosses the bird from the windward side. */
export function gustAt(t, s) {
  const x = t - s * 0.6;
  let g = 0.55 + 0.18 * Math.sin(TAU * 0.13 * x + 0.7) + 0.11 * Math.sin(TAU * 0.31 * x + 2.1) + 0.06 * Math.sin(TAU * 0.73 * x + 0.3);
  const T = 6.5, k0 = Math.floor(x / T);
  for (let k = k0 - 1; k <= k0; k++) {
    const e = x - (k * T + hash1(k, 9) * 3.2);
    if (e > 0) { const q = e / 0.6; g += (0.3 + 0.45 * hash1(k, 11)) * q * Math.exp(1 - q); }
  }
  return g;
}
export const HUG = { down: 0.3, sweep: 0.0 };
// crouch: extra rotation (rad, + swings backwards) of hip, knee, ankle, foot, toes; solved so the toes keep their orientation
export const CROUCH = [0, 0, 0, 0, 0];     // the extra closure of a hugged wing (rad, at the shoulder)
const WING_A = [36, 35, 34, 50], WING_B = [39, 38, 37, 55];     // shoulder, arm, forearm, hand (A at z < 0, B at z > 0)
const LEGS = [[6, 5, 4, 3, 2], [13, 12, 11, 10, 9]];
const TAILS = [[19, 18, 17, 16, 15, 14], [25, 24, 23, 22, 21, 20], [31, 30, 29, 28, 27, 26]];
const BACK = [[48, 47, 46, 36], [45, 44, 43, 39]];             // back feathers and the wing whose shoulder they follow
const CREST = [42, 41, 40];

export function createFenixFlight(model, opts = {}) {
  const fold = { ...FOLD, ...(opts.fold ?? {}) };
  // ── collect the bones in hierarchy order (parents first) ──
  const bones = [], parent = [], byName = new Map();
  const visit = (o, p) => {
    if (o.isBone) { byName.set(o.name, bones.length); parent.push(p); bones.push(o); p = bones.length - 1; }
    for (const c of o.children) visit(c, p);
  };
  visit(model, -1);
  const n = bones.length;
  model.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(model.matrixWorld).invert();
  const m = new THREE.Matrix4(), p3 = new THREE.Vector3(), q4 = new THREE.Quaternion(), s3 = new THREE.Vector3();
  const restWQ = new Float64Array(n * 4), restWP = new Float64Array(n * 3), restLQ = new Float64Array(n * 4), restLP = new Float64Array(n * 3);
  const parentRestQ = new Float64Array(n * 4);        // for root-level bones: the rest rotation of their (non-bone) parent
  for (let i = 0; i < n; i++) {
    m.multiplyMatrices(inv, bones[i].matrixWorld).decompose(p3, q4, s3);
    restWQ.set([q4.x, q4.y, q4.z, q4.w], i * 4); restWP.set([p3.x, p3.y, p3.z], i * 3);
    restLQ.set([bones[i].quaternion.x, bones[i].quaternion.y, bones[i].quaternion.z, bones[i].quaternion.w], i * 4);
    restLP.set([bones[i].position.x, bones[i].position.y, bones[i].position.z], i * 3);
    if (parent[i] < 0) { m.multiplyMatrices(inv, bones[i].parent.matrixWorld).decompose(p3, q4, s3); parentRestQ.set([q4.x, q4.y, q4.z, q4.w], i * 4); }
  }
  const idxOf = (k) => byName.get('Bone_' + String(k).padStart(3, '0'));

  // ── roles ──
  const role = new Array(n).fill(null);
  const set = (k, r) => { const i = idxOf(k); if (i !== undefined) role[i] = r; };
  const wingSide = (shoulder) => (restWP[idxOf(shoulder) * 3 + 2] >= 0 ? 1 : -1);
  const wings = [WING_A, WING_B].map((chain) => ({ chain, side: wingSide(chain[0]), s: 0, bal: new Float64Array([0, 0, 0, 1]) }));
  // balance rotation: the sculpt's two wings are in different poses; bring both to the mean (see make-fenix-motion.mjs)
  {
    const axisOf = (w, leaves) => {
      const s = restWP.subarray(idxOf(w.chain[0]) * 3, idxOf(w.chain[0]) * 3 + 3), a = [0, 0, 0];
      for (const k of leaves) { const i = idxOf(k) * 3; for (let c = 0; c < 3; c++) a[c] += restWP[i + c] / leaves.length; }
      const d = [a[0] - s[0], a[1] - s[1], a[2] - s[2]], l = Math.hypot(...d); return d.map((x) => x / l);
    };
    const dA = axisOf(wings[0], [59, 61, 51]), dB = axisOf(wings[1], [63, 65, 56]);
    const tg = [dB[0] + dA[0], dB[1] + dA[1], dB[2] - dA[2]], l = Math.hypot(...tg), t = tg.map((x) => x / l);
    const arc = (a, b, o) => { const d = a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; qset(o, a[1]*b[2] - a[2]*b[1], a[2]*b[0] - a[0]*b[2], a[0]*b[1] - a[1]*b[0], 1 + d); return qnorm(o); };
    for (const w of wings) {
      const mine = w.side === wings[1].side ? dB : dA, target = w.side === wings[1].side ? t : [t[0], t[1], -t[2]];
      arc(mine, target, w.bal); w.axis = target;
    }
  }
  wings.forEach((w, wi) => {
    w.chain.forEach((k, j) => set(k, { kind: 'wing', wing: w, j, bi: idxOf(k) }));
    // the second branch of the forearm carries outer feathers like the hand does
    set(wi === 0 ? 53 : 58, { kind: 'wing', wing: w, j: 4 });
  });
  LEGS.forEach((chain, li) => chain.forEach((k, j) => set(k, { kind: 'leg', j, side: li === 0 ? 1 : -1, li })));
  TAILS.forEach((chain, c) => chain.forEach((k, j) => set(k, { kind: 'tail', j, c, len: chain.length })));
  CREST.forEach((k, j) => set(k, { kind: 'crest', j }));
  BACK.forEach(([a, b, c, sh], bi) => [a, b, c].forEach((k, j) => set(k, { kind: 'back', j, shoulder: sh, bi, shRole: null, bone: k })));
  set(0, { kind: 'root' });
  set(1, { kind: 'pelvis' });                              // Bone_001 carries the belly, the legs and the tail base: it must move too
  // the spine chain (rig-spine.mjs): pelvis -> chest -> neck -> head, K joints. Bone_008/007/033/032 are dead (no weights).
  const spine = [];
  for (let j = 0; byName.has('Spine_' + String(j).padStart(2, '0')); j++) spine.push(byName.get('Spine_' + String(j).padStart(2, '0')));
  const K = spine.length;
  const restTheta = new Float64Array(K);                 // rest direction of the segment j -> j+1, degrees above the horizontal, forward = -x
  for (let j = 0; j < K; j++) {
    const a = spine[Math.min(j, K - 2)], b = spine[Math.min(j + 1, K - 1)];
    restTheta[j] = (Math.atan2(restWP[b * 3 + 1] - restWP[a * 3 + 1], -(restWP[b * 3] - restWP[a * 3])) * 180) / Math.PI;
  }
  spine.forEach((bi, j) => { role[bi] = { kind: 'spine', j }; });
  /** where a bone sits along the spine: segment a..b and t between them (by the closest point of its REST position on the centre line) */
  const spineMix = (i) => {
    // the rotation of a joint steers the segment from it to its child, so the joint follows the spine at the MIDDLE of that segment
    const ch = bones[i].children.find((c) => c.isBone), ci = ch ? byName.get(ch.name) : i;
    const x = (restWP[i * 3] + restWP[ci * 3]) / 2, y = (restWP[i * 3 + 1] + restWP[ci * 3 + 1]) / 2, z = (restWP[i * 3 + 2] + restWP[ci * 3 + 2]) / 2; let best = Infinity, bj = 0, bt = 0;
    for (let j = 0; j < K - 1; j++) {
      const a = spine[j] * 3, b = spine[j + 1] * 3, dx = restWP[b] - restWP[a], dy = restWP[b + 1] - restWP[a + 1], dz = restWP[b + 2] - restWP[a + 2], l2 = dx * dx + dy * dy + dz * dz || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - restWP[a]) * dx + (y - restWP[a + 1]) * dy + (z - restWP[a + 2]) * dz) / l2));
      const d = (x - restWP[a] - dx * t) ** 2 + (y - restWP[a + 1] - dy * t) ** 2 + (z - restWP[a + 2] - dz * t) ** 2;
      if (d < best) { best = d; bj = j; bt = t; }
    }
    return { a: bj, b: bj + 1, t: bt };
  };

  // feather chains: F_<region>_<n>_<i>
  const feathers = new Map();
  bones.forEach((b, i) => {
    const mm = /^F_(\w+?)_(\d+)_(\d+)$/.exec(b.name); if (!mm) return;
    const key = mm[1] + '_' + mm[2];
    if (!feathers.has(key)) feathers.set(key, { region: mm[1], k: +mm[2], joints: [] });
    feathers.get(key).joints[+mm[3]] = i;
  });
  // position of every wing feather along its arm (0 at the shoulder .. 1 at the hand), to order the fan
  const armPos = (side) => { const c = wings.find((w) => w.side === side).chain; return [c[0], c[3]].map((k) => restWP.subarray(idxOf(k) * 3, idxOf(k) * 3 + 3)); };
  for (const f of feathers.values()) {
    const K = f.joints.length, k = f.k;
    f.f1 = [1, 1, 2, 2, 3][Math.floor(hash(k, 1) * 5)]; f.f2 = [1, 2, 2, 3][Math.floor(hash(k, 2) * 4)];
    f.p1 = hash(k, 3) * TAU; f.p2 = hash(k, 4) * TAU; f.lagBeat = hash(k, 5) * 0.35;
    f.A = (0.05 + 0.05 * hash(k, 7)) * (f.region.startsWith('wing') ? 1 : 1.4);
    f.K = K; f.side = f.region === 'wingA' ? wings[0].side : f.region === 'wingB' ? wings[1].side : 0;
    if (f.side) {
      const [sh, hd] = armPos(f.side), r = restWP.subarray(f.joints[0] * 3, f.joints[0] * 3 + 3);
      const ax = [hd[0] - sh[0], hd[1] - sh[1], hd[2] - sh[2]], L2 = ax[0]*ax[0] + ax[1]*ax[1] + ax[2]*ax[2];
      f.s = Math.max(0, Math.min(1, ((r[0] - sh[0]) * ax[0] + (r[1] - sh[1]) * ax[1] + (r[2] - sh[2]) * ax[2]) / L2));
    } else f.s = 0;
    if (f.side) {                                   // WING feathers overlap in layers: neighbours must move together or a hole opens between them (measured: up to 17 cm).
      // so their phase, frequency and beat lag are SMOOTH functions of where they sit on the wing (a wave travelling along it), not random
      f.f1 = 2; f.f2 = 1; f.p1 = TAU * 0.9 * f.s; f.p2 = TAU * 0.5 * f.s + 1.0; f.lagBeat = 0.22 * f.s;
      f.A = (0.045 + 0.02 * f.s);
    }
    f.joints.forEach((i, j) => { if (i !== undefined) role[i] = { kind: 'feather', f, j, bi: i }; });
  }
  // rest direction (root -> last joint) and root position of every chain, for the wind
  const chainDir = (joints) => {
    const a = joints[0], b = joints[joints.length - 1] ?? a, ch = bones[b].children.find((c) => c.isBone), e = ch ? byName.get(ch.name) : b;
    const d = [restWP[e * 3] - restWP[a * 3], restWP[e * 3 + 1] - restWP[a * 3 + 1], restWP[e * 3 + 2] - restWP[a * 3 + 2]], l = Math.hypot(...d) || 1;
    return { d: d.map((x) => x / l), p: [restWP[a * 3], restWP[a * 3 + 1], restWP[a * 3 + 2]] };
  };
  for (const f of feathers.values()) Object.assign(f, chainDir(f.joints.filter((i) => i !== undefined)));
  for (const chain of [...TAILS, CREST]) { const js = chain.map(idxOf).filter((i) => i !== undefined); const cd = chainDir(js); for (const i of js) if (role[i]) Object.assign(role[i], { wd: cd.d, wp: cd.p }); }
  // tail feather chains spread about their roots by their lateral position
  let zMin = Infinity, zMax = -Infinity;
  for (const f of feathers.values()) if (f.region === 'tail') { const z = restWP[f.joints[0] * 3 + 2]; zMin = Math.min(zMin, z); zMax = Math.max(zMax, z); }
  for (const f of feathers.values()) if (f.region === 'tail') f.lat = zMax > zMin ? (restWP[f.joints[0] * 3 + 2] - (zMin + zMax) / 2) / ((zMax - zMin) / 2) : 0;

  // ── per-frame state (scratch) ──
  const wq = new Float64Array(n * 4), dq = new Float64Array(n * 4);
  const A = new Float64Array(4), B = new Float64Array(4), C = new Float64Array(4), D = new Float64Array(4), E = new Float64Array(4), ID = new Float64Array([0, 0, 0, 1]);
  const lq = new Float64Array(4), pinv = new Float64Array(4), tmp = new Float64Array(4), tmp3 = new Float64Array(4);
  const ld3 = (i) => qset(tmp3, dq[i * 4], dq[i * 4 + 1], dq[i * 4 + 2], dq[i * 4 + 3]);
  const rx = (o, a) => qaxis(o, 1, 0, 0, a), ry = (o, a) => qaxis(o, 0, 1, 0, a), rz = (o, a) => qaxis(o, 0, 0, 1, a);
  const rootBone = bones[idxOf(0)];
  const rootRest = [restLP[idxOf(0) * 3], restLP[idxOf(0) * 3 + 1], restLP[idxOf(0) * 3 + 2]];

  /** wind on a chain joint, into o: bends the chain toward the wind (in the bone's REST frame: the wind is brought back through the
   *  parent's delta) and makes it flutter. d / p: the chain's rest direction and root position; amp: total bend (rad) at gust 1,
   *  shared over the chain; flut: flutter amplitude; fq: flutter frequency (Hz); j / K: joint and chain length; ph: phase */
  const WV = [0, 0, 0], WQ = new Float64Array(4), WQ2 = new Float64Array(4);
  function windQ(o, d, p, base, P, amp, flut, fq, j, K, ph) {
    if (!(P.wind > 0)) return qset(o, 0, 0, 0, 1);
    // conj(base) * w * base: the wind in the frame where this joint's delta is applied
    const bx = -base[0], by = -base[1], bz = -base[2], bw = base[3], vx = P.windX, vy = P.windY, vz = P.windZ;
    const tx = 2 * (by * vz - bz * vy), ty = 2 * (bz * vx - bx * vz), tz = 2 * (bx * vy - by * vx);
    WV[0] = vx + bw * tx + (by * tz - bz * ty); WV[1] = vy + bw * ty + (bz * tx - bx * tz); WV[2] = vz + bw * tz + (bx * ty - by * tx);
    const g = gustAt(P.t, p[0] * vx + p[1] * vy + p[2] * vz) * P.wind;
    let ax = d[1] * WV[2] - d[2] * WV[1], ay = d[2] * WV[0] - d[0] * WV[2], az = d[0] * WV[1] - d[1] * WV[0];
    const len = Math.hypot(ax, ay, az);
    if (len < 1e-4) return qset(o, 0, 0, 0, 1);
    ax /= len; ay /= len; az /= len;
    const u = K > 1 ? j / (K - 1) : 1, tipW = (0.35 + 0.65 * u) * 2 / (K + 1);           // shares: the outer joints flutter more
    const fl = flut * g * tipW * (0.6 * Math.sin(TAU * fq * P.t + ph - 0.55 * j) + 0.4 * Math.sin(TAU * fq * 1.73 * P.t + 1.3 * ph - 0.8 * j));
    qaxis(WQ, ax, ay, az, amp * g * Math.min(1, len * 1.5) / K + fl);                     // bend in the wind's plane (+ its flutter)
    // a sideways flutter, out of that plane (about d x axis), smaller
    const sx = d[1] * az - d[2] * ay, sy = d[2] * ax - d[0] * az, sz = d[0] * ay - d[1] * ax;
    qaxis(WQ2, sx, sy, sz, 0.5 * flut * g * tipW * Math.sin(TAU * fq * 1.31 * P.t + 2.1 * ph - 0.6 * j));
    return qmul(o, WQ, WQ2);
  }

  /** delta of the bone into `out`, given the parent's delta `base`; null role -> inherit */
  function deltaOf(r, base, P, out) {
    const ph = P.phase, t = P.t, fl = P.flap;
    const cl = smoothstep(1 - P.open);                              // closure 0..1
    const lf = lift(ph), raise = fl * 0.62 * (lf - 0.5) * 2 * (1 - 0.85 * cl);
    const fb = fl * foldBeat(ph) * (1 - 0.6 * cl);
    switch (r.kind) {
      case 'wing': {
        const w = r.wing, s = w.side, j = r.j;
        const bankDiff = P.bank * 0.35 * s;                           // the inner wing drops a little, the outer one rises
        if (j === 0) {                                                // shoulder: balance, sweep back, lower (closing), beat
          ry(A, s * (0.14 * fb + P.sweep * 0.55 * (1 - cl) + fold.sweep * cl));
          rx(B, -s * (raise - bankDiff * (1 - cl)) + s * (fold.down + HUG.down * P.hug) * cl);
          if (P.hug > 0) { ry(D, s * HUG.sweep * P.hug * cl); qmul(E, D, A); qset(A, E[0], E[1], E[2], E[3]); }
          // The wing's own motion is ABSOLUTE (the sculpt's wing is already spread for flight; the chest turns ~80 degrees into the flight posture
          // and the wing must not, it would stand up). Only the SHOULDER bone follows the body (shoulderBody), and the arm gives it back.
          wingCorr(w, E, fold.corrK); qmul(C, A, E); qmul(w.Wsh ?? (w.Wsh = new Float64Array(4)), B, C);    // the wing's own motion at the shoulder
          if (fold.shoulderBody <= 0) return qset(out, w.Wsh[0], w.Wsh[1], w.Wsh[2], w.Wsh[3]);
          slerpId(D, spineAt(r.bi, r, E), fold.shoulderBody);                    // the body's rotation at the shoulder (share)
          return qmul(out, D, w.Wsh);
        }
        // arm, forearm, hand, second branch: each adds its share of the beat, the sweep and (closing) the Z-fold
        const share = [[0, 0], [0.10, 0.18], [0.16, 0.30], [0.18, 0.32], [0.18, 0.32]][j];
        const zf = [0, fold.arm, fold.forearm, fold.hand, fold.hand][j];
        const wave = Math.sin(TAU * (ph - 0.04 * j)) * 0.04 * fl * (1 - cl);
        const ld = P.load * (0.5 + 0.5 * (1 - cl));                    // the wing carries the load: the tips bend up in a pull-up, float in a push-over
        const wf = fold.wingFlex;
        rx(A, (-s * share[0] * raise + wave - s * ld * [0, 0.10, 0.18, 0.26, 0.26][j]) * wf); ry(B, s * (share[1] * fb * wf + zf * cl + 0.12 * P.sweep * (1 - cl)));
        qmul(C, A, B);
        if (j === 1) {                                                   // the arm gives the body's share back: the outer wing keeps the wing's own orientation
          const b1 = fold.shoulderBody > 0 ? w.Wsh : base;
          if (fold.corrK < 1) { wingCorrRest(w, E); qmul(D, E, C); return qmul(out, b1, D); }
          return qmul(out, b1, C);
        }
        return qmul(out, base, C);
      }
      case 'feather': {
        const f = r.f, j = r.j, g = 0.35 + 0.65 * (j / Math.max(1, f.K - 1)), lag = 0.5 * j;
        // in the airflow (a glide or a dive: stretched out, wings not beating) the feather tips flutter harder and faster
        const air = P.stretch * P.fly * (1 - 0.7 * P.flap), gA = 1 + 0.7 * air, gF = 1 + 0.3 * air;
        const flutter = gA * (0.6 * Math.sin(TAU * (f.f1 * gF * t / 2.5) + f.p1 - lag) + 0.4 * Math.sin(TAU * (f.f2 * gF * t / 2.5) + f.p2 - lag));
        if (f.side) {                                                 // wing feather: the wake of the beat, a flutter, the fan
          const s = f.side, open = 1 - cl;
          const trail = Math.sin(TAU * (ph - f.lagBeat) - 0.45 * j);
          const ck = Math.min(1, 3 / f.K) * fold.featherFlex;               // per joint: a 9-joint feather must not bend 3x more than a 3-joint one (it compounds)
          rx(A, -s * f.A * g * 0.9 * trail * fl * (0.4 + 0.6 * open) * ck);
          ry(B, f.A * g * 0.6 * flutter * (0.5 + 0.5 * open) * ck);
          qmul(C, A, B);
          if (P.wind > 0 || P.shake > 0) {                            // folded wing: the wind only stirs the outer feathers (the layers must stay closed)
            windQ(D, f.d, f.p, base, P, 0.10 * (0.3 + 0.7 * f.s), 0.05 * (0.4 + 0.6 * f.s), 3.1, j, f.K, f.p1);
            qmul(E, C, D); qset(C, E[0], E[1], E[2], E[3]);
            if (P.shake > 0) { rx(D, s * P.shake * 0.05 * g * Math.sin(TAU * P.shakePh + 0.8 * f.s)); qmul(E, C, D); qset(C, E[0], E[1], E[2], E[3]); }
          }
          if (j === 0) {                                              // the fan closes about the feather's ROOT
            ry(D, s * fold.fan * cl * (f.s - 0.35 + fold.fanBias)); qmul(E, C, D); return qmul(out, base, E);
          }
          return qmul(out, base, C);
        }
        // tail / back feather: lateral wave + vertical beat wake + trailing behind the turn; the tail spreads by its lateral index
        const spread = f.region === 'tail' ? (P.tail - 0.5) * 0.5 * (f.lat ?? 0) * (j === 0 ? 1 : 0.35) : 0;
        // the tail trails behind turns and pitch changes. The TOTAL bend of the chain is bounded (~10 degrees) and spread over its joints:
        // it used to be added at every joint and accumulated to 95 degrees along a 9-joint strip (measured), the tail stood up / hung down
        const spreadK = 1 / Math.max(1, f.K);
        const turn = f.region === 'tail' ? clampT(-P.yawRate * 0.30, 0.20) * spreadK * 2 * g : 0;
        const pit = f.region === 'tail' ? clampT(P.pitchRate * 0.30 + P.load * 0.08, 0.18) * spreadK * 2 * g : 0;
        const comb = f.region === 'crest' ? -(P.fly + 0.6 * P.sleep) * (j === 0 ? 0.55 : 0.18) : f.region === 'back' ? -P.fly * (j === 0 ? 0.35 : 0.1) : 0;         // the wind combs head and mane strands back
        const chainK = f.region === 'tail' ? Math.min(1, 4 / f.K) : 1;          // long strips: the same TOTAL wave as a short one
        const ruff = f.region === 'tail' ? 0 : -P.shake * (j === 0 ? 0.22 : 0.05) * (0.7 + 0.3 * Math.sin(TAU * 1.07 * P.shakePh + f.p1));   // shaken out: the plumage lifts
        ry(A, f.A * g * flutter * chainK + turn + spread);
        // Some long plumes attach directly to the spine, so raising only the original tail bones misses them.
        // Share the opening's terrain-clearance bend over each actual feather chain, keeping its root anchored.
        const clearanceLift = f.region === 'tail' ? P.plumeLift * spreadK : 0;
        rz(B, f.A * g * 0.8 * Math.sin(TAU * (ph - f.lagBeat) - 0.4 * j) * fl * chainK + pit + comb + ruff + clearanceLift);
        qmul(C, A, B);
        if (P.wind > 0) {
          // the long tail plumes stream and wave, the crest strands whip, the back feathers lift and settle
          const W = f.region === 'tail' ? [1.1, 0.34, 1.1] : f.region === 'crest' ? [1.2, 0.5, 2.4] : [0.28, 0.12, 2.2];
          windQ(D, f.d, f.p, base, P, W[0], W[1], W[2], j, f.K, f.p1); qmul(E, C, D); qset(C, E[0], E[1], E[2], E[3]);
        }
        if (f.region === 'back') return qmul(out, spineAt(r.bi, r, E), C);        // a back feather lies ON the back: each joint follows the spine where it sits
        return qmul(out, base, C);
      }
      case 'tail': {
        const idx = r.j;
        ry(A, 0.045 * Math.sin(TAU * (2 * t / 2.5 - 0.5 - 0.09 * idx - 0.12 * r.c)) / r.len * 2 + clampT(-P.yawRate * 0.18, 0.12) / r.len);
        rz(B, 0.03 * Math.sin(TAU * (2 * t / 2.5 - 0.35 - 0.1 * idx)) / r.len * 2 + clampT(P.pitchRate * 0.2 + P.load * 0.1, 0.12) / r.len
              + P.tailLift / r.len);                                   // lifted (rad over the chain): the scene keeps the tail out of the rock
        qmul(C, A, B);
        if (P.wind > 0 && r.wd) { windQ(D, r.wd, r.wp, base, P, 0.4, 0.1, 0.8, idx, r.len, r.c * 1.7); qmul(E, C, D); return qmul(out, base, E); }
        return qmul(out, base, C);
      }
      case 'pelvis': {
        // Bone_001 carries the belly, the legs and the tail base; Spine_00 carries the back right above it. They MUST move as one
        // piece (they used to follow two different rules and a gap of 4-14 cm opened between the back and the tail root): the pelvis
        // takes exactly the delta of Spine_00, which holds the pelvis's own motion (see 'spine', j = 0).
        return deltaOf(r.spine0 ?? (r.spine0 = role[byName.get('Spine_00')]), base, P, out);
      }
      case 'leg': {
        const L = P.legs, j = r.j, f = P.fly;
        // + about z swings a paw backwards (the bird faces -x). tucked: thigh back, shin folded under; landing: reaching forward
        const back = [0.35, 0.8, 1.15, 0.95, 0.55][j], fwd = [0.25, 0.45, 0.15, -0.15, -0.3][j];
        const a = L >= 0 ? L * back * fold.tuckLegs : L * fwd * 1.0;
        // life: the legs are never held. Each joint trails the wing beat a little more than the one above (a wave down the leg),
        // dangles in the airflow (pitch), splays and swings with the turn, and flexes slowly on its own
        const calm = (1 - Math.abs(L) * 0.5) * (1 - P.ground);          // planted: firm, no sway
        const wv = (0.10 + 0.05 * j) * Math.sin(TAU * (P.phase - 0.13 * (j + 1) - (r.li ? 0.08 : 0))) * P.flap * (0.4 + 0.6 * f);
        const sway = (0.07 * Math.sin(TAU * (0.4 * t - 0.15 * j + (r.li ? 0.1 : 0))) + 0.04 * Math.sin(TAU * (0.9 * t - 0.2 * j))) * calm - 0.18 * P.pitchRate * (j + 1) / 5;
        rz(A, a + sway + wv * (1 - P.ground) + clampT(P.load * 0.25, 0.2) / 5 + P.crouch * CROUCH[j] + (P.legAdj ? P.legAdj[r.li * 5 + j] : 0));
        ry(B, (0.05 + 0.03 * j) * Math.sin(TAU * (0.55 * t - 0.17 * j + (r.li ? 0.3 : 0))) * calm + (r.side) * (0.05 + 0.04 * j) * f * L - P.yawRate * 0.10 * (j + 1) / 5 * (r.side));
        rx(C, (r.side) * (0.02 + 0.015 * j) * Math.sin(TAU * (0.7 * t - 0.2 * j)) * (1 - P.ground));
        qmul(D, A, B); qmul(E, D, C); return qmul(out, base, E);
      }
      case 'crest': {
        rz(A, 0.12 * Math.sin(TAU * (2 * t / 2.5 - 0.18 * r.j)) * (1 - 0.6 * P.sleep) - 0.15 * P.pitchRate * (r.j + 1) - P.fly * (r.j === 0 ? 0.75 : 0.25)
              - P.sleep * (r.j === 0 ? 1.0 : 0.35));      // in flight the wind combs the crest back; asleep it lies back along the bowed head
        if (P.wind > 0 && r.wd) { windQ(D, r.wd, r.wp, base, P, 0.5, 0.2, 1.9, r.j, 3, 0.4); qmul(E, A, D); return qmul(out, base, E); }
        return qmul(out, base, A);
      }
      case 'back': {
        // the original Meshy back bones (roots of the feather groups): same idea, they follow the spine where they sit
        rz(A, 0.04 * Math.sin(TAU * (2 * t / 2.5 - 0.2 - 0.12 * r.j)));
        return qmul(out, spineAt(r.bone === undefined ? 0 : idxOf(r.bone), r, E), A);
      }
      case 'spine': {
        // each segment of the chain is posed to an ABSOLUTE direction: standing (rest) .. flight (horizontal body, stretched neck).
        // Rz(+) lowers the front (the bird faces -x), Ry(+) turns it to the left, Rx(+) rolls it right-wing-down.
        const j = r.j, f = P.fly, st = P.stretch, neckw = j >= 4 ? (j - 3) / (K - 4) : 0;
        const target = FLIGHT_THETA[Math.min(j, FLIGHT_THETA.length - 1)] + (j >= 4 ? st * 12 * neckw * (j >= K - 3 ? 0 : 1) : -st * 3);   // stretched: the neck reaches further forward, the body flattens
        const th = (restTheta[j] - target) * f;                                              // degrees
        // the head and the upper neck: a living head. hw = how much of the head's final orientation this segment carries (0 body .. 1 head)
        const hw = j >= K - 5 ? HEAD_W[j - (K - 5)] : 0;
        // the body wave (rises and falls with the stroke) is cancelled in the head: birds hold the head still against the flapping body
        // on the ground the PELVIS (j = 0, it carries the legs) holds still: its sway, breath and gusts would make planted feet dance
        const amb = j === 0 ? 1 - P.ground : 1;
        const wave = (2.6 + 1.6 * neckw) * Math.sin(TAU * (P.phase - 0.07 * j)) * P.flap * f * (1 - 0.88 * hw) + 0.9 * Math.sin(TAU * (t / 4.2) - 0.3 * j) * (1 - hw) * amb;
        gazeAt(t, G);
        const sl = P.sleep;
        const look = P.alert * (1 - 0.55 * st * f) * (1 - sl);                                // scanning calms down when she is stretched out on a dive; none asleep
        const yaw = hw * (G[0] * look + P.lookYaw) + (hw === 0 ? -P.bank * 0.28 * (j / K) * 0 : 0);
        const pit = hw * (G[1] * look + P.lookPitch) * 57.3 + hw * HEAD_STAB.v * P.pitch * 57.3;        // plus: the head stays level against the body's pitch
        const roll = hw * (-0.85 * P.bank + G[2] * look);                                      // and against its roll (the eyes keep the horizon)
        // the neck S: a slow drift of the neck curve, and a small lead of the head toward the next wing stroke
        const nk = j >= 4 ? -P.load * 6 * neckw * (1 - hw) + (1 - hw) * 0 + 0 : 0;
        const nk2 = j >= 4 ? 1.8 * Math.sin(TAU * (t / 3.7) - 0.9 * j) * (1 - hw * 0.5) + 1.1 * Math.sin(TAU * (P.phase + 0.18 * (j - 3))) * P.flap * f * hw : 0;
        // asleep: the curl of the neck; breathing (deeper asleep); the wind buffets the neck and head a little (sideways, with the gusts)
        const br = breathAt(t - 0.12 * j) * (1.1 + 1.6 * sl) * BREATH_W[j] * (1 - f) * amb;
        const gw = P.wind > 0 ? (gustAt(t - 0.25, 0) - 0.55) * P.wind * (1 - f) * (0.4 + 0.6 * neckw) * amb : 0;
        const shv = P.shake * Math.sin(TAU * P.shakePh - 0.6 * j) * (j < 6 ? 0.07 : 0.03) * (1 - f) * amb;
        rz(A, ((th + wave * (1 - 0.6 * sl) + pit + nk + nk2 * (1 - 0.8 * sl) + SLEEP_THETA[j] * sl + br) * Math.PI) / 180);
        ry(B, yaw - P.bank * 0.28 * (j / K) + (j < K - 5 ? 0.02 * Math.sin(TAU * (t / 6) - 0.5 * j) * amb : 0) + gw * 0.035 * P.windZ);
        rx(D, roll + gw * 0.03 * Math.sign(P.windZ || 1) + shv);
        if (j === 0) {                                                                       // the pelvis end: it also rides the wing beat a touch after the chest, leans into the turn, breathes
          rz(tmp3, ((3.4 + 1.6 * st) * Math.sin(TAU * (P.phase + 0.10)) * P.flap * f * Math.PI) / 180);
          qmul(E, tmp3, A); qset(A, E[0], E[1], E[2], E[3]);
          ry(E, 0.05 * Math.sin(TAU * (P.phase + 0.35)) * P.flap * f - P.yawRate * 0.12); qmul(tmp3, E, B); qset(B, tmp3[0], tmp3[1], tmp3[2], tmp3[3]);
          rx(D, -P.bank * 0.22 + 0.02 * Math.sin(TAU * (t / 5.3)) * amb);
        }
        qmul(C, B, A); qmul(E, C, D); return qset(out, E[0], E[1], E[2], E[3]);        // yaw (outer) * pitch * roll (inner): a turned head keeps its elevation
      }
      default: return qset(out, base[0], base[1], base[2], base[3]);
    }
  }

  // pose-wide cache: the spine segments' deltas (they depend on P only, never on a parent), read by everything that lies ALONG the back
  const spD = new Float64Array(K * 4), sm1 = new Float64Array(4);
  function spineAt(i, role_, out) {                                  // slerp of the spine deltas around the rest position of bone i
    const m = role_.mix ?? (role_.mix = spineMix(i)), a = m.a * 4, b = m.b * 4, t = m.t;
    let dot = spD[a] * spD[b] + spD[a + 1] * spD[b + 1] + spD[a + 2] * spD[b + 2] + spD[a + 3] * spD[b + 3], sg = dot < 0 ? -1 : 1;
    for (let c = 0; c < 4; c++) out[c] = spD[a + c] * (1 - t) + sg * spD[b + c] * t;
    return qnorm(out);
  }
  /** the wing's symmetry correction (balance toward the mean pose, then its own roll) into o */
  const corrFull = new Float64Array(4), corrPart = new Float64Array(4), corrInv = new Float64Array(4);
  function slerpId(o, q, k) { const a = 2 * Math.acos(Math.min(1, Math.abs(q[3]))), sg = q[3] < 0 ? -1 : 1, si = Math.sin(a / 2); if (a < 1e-6 || !si) return qset(o, 0, 0, 0, 1); return qaxis(o, (sg * q[0]) / si, (sg * q[1]) / si, (sg * q[2]) / si, a * k); }
  /** the wing's symmetry correction (balance toward the mean pose, then its own roll), k = the share of it (shoulder part) */
  function wingCorr(w, o, k = 1) { const roll = w.side === wings[1].side ? fold.rollB : fold.rollA; qaxis(tmp3, w.axis[0], w.axis[1], w.axis[2], roll); qmul(corrFull, tmp3, w.bal); return k >= 1 ? qset(o, corrFull[0], corrFull[1], corrFull[2], corrFull[3]) : slerpId(o, corrFull, k); }
  /** what is left of the correction after the shoulder's share: inv(part) * full */
  function wingCorrRest(w, o) { wingCorr(w, corrPart, fold.corrK); qconj(corrInv, corrPart); return qmul(o, corrFull, corrInv); }
  const baseTmp = new Float64Array(4), outQ = new Float64Array(4), pqA = new Float64Array(4), rwA = new Float64Array(4), rlA = new Float64Array(4);
  const ld = (o, arr, i) => { o[0] = arr[i * 4]; o[1] = arr[i * 4 + 1]; o[2] = arr[i * 4 + 2]; o[3] = arr[i * 4 + 3]; return o; };
  function pose(P) {
    P = { ...FLIGHT_DEFAULTS, ...P };
    P.flap *= RATE_DAMP(P.rate);                                  // the scroll made the beat faster than a bird could: the stroke shrinks
    for (let j = 0; j < K; j++) { deltaOf(role[spine[j]], ID, P, sm1); spD[j * 4] = sm1[0]; spD[j * 4 + 1] = sm1[1]; spD[j * 4 + 2] = sm1[2]; spD[j * 4 + 3] = sm1[3]; }
    for (let i = 0; i < n; i++) {
      const pi = parent[i], r = role[i];
      if (pi < 0) { ld(pqA, parentRestQ, i); qset(baseTmp, 0, 0, 0, 1); }            // root-level bone: its (non-bone) parent is fixed
      else { ld(pqA, wq, pi); ld(baseTmp, dq, pi); }                                  // the parent's world rotation and delta
      if (!r) {                                                                       // no rule: keep the rest local rotation, inherit the delta
        dq[i * 4] = baseTmp[0]; dq[i * 4 + 1] = baseTmp[1]; dq[i * 4 + 2] = baseTmp[2]; dq[i * 4 + 3] = baseTmp[3];
        ld(rlA, restLQ, i); qmul(lq, pqA, rlA); qnorm(lq); wq[i * 4] = lq[0]; wq[i * 4 + 1] = lq[1]; wq[i * 4 + 2] = lq[2]; wq[i * 4 + 3] = lq[3];
        continue;
      }
      deltaOf(r, baseTmp, P, outQ); qnorm(outQ);
      dq[i * 4] = outQ[0]; dq[i * 4 + 1] = outQ[1]; dq[i * 4 + 2] = outQ[2]; dq[i * 4 + 3] = outQ[3];
      // local = inv(parent world) * delta * rest world
      qconj(pinv, pqA); ld(rwA, restWQ, i); qmul(tmp, outQ, rwA); qmul(lq, pinv, tmp); qnorm(lq);
      const b = bones[i];
      b.quaternion.set(lq[0], lq[1], lq[2], lq[3]);
      qmul(tmp, pqA, lq); qnorm(tmp); wq[i * 4] = tmp[0]; wq[i * 4 + 1] = tmp[1]; wq[i * 4 + 2] = tmp[2]; wq[i * 4 + 3] = tmp[3];
      if (r.kind === 'root') {
        const bob = 0.05 * Math.cos(TAU * P.phase + Math.PI) * P.flap * smoothstep(P.open + 0.2);
        b.position.set(rootRest[0], rootRest[1] + bob, rootRest[2]);
      }
    }
  }
  /** back to the sculpted (bind) pose */
  function reset() {
    for (let i = 0; i < n; i++) { bones[i].quaternion.set(restLQ[i * 4], restLQ[i * 4 + 1], restLQ[i * 4 + 2], restLQ[i * 4 + 3]); bones[i].position.set(restLP[i * 3], restLP[i * 3 + 1], restLP[i * 3 + 2]); }
  }
  return { pose, reset, bones, byName, feathers, wings, fold, FOLD, SLEEP_THETA, HUG, CROUCH };
}

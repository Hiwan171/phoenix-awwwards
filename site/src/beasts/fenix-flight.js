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
//   P.stretch   0..1  how far the neck and body are stretched out (glide, dive) -- the spine chain (Spine_00..) does all of it
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
  fly: 0, stretch: 0.5,
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

const num = (name) => +name.replace(/\D/g, '');
// segment angles (degrees above the horizontal, forward) of the flight posture, chest to head; the stretch flattens the neck
const FLIGHT_THETA = [-8, -6, -3, 0, 10, 22, 30, 26, 20, 12, 10];
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
      arc(mine, target, w.bal);
    }
  }
  wings.forEach((w, wi) => {
    w.chain.forEach((k, j) => set(k, { kind: 'wing', wing: w, j }));
    // the second branch of the forearm carries outer feathers like the hand does
    set(wi === 0 ? 53 : 58, { kind: 'wing', wing: w, j: 4 });
  });
  LEGS.forEach((chain, li) => chain.forEach((k, j) => set(k, { kind: 'leg', j, side: li === 0 ? 1 : -1, li })));
  TAILS.forEach((chain, c) => chain.forEach((k, j) => set(k, { kind: 'tail', j, c, len: chain.length })));
  CREST.forEach((k, j) => set(k, { kind: 'crest', j }));
  BACK.forEach(([a, b, c, sh], bi) => [a, b, c].forEach((k, j) => set(k, { kind: 'back', j, shoulder: sh, bi, shRole: null })));
  set(0, { kind: 'root' });
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
    f.joints.forEach((i, j) => { if (i !== undefined) role[i] = { kind: 'feather', f, j }; });
  }
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
          rx(B, -s * (raise - bankDiff * (1 - cl)) + s * fold.down * cl);
          qmul(C, A, w.bal); return qmul(out, B, C);
        }
        // arm, forearm, hand, second branch: each adds its share of the beat, the sweep and (closing) the Z-fold
        const share = [[0, 0], [0.10, 0.18], [0.16, 0.30], [0.18, 0.32], [0.18, 0.32]][j];
        const zf = [0, fold.arm, fold.forearm, fold.hand, fold.hand][j];
        const wave = Math.sin(TAU * (ph - 0.04 * j)) * 0.04 * fl * (1 - cl);
        rx(A, -s * share[0] * raise + wave); ry(B, s * (share[1] * fb + zf * cl + 0.12 * P.sweep * (1 - cl)));
        qmul(C, A, B); return qmul(out, base, C);
      }
      case 'feather': {
        const f = r.f, j = r.j, g = 0.35 + 0.65 * (j / Math.max(1, f.K - 1)), lag = 0.5 * j;
        const flutter = 0.6 * Math.sin(TAU * (f.f1 * t / 2.5) + f.p1 - lag) + 0.4 * Math.sin(TAU * (f.f2 * t / 2.5) + f.p2 - lag);
        if (f.side) {                                                 // wing feather: the wake of the beat, a flutter, the fan
          const s = f.side, open = 1 - cl;
          const trail = Math.sin(TAU * (ph - f.lagBeat) - 0.45 * j);
          rx(A, -s * f.A * g * 0.9 * trail * fl * (0.4 + 0.6 * open));
          ry(B, f.A * g * 0.6 * flutter * (0.5 + 0.5 * open));
          qmul(C, A, B);
          if (j === 0) {                                              // the fan closes about the feather's ROOT
            ry(D, s * fold.fan * cl * (f.s - 0.35 + fold.fanBias)); qmul(E, C, D); return qmul(out, base, E);
          }
          return qmul(out, base, C);
        }
        // tail / back feather: lateral wave + vertical beat wake + trailing behind the turn; the tail spreads by its lateral index
        const spread = f.region === 'tail' ? (P.tail - 0.5) * 0.5 * (f.lat ?? 0) * (j === 0 ? 1 : 0.35) : 0;
        const turn = f.region === 'tail' ? -P.yawRate * 0.35 * g : 0, pit = f.region === 'tail' ? P.pitchRate * 0.35 * g : 0;
        const comb = f.region === 'crest' ? -P.fly * (j === 0 ? 0.55 : 0.18) : f.region === 'back' ? -P.fly * (j === 0 ? 0.35 : 0.1) : 0;         // the wind combs head and mane strands back
        ry(A, f.A * g * flutter + turn + spread);
        rz(B, f.A * g * 0.8 * Math.sin(TAU * (ph - f.lagBeat) - 0.4 * j) * fl + pit + comb);
        qmul(C, A, B); return qmul(out, base, C);
      }
      case 'tail': {
        const idx = r.j;
        ry(A, 0.045 * Math.sin(TAU * (2 * t / 2.5 - 0.5 - 0.09 * idx - 0.12 * r.c)) - P.yawRate * 0.18 * (idx + 1) / r.len);
        rz(B, 0.03 * Math.sin(TAU * (2 * t / 2.5 - 0.35 - 0.1 * idx)) + P.pitchRate * 0.2 * (idx + 1) / r.len);
        qmul(C, A, B); return qmul(out, base, C);
      }
      case 'leg': {
        const L = P.legs, j = r.j;
        // + about z swings a paw backwards (the bird faces -x). tucked: thigh back, shin folded under; landing: reaching forward
        const back = [0.35, 0.8, 1.15, 0.95, 0.55][j], fwd = [0.25, 0.45, 0.15, -0.15, -0.3][j];
        const a = L >= 0 ? L * back * fold.tuckLegs : L * fwd * 1.0;
        const sway = 0.07 * Math.sin(TAU * (0.4 * t - 0.15 * j + (r.li ? 0.1 : 0))) * (1 - Math.abs(L) * 0.6) - 0.05 * P.pitchRate * (j + 1) / 5;
        rz(A, a + sway); return qmul(out, base, A);
      }
      case 'crest': {
        rz(A, 0.12 * Math.sin(TAU * (2 * t / 2.5 - 0.18 * r.j)) - 0.15 * P.pitchRate * (r.j + 1) - P.fly * (r.j === 0 ? 0.75 : 0.25));      // in flight the wind combs the crest back
        return qmul(out, base, A);
      }
      case 'back': {
        // follows 60 % of its wing's shoulder movement RELATIVE to the spine joint the wing hangs from (Meshy mixed their weights
        // with the wing bones, so without this the mixed vertices shear), on top of the pose of its own parent
        const sh = r.shRole ?? (r.shRole = role[idxOf(r.shoulder)]), sp = r.spIdx ?? (r.spIdx = parent[idxOf(r.shoulder)]);
        deltaOf(sh, ID, P, D);                                         // the shoulder's absolute delta
        qconj(E, ld3(sp));                                              // inverse of the spine joint's delta
        qmul(C, E, D);                                                  // the wing's movement relative to its spine joint
        const k = 0.6, ang = 2 * Math.acos(Math.min(1, Math.abs(C[3]))), sg = C[3] < 0 ? -1 : 1, si = Math.sin(ang / 2);
        if (ang < 1e-5 || !si) qset(E, 0, 0, 0, 1); else qaxis(E, (sg * C[0]) / si, (sg * C[1]) / si, (sg * C[2]) / si, ang * k);
        rz(A, 0.04 * Math.sin(TAU * (2 * t / 2.5 - 0.2 - 0.12 * r.j)));
        qmul(C, E, A); return qmul(out, base, C);
      }
      case 'spine': {
        // each segment of the chain is posed to an ABSOLUTE direction: standing (rest) .. flight (horizontal body, stretched neck).
        // Rz(+) lowers the front (the bird faces -x). Plus a travelling wave with the wing beat (the body rises and falls with the
        // stroke, the neck follows a little later), a lean into the turn, a slow breathing, and the head's own look.
        const j = r.j, f = P.fly, st = P.stretch, neckw = j >= 4 ? (j - 3) / (K - 4) : 0;
        const target = FLIGHT_THETA[Math.min(j, FLIGHT_THETA.length - 1)] + (j >= 4 ? st * 12 * neckw : -st * 3);   // stretched: the neck reaches further forward, the body flattens
        const stand = restTheta[j];
        const th = (stand - target) * f;                                                    // degrees
        const wave = (2.6 + 1.6 * neckw) * Math.sin(TAU * (P.phase - 0.07 * j)) * P.flap * f + 0.9 * Math.sin(TAU * (t / 4.2) - 0.3 * j);
        rz(A, ((th + wave) * Math.PI) / 180);
        ry(B, (-P.bank * 0.28 * (j / K) + (j >= K - 2 ? P.lookYaw + 0.07 * Math.sin(TAU * (t / 7) + 0.5) : 0.02 * Math.sin(TAU * (t / 6) - 0.5 * j))));
        qmul(C, A, B); return qset(out, C[0], C[1], C[2], C[3]);
      }
      default: return qset(out, base[0], base[1], base[2], base[3]);
    }
  }

  const baseTmp = new Float64Array(4), outQ = new Float64Array(4), pqA = new Float64Array(4), rwA = new Float64Array(4), rlA = new Float64Array(4);
  const ld = (o, arr, i) => { o[0] = arr[i * 4]; o[1] = arr[i * 4 + 1]; o[2] = arr[i * 4 + 2]; o[3] = arr[i * 4 + 3]; return o; };
  function pose(P) {
    P = { ...FLIGHT_DEFAULTS, ...P };
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
  return { pose, reset, bones, byName, feathers, wings, fold, FOLD };
}

// Procedural flight clips. Every joint keeps identity rest rotation, so local axes == world axes:
//   Z = flap (wings rise/fall in the XY plane), X = pitch/sway, Y = yaw.
// Left wing: +rz lowers the wing. Right wing is mirrored (-rz lowers it).
const D = Math.PI / 180, TAU = Math.PI * 2;

export function qAxisAngle(axis, ang) {
  const l = Math.hypot(...axis) || 1, s = Math.sin(ang / 2) / l;
  return [axis[0]*s, axis[1]*s, axis[2]*s, Math.cos(ang / 2)];
}
export function qMul(a, b) { // a*b, xyzw
  return [
    a[3]*b[0] + a[0]*b[3] + a[1]*b[2] - a[2]*b[1],
    a[3]*b[1] - a[0]*b[2] + a[1]*b[3] + a[2]*b[0],
    a[3]*b[2] + a[0]*b[1] - a[1]*b[0] + a[2]*b[3],
    a[3]*b[3] - a[0]*b[0] - a[1]*b[1] - a[2]*b[2],
  ];
}
const qEuler = (rx = 0, ry = 0, rz = 0) =>
  qMul(qMul(qAxisAngle([0,0,1], rz), qAxisAngle([0,1,0], ry)), qAxisAngle([1,0,0], rx));

// smooth asymmetric stroke: 0 = wings up (rest), 1 = bottom of downstroke
function stroke(phi) {
  const c = 0.5 - 0.5 * Math.cos(TAU * phi);
  return c + 0.08 * Math.sin(2 * TAU * phi) * (1 - c);   // slight skew: quick down, relaxed up
}
const wave = (phi, lag, k = 1, off = 0) => Math.sin(TAU * k * (phi - lag) + off);

// per-part: [amp deg, lag cycles]
const WING = {
  Shoulder: [46, 0.00], Arm: [11, 0.035], Forearm: [16, 0.07], Hand: [19, 0.115], Tip1: [14, 0.16], Tip2: [11, 0.21],
};
const TWIST = { Shoulder: 0, Arm: 3, Forearm: 5, Hand: 8, Tip1: 11, Tip2: 13 };   // pronation along the span
const WING_DIR = { L: [-0.2, 0.3, -0.13], R: [0.2, 0.3, 0.12] };                   // rough span axis for twist

// P: {wing, hold, fold, body, tail, rib}
export function pose(P, phi, jointNames) {
  const out = {};                       // name -> {q, t?}
  const set = (n, q) => { if (jointNames.has(n)) out[n] = { q }; };
  const f = P.hold ?? 0;                // static wing-down offset 0..1 (glide)

  for (const side of ['L', 'R']) {
    const sgn = side === 'L' ? 1 : -1;
    for (const [part, [amp, lag]] of Object.entries(WING)) {
      const s = stroke(phi - lag);
      const flap = amp * (f + (1 - f) * P.wing * s);
      // wing folds slightly on the upstroke (velocity < 0)
      const up = Math.max(0, -Math.sin(TAU * (phi - lag)));
      const fold = part === 'Shoulder' ? 0 : -P.fold * (amp / 16) * up;
      const rz = sgn * (flap + fold) * D;
      const twist = TWIST[part] * D * P.wing * (0.6 * Math.sin(TAU * (phi - lag - 0.1)) + 0.4);
      const qf = qAxisAngle([0, 0, 1], rz);
      const qt = qAxisAngle(WING_DIR[side], sgn * twist);
      set(`Wing_${side}_${part}`, qMul(qf, qt));
    }
  }

  // body: lifts on the downstroke, counter-pitches, head & crest stay calm
  const b = P.body;
  const pitch = 2.4 * D * b * wave(phi, 0.04);
  set('Root',   qEuler(pitch, 0.8 * D * b * wave(phi, 0.1, 1, 1.2), 1.2 * D * b * wave(phi, 0.0, 1, 0.8)));
  set('Spine1', qEuler(1.6 * D * b * wave(phi, 0.09)));
  set('Spine2', qEuler(1.4 * D * b * wave(phi, 0.14)));
  set('Neck1',  qEuler(-1.8 * D * b * wave(phi, 0.18), 1.5 * D * b * wave(phi, 0.2, 1, 0.5)));
  set('Neck2',  qEuler(-1.6 * D * b * wave(phi, 0.22), 1.2 * D * b * wave(phi, 0.24, 1, 0.5)));
  set('Head',   qEuler(-1.2 * D * b * wave(phi, 0.26), 2.0 * D * b * wave(phi, 0.28, 1, 0.5)));
  set('Crest1', qEuler(5 * D * b * wave(phi, 0.30), 0, 3 * D * b * wave(phi, 0.30, 1, 1)));
  set('Crest2', qEuler(8 * D * b * wave(phi, 0.38), 0, 5 * D * b * wave(phi, 0.38, 1, 1)));
  set('Beak',   qEuler(2 * D * b * Math.max(0, wave(phi, 0.1))));

  // tails: travelling wave, lag grows down the plume, amplitude grows toward the tip
  const tailCfg = { A: { off: 0.00, ph: 0.0 }, B: { off: 0.07, ph: 1.0 }, C: { off: 0.14, ph: 2.1 } };
  for (const [id, c] of Object.entries(tailCfg)) {
    for (let k = 1; k <= 5; k++) {
      const lag = 0.22 + c.off + 0.045 * k, amp = (2.0 + 1.8 * k) * D * P.tail;
      set(`Tail_${id}_${k}`, qEuler(amp * wave(phi, lag, 1, c.ph), 0.4 * amp * wave(phi, lag + 0.1, 1, c.ph), 0.9 * amp * wave(phi, lag + 0.25, 1, c.ph + 1.3)));
    }
  }
  // ribbons: lighter, with a faster flutter on top
  ['L1', 'L2', 'R1', 'R2'].forEach((id, ri) => {
    for (let k = 1; k <= 4; k++) {
      const lag = 0.18 + 0.05 * k + 0.03 * ri, amp = (2.5 + 2.5 * k) * D * P.rib;
      const flutter = 0.35 * amp * wave(phi, lag * 1.3, 2, ri);
      set(`Ribbon_${id}_${k}`, qEuler(amp * wave(phi, lag, 1, ri * 0.7) + flutter, 0, 1.1 * amp * wave(phi, lag + 0.2, 1, ri * 0.7 + 1)));
    }
  });

  // body bob (Root translation, model-space units)
  if (jointNames.has('Root')) out.Root.t = [0, 0.010 * P.body * Math.sin(TAU * phi), 0];
  return out;
}

export const CLIPS = {
  // fast cruise flap (~1.1 Hz)
  Flap:  { T: 0.9, P: { wing: 1.0,  hold: 0.0,  fold: 0.9, body: 1.0, tail: 1.0, rib: 1.0 } },
  // slower, wider hover
  Hover: { T: 1.4, P: { wing: 0.8,  hold: 0.0,  fold: 0.6, body: 1.1, tail: 1.2, rib: 1.2 } },
  // wings held out, gentle ripples
  Glide: { T: 5.0, P: { wing: 0.10, hold: 0.42, fold: 0.1, body: 0.6, tail: 1.3, rib: 1.4 } },
  // slow breathing in the air
  Idle:  { T: 3.2, P: { wing: 0.22, hold: 0.0,  fold: 0.3, body: 0.8, tail: 0.9, rib: 1.0 } },
};

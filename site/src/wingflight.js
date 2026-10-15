// Wing kinematics for the sculpted phoenix. The wing is 6 bones (Shoulder, Arm, Forearm, Hand, Tip1, Tip2); bone i
// carries the SEGMENT i = (joint i -> joint i+1), whose rest offset is child.position. Instead of rotating bones by
// fixed angles, the wing is described by where each SEGMENT POINTS, in the body frame (the model's own frame):
//   +y = toward the head (forward), +z = the back (dorsal; the chest faces -z), lateral = -x for L, +x for R.
// A pose is then 6 unit directions + a twist per segment; the bone rotations are solved from them (swing from the
// rest direction + twist about the new direction), so "the wing is flexed", "the tip trails", "the hand is turned"
// are authored as shapes, not as hinge angles.
//
// Poses blended by weights (all in direction space, slerped):
//   hover   the sculpted V raised along the chest, flapping about the chest axis (the original behaviour)
//   cruise  flapping about the body's long axis: elevation per segment (up/down), sweep back, elbow+wrist FLEXION on
//           the upstroke (the wing folds like a Z), tips lagging the root, pronation/supination twist
//   glide   fully extended, slight dihedral, almost still
//   stoop   the dive: wings swept back against the body
// Everything the controller must provide each frame is the `st` object (see pose()).
import * as THREE from 'three';

const D = Math.PI / 180, TAU = Math.PI * 2;
const { clamp, lerp, smoothstep: sstep } = THREE.MathUtils;
const NAMES = ['Shoulder', 'Arm', 'Forearm', 'Hand', 'Tip1', 'Tip2'];

// wing-beat curve: 0 = top of the stroke, 1 = bottom; quick down, relaxed up (as in tools/anim.mjs)
export const stroke = (p) => { p = ((p % 1) + 1) % 1; const c = 0.5 - 0.5 * Math.cos(TAU * p); return c + 0.08 * Math.sin(2 * TAU * p) * (1 - c); };

// per-segment cruise parameters (degrees). Index = segment, 0 = inner wing ... 5 = the last primaries
const E_UP = [26, 28, 32, 36, 40, 42];       // elevation above the body's horizontal plane at the TOP of the stroke
const E_DN = [-18, -22, -28, -34, -40, -44]; // ... and at the BOTTOM (the tips travel further than the root)
const YAW0 = [4, 8, 12, 16, 20, 22];         // sweep back at full extension
const YAW_F = [0, 18, 40, 62, 74, 78];       // extra sweep back at full flexion (elbow/wrist closing)
const E_FLEX = [0, 4, 10, 16, 20, 22];       // flexion also lifts the hand (the wing folds up and back)
const TW = [3, 5, 9, 15, 22, 30];            // twist amplitude: the outer primaries turn the most
const LAG = [0, 0.03, 0.06, 0.10, 0.14, 0.18];   // wing-beat phase lag along the wing (cycles): the tip trails
const STOOP_E = [6, 8, 10, 10, 10, 10], STOOP_Y = [24, 58, 80, 84, 86, 86];
const GLIDE_E = [10, 12, 14, 16, 18, 18], GLIDE_Y = [6, 9, 13, 18, 22, 22];
// hover = the sculpted V flapping about the chest axis (cumulative hinge angles, as the old clips did)
const HOV_AMP = [46, 11, 16, 19, 14, 11], HOV_LAG = [0, 0.035, 0.07, 0.115, 0.16, 0.21];

const AXZ = new THREE.Vector3(0, 0, 1);

export function createWingRig(bones) {
  const sides = ['L', 'R'].map((side) => {
    const chain = NAMES.map((n) => bones[`Wing_${side}_${n}`]);
    const d = [];
    for (let i = 0; i < 5; i++) d.push(chain[i + 1].position.clone().normalize());      // segment i = the child's rest offset
    d.push(d[4].clone());
    const lat = side === 'L' ? -1 : 1;
    // Why a canonical direction: the minimal rotation between two vectors is undefined when they are OPPOSITE, and a
    // flexed wing tip (pointing back and down) is exactly opposite to its rest direction (forward and up): the feather
    // used to flip 76 degrees in 0.005 of a cycle. Going rest -> LATERAL (a fixed rotation, 90 deg) -> target keeps both
    // legs away from 180 deg. At D == rest the product is the identity, so the sculpted pose is preserved.
    const c = new THREE.Vector3(lat, 0, 0);
    const R0 = d.map((di) => new THREE.Quaternion().setFromUnitVectors(di, c));
    return { side, chain, d, c, R0, lat, zrot: side === 'L' ? 1 : -1 };
  });
  // chain of ancestors, from the model root down to the shoulder's parent
  const anc = [];
  for (let b = bones.Wing_L_Shoulder.parent; b && b.isBone; b = b.parent) anc.unshift(b);

  const tmpQ = new THREE.Quaternion(), swing = new THREE.Quaternion(), twist = new THREE.Quaternion();
  const Qp = new THREE.Quaternion(), QW = new THREE.Quaternion(), inv = new THREE.Quaternion();
  const v0 = new THREE.Vector3(), v1 = new THREE.Vector3(), Dc = new THREE.Vector3(), Dh = new THREE.Vector3();
  const IDQ = new THREE.Quaternion();

  const dirOf = (out, lat, e, yaw) => {                 // elevation + sweep back -> a unit direction in the body frame
    const ce = Math.cos(e * D), cy = Math.cos(yaw * D), sy = Math.sin(yaw * D);
    return out.set(lat * ce * cy, -ce * sy, Math.sin(e * D)).normalize();
  };
  const slerpDir = (out, a, b, t) => {                  // rotate a toward b by fraction t along the great arc
    if (t <= 0) return out.copy(a);
    tmpQ.setFromUnitVectors(a, b);
    swing.copy(IDQ).slerp(tmpQ, t);
    return out.copy(a).applyQuaternion(swing).normalize();
  };

  /** st: { phase, w (0 hover .. 1 cruise), G (glide), dive, flex (0..1), amp (0..1+), inner:{L,R} (-1..1), twistK } */
  function pose(st) {
    Qp.identity();
    for (const b of anc) Qp.multiply(b.quaternion);       // the shoulder's parent, relative to the model frame

    const A = st.amp * lerp(1, 0.12, st.G) * (1 - st.dive);
    const hA = lerp(1, 0.10, st.G);
    const holdU = lerp(0.14, 0.40, st.G), swingU = 0.82;
    const Fcurve = Math.pow(Math.max(0, Math.sin(TAU * (st.phase - 0.5))), 1.25);     // flexion bump: mid-upstroke

    for (const S of sides) {
      const inner = st.inner[S.side] ?? 0;                // +1 = the wing on the inside of a turn
      const ampSide = 1 - 0.38 * Math.max(inner, 0) + 0.22 * Math.max(-inner, 0);
      const flexSide = clamp(st.flex + 0.30 * inner, 0, 1.2);
      const elevSide = -7 * inner;                        // the inner wing sits lower, the outer one higher
      Qp.copy(IDQ); for (const b of anc) Qp.multiply(b.quaternion);
      let cum = 0;

      for (let i = 0; i < 6; i++) {
        // -- hover: cumulative hinge about the chest axis
        const sH = stroke(st.phase - HOV_LAG[i]);
        cum += HOV_AMP[i] * (holdU + swingU * hA * sH);
        Dh.copy(S.d[i]).applyAxisAngle(AXZ, S.zrot * cum * D);

        // -- cruise: shape in the body frame
        const c = stroke(st.phase - LAG[i]);
        const mean = 0.5 * (E_UP[i] + E_DN[i]);
        let e = mean + (lerp(E_UP[i], E_DN[i], c) - mean) * A * ampSide + E_FLEX[i] * Fcurve * flexSide * (1 - st.dive) + elevSide;
        let yaw = YAW0[i] + YAW_F[i] * Fcurve * flexSide;
        dirOf(Dc, S.lat, e, yaw);
        // glide: extended, dihedral, quiet
        if (st.G > 0.001) { dirOf(v0, S.lat, GLIDE_E[i] + elevSide * 0.5, GLIDE_Y[i]); slerpDir(Dc, Dc, v0, st.G); }
        // stoop: swept back against the body (the dive)
        if (st.dive > 0.001) { dirOf(v1, S.lat, STOOP_E[i], STOOP_Y[i]); slerpDir(Dc, Dc, v1, st.dive); }
        // hover <-> cruise
        slerpDir(v0, Dh, Dc, st.w);

        // twist about the segment: pronation on the downstroke, supination on the upstroke (outer wing most)
        const pr = Math.sin(TAU * (st.phase - LAG[i]));
        let tau = S.lat * TW[i] * pr * st.twistK * (1 - st.G) * (1 - st.dive) * st.w;
        tau += S.lat * (-14 * (i / 5)) * st.dive * st.twistK;     // in the stoop the primaries trail flat

        tmpQ.setFromUnitVectors(S.c, v0);
        swing.copy(tmpQ).multiply(S.R0[i]);               // rest -> lateral -> target
        twist.setFromAxisAngle(v0, tau * D);
        QW.copy(twist).multiply(swing);
        S.chain[i].quaternion.copy(inv.copy(Qp).invert().multiply(QW));
        Qp.copy(QW);
      }
    }
  }
  return { pose, sides };
}

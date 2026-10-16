// The pilot: a flight path through the scene + a timeline of pose parameters, both pure functions of the progress u in 0..1
// (the scroll). Nothing is integrated frame to frame, so scrolling back flies the same path in reverse.
//
//   const path = createPath([[x, y, z], ...])          Catmull-Rom (centripetal) through the waypoints, sampled by arc length
//   path.at(u) -> { pos, fwd, quat, pitch, pitchRate, yawRate, bank }       where the bird is and how it is turned (model faces -z)
//   const tl = createTimeline(keys)                    keys: [{ u, open, flap, beats, sweep, legs, tail, ... }, ...]
//   tl.at(u) -> the interpolated parameters (monotone cubic: smooth, no overshoot, so `beats` never runs backwards)
import * as THREE from 'three';

const TAU = Math.PI * 2;

/** Monotone cubic Hermite (Fritsch-Carlson) through (xs, ys). Smooth (C1) and never overshoots the keys. */
function pchip(xs, ys) {
  const n = xs.length, h = [], d = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) { h[i] = xs[i + 1] - xs[i]; d[i] = (ys[i + 1] - ys[i]) / h[i]; }
  if (n === 2) m[0] = m[1] = d[0];
  else {
    for (let i = 1; i < n - 1; i++) {
      if (d[i - 1] * d[i] <= 0) m[i] = 0;
      else { const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1]; m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]); }
    }
    m[0] = endSlope(h[0], h[1], d[0], d[1]); m[n - 1] = endSlope(h[n - 2], h[n - 3], d[n - 2], d[n - 3]);
  }
  return (x) => {
    if (x <= xs[0]) return ys[0]; if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (x > xs[i + 1]) i++;
    const t = (x - xs[i]) / h[i], t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1];
  };
}
function endSlope(h0, h1, d0, d1) {
  let m = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
  if (Math.sign(m) !== Math.sign(d0)) m = 0; else if (Math.sign(d0) !== Math.sign(d1) && Math.abs(m) > 3 * Math.abs(d0)) m = 3 * d0;
  return m;
}

export function createTimeline(keys) {
  const xs = keys.map((k) => k.u), names = Object.keys(keys[0]).filter((k) => k !== 'u');
  const fn = {}; for (const nme of names) fn[nme] = pchip(xs, keys.map((k) => k[nme]));
  return { keys, at(u) { const o = { u }; for (const nme of names) o[nme] = fn[nme](u); return o; } };
}

export function createPath(points, { bankGain = 5.0, maxBank = 0.65, bankSign = 1 } = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), false, 'centripetal');
  curve.arcLengthDivisions = 800;
  const length = curve.getLength();
  const up = new THREE.Vector3(0, 1, 0), fwdAxis = new THREE.Vector3(0, 0, -1);
  const f = new THREE.Vector3(), f0 = new THREE.Vector3(), f1 = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), rollQ = new THREE.Quaternion();
  const heading = (v) => Math.atan2(v.x, v.z);
  const dU = 0.012;
  const clampU = (u) => Math.min(1, Math.max(0, u));
  return {
    curve, length,
    /** pose of the bird at u; the returned objects are reused between calls */
    at(u, out = { pos: new THREE.Vector3(), fwd: new THREE.Vector3(), quat: new THREE.Quaternion(), pitch: 0, pitchRate: 0, yawRate: 0, bank: 0 }) {
      u = clampU(u);
      curve.getPointAt(u, out.pos); curve.getTangentAt(u, out.fwd).normalize();
      curve.getTangentAt(clampU(u - dU), f0); curve.getTangentAt(clampU(u + dU), f1);
      const span = clampU(u + dU) - clampU(u - dU) || 1;
      let dh = heading(f1) - heading(f0); dh = Math.atan2(Math.sin(dh), Math.cos(dh));           // wrapped
      out.yawRate = dh / span;                                                                    // rad per unit of u
      out.pitch = Math.asin(THREE.MathUtils.clamp(out.fwd.y, -1, 1));
      out.pitchRate = (Math.asin(THREE.MathUtils.clamp(f1.y, -1, 1)) - Math.asin(THREE.MathUtils.clamp(f0.y, -1, 1))) / span;
      out.bank = bankSign * THREE.MathUtils.clamp(out.yawRate * bankGain * 0.02, -maxBank, maxBank);
      // orientation: the model faces -z; turn it to the tangent (shortest arc, no stray roll), then roll about its own forward axis
      tmpQ.setFromUnitVectors(fwdAxis, out.fwd);
      // keep the wings level before banking: remove the roll the arc may carry by re-aiming the up vector
      f.copy(up).applyQuaternion(tmpQ);
      rollQ.setFromAxisAngle(out.fwd, out.bank);
      out.quat.copy(rollQ).multiply(tmpQ);
      return out;
    },
  };
}

/** A chase camera as a function of u: it sits behind and above the bird at u - lag (so it trails the bird a little), looks ahead. */
export function chaseCamera(path, u, { back = 5.2, up = 1.7, side = 1.9, lag = 0.035, lookAhead = 0.02 } = {}, out = { pos: new THREE.Vector3(), target: new THREE.Vector3() }) {
  const b = path.at(u - lag), ahead = path.at(u + lookAhead);
  const right = new THREE.Vector3().crossVectors(b.fwd, new THREE.Vector3(0, 1, 0)).normalize();
  out.pos.copy(b.pos).addScaledVector(b.fwd, -back).addScaledVector(right, side).add(new THREE.Vector3(0, up, 0));
  out.target.copy(ahead.pos);
  return out;
}

export { TAU };

// Runtime rig toolkit shared by every beast (dragon, phoenix, tiger, tortoise).
// All rigs in this project are exported with IDENTITY rest rotations (local axes == model axes, a child's translation is
// its rest offset), so a controller can reason in model space and set bone.quaternion / root.position directly.
//
//   SplineIK    a chain that follows a guide curve (Catmull-Rom through K handles): joints sit ON the curve at fixed bone
//               lengths (no stretching), orientation by parallel transport, expressed RELATIVE to the rest curve so that
//               guide == rest curve gives exactly the sculpted pose.
//   Strand      FK micro-chain (whisker, hair lock): Verlet points anchored to a bone, pulled back to the rest shape by a
//               stiffness that fades from root to tip, driven by inertia + gravity + wind.
//   TwoBoneIK   hip -> knee -> ankle with a pole, bone frames locked to the bend plane.
import * as THREE from 'three';

const { Vector3: V3, Quaternion: Q4, Matrix4: M4 } = THREE;
const _q = new Q4(), _q2 = new Q4(), _v = new V3(), _v2 = new V3(), _m = new M4();
const X = new V3(1, 0, 0), Y = new V3(0, 1, 0);

/** name -> Bone for a loaded glTF scene */
export function collectBones(root) {
  const m = new Map();
  root.traverse((o) => { if (o.isBone) m.set(o.name, o); });
  return m;
}

/** orthonormal frame (as a quaternion) with local +Z = forward and local +X as close to `side` as possible */
export function frameQuat(forward, side, out = new Q4()) {
  const z = _v.copy(forward).normalize();
  let x = _v2.copy(side); x.addScaledVector(z, -x.dot(z));
  if (x.lengthSq() < 1e-8) { x.copy(Math.abs(z.y) < 0.9 ? Y : X); x.addScaledVector(z, -x.dot(z)); }
  x.normalize();
  const y = new V3().crossVectors(z, x);
  _m.makeBasis(x, y, z);
  return out.setFromRotationMatrix(_m);
}

/** minimal rotation taking unit vector a to unit vector b (robust at 180 degrees) */
export function swing(a, b, out = new Q4()) {
  const d = a.dot(b);
  if (d < -0.999999) {
    const axis = Math.abs(a.x) < 0.9 ? _v.set(1, 0, 0).cross(a) : _v.set(0, 1, 0).cross(a);
    return out.setFromAxisAngle(axis.normalize(), Math.PI);
  }
  return out.setFromUnitVectors(a, b);
}

// ───────────────────────────── Catmull-Rom guide curve ─────────────────────────────
function sampleCatmullRom(H, perSpan, out) {
  const K = H.length;
  let n = 0;
  for (let i = 0; i < K - 1; i++) {
    const p0 = H[Math.max(0, i - 1)], p1 = H[i], p2 = H[i + 1], p3 = H[Math.min(K - 1, i + 2)];
    const last = i === K - 2;
    for (let s = 0; s < perSpan + (last ? 1 : 0); s++) {
      const t = s / perSpan, t2 = t * t, t3 = t2 * t;
      out[n++] = 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
      out[n++] = 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
      out[n++] = 0.5 * (2 * p1.z + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3);
    }
  }
  return n / 3;
}

/** march along a sampled curve placing points at fixed chord lengths. -> fills pts[(count+1)*3] */
function march(table, count, lengths, pts) {
  let ix = table[0], iy = table[1], iz = table[2];
  pts[0] = ix; pts[1] = iy; pts[2] = iz;
  let m = 1, tx = 0, ty = 0, tz = 0;
  for (let k = 0; k < lengths.length; k++) {
    const L = lengths[k];
    let found = false;
    for (; m < count; m++) {
      const dx = table[m*3] - ix, dy = table[m*3+1] - iy, dz = table[m*3+2] - iz;
      const d = Math.sqrt(dx*dx + dy*dy + dz*dz);
      if (d >= L) {
        // between table[m-1] and table[m]: solve |lerp - I| = L (the previous point is closer than L)
        const px = table[(m-1)*3] - ix, py = table[(m-1)*3+1] - iy, pz = table[(m-1)*3+2] - iz;
        const dp = Math.sqrt(px*px + py*py + pz*pz);
        const f = d > dp ? (L - dp) / (d - dp) : 1;
        const nx = table[(m-1)*3] + (table[m*3] - table[(m-1)*3]) * f;
        const ny = table[(m-1)*3+1] + (table[m*3+1] - table[(m-1)*3+1]) * f;
        const nz = table[(m-1)*3+2] + (table[m*3+2] - table[(m-1)*3+2]) * f;
        tx = nx - ix; ty = ny - iy; tz = nz - iz;
        ix = nx; iy = ny; iz = nz; found = true; break;
      }
    }
    if (!found) {                                  // the curve is shorter than the chain: continue straight
      const tl = Math.hypot(tx, ty, tz) || 1;
      ix += tx / tl * L; iy += ty / tl * L; iz += tz / tl * L;
    }
    pts[(k + 1) * 3] = ix; pts[(k + 1) * 3 + 1] = iy; pts[(k + 1) * 3 + 2] = iz;
  }
}

export class SplineIK {
  /**
   * @param bones   chain ordered from the ROOT (index 0) to the tip; bones[i+1] is a child of bones[i]
   * @param handles number of guide handles (spread evenly along the chain)
   * @param side    reference lateral axis used to build frames (the creature's left-right axis)
   */
  constructor(bones, { handles = 12, samplesPerSpan = 28, side = X, maxBend = null } = {}) {
    this.bones = bones;
    this.n = bones.length;
    this.side = side.clone();
    // rest positions in the root parent's space (rest rotations are identity)
    this.rest = [];
    const p = bones[0].position.clone();
    this.rest.push(p.clone());
    for (let i = 1; i < this.n; i++) { p.add(bones[i].position); this.rest.push(p.clone()); }
    this.len = new Float64Array(this.n - 1);
    for (let i = 1; i < this.n; i++) this.len[i - 1] = this.rest[i].distanceTo(this.rest[i - 1]);
    this.handleIndex = [];
    for (let k = 0; k < handles; k++) this.handleIndex.push(Math.round((k * (this.n - 1)) / (handles - 1)));
    this.restHandles = this.handleIndex.map((i) => this.rest[i].clone());
    this.handles = this.restHandles.map((v) => v.clone());      // the animated guide (write to these)
    this.perSpan = samplesPerSpan;
    this.table = new Float64Array(((handles - 1) * samplesPerSpan + 1) * 3);
    this.tableRest = new Float64Array(this.table.length);
    this.pts = new Float64Array(this.n * 3);
    this.ptsRest = new Float64Array(this.n * 3);
    this.W = Array.from({ length: this.n }, () => new Q4());
    this.F0 = this.#frames(this.restHandles, this.tableRest, this.ptsRest, 0);
    // largest bend (radians) allowed at each joint = the pinch limit of the flesh, never below what the sculpt already has
    this.restBend = new Float64Array(this.n);
    for (let i = 1; i < this.n - 1; i++) {
      const a = _v.set(this.ptsRest[i*3] - this.ptsRest[(i-1)*3], this.ptsRest[i*3+1] - this.ptsRest[(i-1)*3+1], this.ptsRest[i*3+2] - this.ptsRest[(i-1)*3+2]).normalize();
      const b = _v2.set(this.ptsRest[(i+1)*3] - this.ptsRest[i*3], this.ptsRest[(i+1)*3+1] - this.ptsRest[i*3+1], this.ptsRest[(i+1)*3+2] - this.ptsRest[i*3+2]).normalize();
      this.restBend[i] = Math.acos(Math.min(1, Math.max(-1, a.dot(b))));
    }
    this.maxBend = null;
    if (maxBend) this.setMaxBend(maxBend);
    this.roll = new Float64Array(this.n);                        // extra roll (radians) per chain joint, write to bank/twist
  }

  // frames of every bone (forward = direction toward the next joint) by parallel transport from the root
  #frames(handles, table, pts, rollFlag, roll) {
    const count = sampleCatmullRom(handles, this.perSpan, table);
    march(table, count, this.len, pts);
    if (rollFlag && this.maxBend) this.#limitBends(pts);
    const F = new Array(this.n);
    const fwd = new V3(), prev = new V3();
    let side = this.side.clone();
    for (let i = 0; i < this.n; i++) {
      const j = Math.min(i, this.n - 2);
      fwd.set(pts[(j+1)*3] - pts[j*3], pts[(j+1)*3+1] - pts[j*3+1], pts[(j+1)*3+2] - pts[j*3+2]).normalize();
      if (i > 0 && i < this.n - 1) {                                // carry the lateral axis along (minimal rotation)
        swing(prev, fwd, _q2); side.applyQuaternion(_q2);
      }
      if (rollFlag && roll) {
        const dr = roll[i] - (i > 0 ? roll[i - 1] : 0);
        if (dr) { _q.setFromAxisAngle(fwd, dr); side.applyQuaternion(_q); }
      }
      side.addScaledVector(fwd, -side.dot(fwd)).normalize();
      F[i] = frameQuat(fwd, side, new Q4());
      prev.copy(fwd);
    }
    return F;
  }

  /** per-joint (array) or uniform (number) maximum bend in radians; joints already bent more than this in the sculpt keep their bend */
  setMaxBend(v) {
    this.maxBend = new Float64Array(this.n);
    for (let i = 0; i < this.n; i++) this.maxBend[i] = Math.max(Array.isArray(v) || ArrayBuffer.isView(v) ? v[i] : v, this.restBend[i] * 1.08);
    return this;
  }

  // re-integrate the chain from the root keeping the guide's directions, but never bending more than maxBend per joint
  #limitBends(pts) {
    const n = this.n, d = new Float64Array((n - 1) * 3);
    for (let i = 0; i < n - 1; i++) {
      const x = pts[(i+1)*3] - pts[i*3], y = pts[(i+1)*3+1] - pts[i*3+1], z = pts[(i+1)*3+2] - pts[i*3+2], l = Math.hypot(x, y, z) || 1;
      d[i*3] = x / l; d[i*3+1] = y / l; d[i*3+2] = z / l;
    }
    let px = d[0], py = d[1], pz = d[2];
    for (let i = 1; i < n - 1; i++) {
      let dx = d[i*3], dy = d[i*3+1], dz = d[i*3+2];
      const dotv = Math.min(1, Math.max(-1, px*dx + py*dy + pz*dz)), ang = Math.acos(dotv), lim = this.maxBend[i];
      if (ang > lim && ang > 1e-6) {
        const t = lim / ang, s0 = Math.sin((1 - t) * ang) / Math.sin(ang), s1 = Math.sin(t * ang) / Math.sin(ang);
        dx = px * s0 + dx * s1; dy = py * s0 + dy * s1; dz = pz * s0 + dz * s1;
        const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
      }
      pts[(i+1)*3] = pts[i*3] + dx * this.len[i]; pts[(i+1)*3+1] = pts[i*3+1] + dy * this.len[i]; pts[(i+1)*3+2] = pts[i*3+2] + dz * this.len[i];
      px = dx; py = dy; pz = dz;
    }
  }

  /** The chain's guide point where the root sits (handle 0) */
  get rootTarget() { return this.handles[0]; }

  /** Solve: writes bones[i].quaternion (and the root position). Call before updating matrices. */
  solve() {
    const F1 = this.#frames(this.handles, this.table, this.pts, 1, this.roll);
    const W = this.W;
    for (let i = 0; i < this.n; i++) W[i].copy(F1[i]).multiply(_q.copy(this.F0[i]).invert());
    this.bones[0].position.set(this.pts[0], this.pts[1], this.pts[2]);
    this.bones[0].quaternion.copy(W[0]);
    for (let i = 1; i < this.n; i++) this.bones[i].quaternion.copy(_q.copy(W[i - 1]).invert()).multiply(W[i]);
    return this;
  }

  /** world position (model space) of chain joint i as laid out by the last solve() */
  jointPosition(i, out = new V3()) { return out.set(this.pts[i*3], this.pts[i*3+1], this.pts[i*3+2]); }
}

// ───────────────────────────── Verlet strand (whisker, hair lock) ─────────────────────────────
export class Strand {
  /**
   * @param bones chain bones b1..bm; bones[0].parent is the anchor bone
   * @param tip   the leaf bone after the last one (its rest offset defines the last segment)
   * @param ref   Object3D whose local space is the model space (the glTF scene)
   */
  constructor(bones, tip, ref, { stiffRoot = 0.5, stiffTip = 0.04, damping = 0.965, gravity = 0.6, maxDeflect = 2.0 } = {}) {
    this.bones = bones; this.tip = tip; this.ref = ref; this.maxDeflect = maxDeflect;
    this.m = bones.length;
    this.stiffRoot = stiffRoot; this.stiffTip = stiffTip; this.damping = damping; this.gravity = gravity;
    ref.updateMatrixWorld(true);
    const inv = new M4().copy(ref.matrixWorld).invert();
    const all = [...bones, tip];
    this.p0 = all.map((b) => new V3().setFromMatrixPosition(b.matrixWorld).applyMatrix4(inv));    // rest, model space
    this.seg = []; for (let i = 0; i < this.m; i++) this.seg.push(this.p0[i + 1].clone().sub(this.p0[i]));
    this.segLen = this.seg.map((s) => s.length());
    this.dir0 = this.seg.map((s) => s.clone().normalize());
    this.x = this.p0.map((v) => v.clone()); this.xp = this.p0.map((v) => v.clone());
    this.stiff = this.p0.map((_, i) => THREE.MathUtils.lerp(stiffRoot, stiffTip, i / this.m));
    this.W = bones.map(() => new Q4());
    this.parentRest = bones[0].parent;
    this.wind = new V3();
    this.manual = new Q4();                                        // extra hand-posed bend applied to the whole lock
    this.first = true;
    // scratch objects: the strand update runs for every lock every frame, so it must not allocate
    this.tgt = this.p0.map(() => new V3()); this.pm = new M4(); this.parQ = new Q4(); this.anchor = new V3(); this.a0 = new V3(); this.invP = new Q4();
  }

  /** parent world rotation / anchor position in model space, from the already-updated scene matrices */
  update(dt, gravityLocal, windLocal) {
    const ref = this.ref, par = this.bones[0].parent;   // parent matrices are fresh: the controller updates the scene once per frame
    const inv = _m.copy(ref.matrixWorld).invert();
    const pm = this.pm.multiplyMatrices(inv, par.matrixWorld);
    const parQ = this.parQ.setFromRotationMatrix(pm);
    // attached rest shape: the joint list rigidly carried by the parent
    const anchor = this.anchor.setFromMatrixPosition(pm);
    const a = this.a0.copy(this.bones[0].position).applyQuaternion(parQ).add(anchor);   // joint 0 = parent origin + rest offset in the parent frame
    const target = this.tgt;
    target[0].copy(a);
    for (let i = 1; i < target.length; i++) target[i].copy(this.p0[i]).sub(this.p0[0]).applyQuaternion(parQ).add(a);
    if (this.first) { this.x.forEach((v, i) => v.copy(target[i])); this.xp.forEach((v, i) => v.copy(target[i])); this.first = false; }
    const steps = Math.max(1, Math.round(dt * 120)), h = dt / steps;
    for (let s = 0; s < steps; s++) {
      this.x[0].copy(a); this.xp[0].copy(a);
      for (let i = 1; i <= this.m; i++) {
        const x = this.x[i], xp = this.xp[i];
        _v.copy(x).sub(xp).multiplyScalar(this.damping);
        xp.copy(x);
        x.add(_v);
        x.addScaledVector(gravityLocal, this.gravity * h * h);
        x.addScaledVector(windLocal, h * h);
        x.addScaledVector(_v2.copy(target[i]).sub(x), this.stiff[i] * Math.min(1, h * 60));
      }
      for (let i = 1; i <= this.m; i++) {                          // keep the bone lengths (root outward)
        _v.copy(this.x[i]).sub(this.x[i - 1]);
        const l = _v.length() || 1e-6;
        this.x[i].copy(this.x[i - 1]).addScaledVector(_v, this.segLen[i - 1] / l);
      }
    }
    // bones: LOCAL rotation = minimal swing from the rest direction to the simulated segment seen from the parent's frame
    // (well conditioned: a hanging lock is never 180 degrees from its parent-relative rest), deflection clamped
    let Wp = parQ;
    const invP = this.invP;
    for (let i = 0; i < this.m; i++) {
      invP.copy(Wp).invert();
      _v.copy(this.x[i + 1]).sub(this.x[i]).normalize().applyQuaternion(invP);
      const ang = Math.acos(clamp(this.dir0[i].dot(_v), -1, 1));
      if (ang > this.maxDeflect) {
        // slerp(dir0 -> d) back to the limit and drag the rest of the strand along with the correction
        const t = this.maxDeflect / ang, s0 = Math.sin((1 - t) * ang) / Math.sin(ang), s1 = Math.sin(t * ang) / Math.sin(ang);
        const dl = _v2.copy(this.dir0[i]).multiplyScalar(s0).addScaledVector(_v, s1).normalize();
        const dw = dl.clone().applyQuaternion(Wp);
        const nx = this.x[i].clone().addScaledVector(dw, this.segLen[i]);
        const shift = nx.sub(this.x[i + 1]);
        for (let k = i + 1; k <= this.m; k++) { this.x[k].add(shift); this.xp[k].add(shift); }
        _v.copy(dl);
      }
      swing(this.dir0[i], _v, _q2);
      this.bones[i].quaternion.copy(_q2);
      this.W[i].copy(Wp).multiply(_q2);
      Wp = this.W[i];
    }
  }
}

// ───────────────────────────── two-bone IK ─────────────────────────────
/**
 * Solve a hip->knee->ankle chain. `hip` and `target` in model space; lengths from the rest pose; `pole` = direction the
 * knee should bend toward. Returns the knee position (the ankle is clamped to the reachable sphere).
 */
export function twoBoneKnee(hip, target, upper, lower, pole, outKnee = new V3(), outAnkle = new V3(), softStart = Infinity) {
  const toT = _v.copy(target).sub(hip);
  let d = toT.length();
  const dMax = (upper + lower) * 0.998, dMin = Math.abs(upper - lower) + 1e-4;
  // soft IK: beyond `softStart` the reach is compressed exponentially toward dMax (no sudden knee lock-out)
  if (d > softStart && softStart < dMax) { const s = dMax - softStart; d = softStart + s * (1 - Math.exp(-(d - softStart) / s)); }
  d = Math.min(Math.max(d, dMin), dMax);
  const dir = toT.normalize();
  outAnkle.copy(hip).addScaledVector(dir, d);
  const x = (upper * upper - lower * lower + d * d) / (2 * d);
  const y = Math.sqrt(Math.max(0, upper * upper - x * x));
  const perp = _v2.copy(pole).addScaledVector(dir, -pole.dot(dir));
  if (perp.lengthSq() < 1e-8) perp.copy(Math.abs(dir.y) < 0.9 ? Y : X).addScaledVector(dir, -dir.dot(Math.abs(dir.y) < 0.9 ? Y : X));
  perp.normalize();
  return outKnee.copy(hip).addScaledVector(dir, x).addScaledVector(perp, y);
}

export const clamp = THREE.MathUtils.clamp;
export const lerp = THREE.MathUtils.lerp;
export const smoothstep = THREE.MathUtils.smoothstep;

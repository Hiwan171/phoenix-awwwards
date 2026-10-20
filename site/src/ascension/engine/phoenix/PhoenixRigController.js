// PhoenixRigController — procedural animation on the real SmartRigArmature.
// Every frame starts from the rest (bind) local rotations and layers:
//   body posture → neck/head → wings (frame-targeting solver) → legs → tail → feathers.
// Wings are solved per bone by aligning each bone's rest frame (primary = direction to
// its child joint, secondary = direction to the skin mass it carries) to target frames
// produced by a parametric wing model (fold / elevation / sweep / pitch / flap with
// per-joint phase lag). No bone is created, removed or re-parented.
import * as THREE from 'three';
import { skinCentroid } from './RigAudit.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z).normalize();
// Right-wing directions in body space (x = back, y = up, -z = outward).
const WING_SHAPE = {
  spread: { shoulder: V(-0.15, 0.14, -1), elbow: V(-0.34, 0.03, -1), wrist: V(0.42, 0.0, -0.9), hand: V(0.72, -0.03, -0.68), digit: V(0.82, -0.05, -0.55), innerDigit: V(0.97, -0.05, -0.24), tertial: V(1.0, -0.05, 0.2), trail: V(1, -0.08, 0) },
  fold:   { shoulder: V(0.75, -0.30, -0.42), elbow: V(-0.9, -0.12, -0.28), wrist: V(0.95, -0.05, -0.22), hand: V(1, -0.08, -0.12), digit: V(1, -0.12, -0.04), innerDigit: V(1, -0.15, 0.06), tertial: V(1, -0.2, 0.15), trail: V(0.25, -1, 0.05) },
};
const ROLE_K = { shoulder: 0, elbow: 1, wrist: 2, hand: 3, digit: 4, innerDigit: 4, tertial: 2 };
const LIMIT = { feather: 0.42, neck: 0.55, tail: 0.5 };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _m = new THREE.Matrix4();
const AX = { X: new THREE.Vector3(1, 0, 0), Y: new THREE.Vector3(0, 1, 0), Z: new THREE.Vector3(0, 0, 1) };

export class PhoenixRigController {
  constructor(rig) {
    this.rig = rig;
    const { bones, n, rest, parent } = rig;
    this.local = bones.map(() => new THREE.Quaternion());
    this.mq = bones.map(() => new THREE.Quaternion());
    this.stamp = new Int32Array(n).fill(-1);
    this.frame = 0;
    this.time = 0;
    this.enabled = true;
    // inverse rest parent model rotation (to express model-space axes in a bone's parent frame)
    this.parentRestInv = bones.map((b, i) => (parent[i] >= 0 ? rest.quat[parent[i]].clone().invert() : new THREE.Quaternion()));
    this.params = {
      posture: 0, crouch: 0, breathe: 1, lookYaw: 0, lookPitch: 0, alert: 0,
      fold: 0.7, elevation: 0.15, sweep: 0, pitch: 0, flapAmp: 0, flapPhase: 0, flexUp: 0.5,
      lag: 0.07, featherSpread: 0, tailSpread: 0.2, tailLift: 0, legTuck: 0,
      windStrength: 0.4, speed: 0, energy: 0.3,
    };
    this._prevElev = 0; this.elevVel = 0;
    this._buildWings();
    this._buildFeathers();
  }

  _buildWings() {
    const { rig } = this; const { rest } = rig;
    this.wingData = {};
    for (const s of ['R', 'L']) {
      const w = rig.wings[s]; if (!w) continue;
      const mirror = s === 'L';
      const entries = [];
      const add = (role, bone, child, full, extra = []) => {
        if (bone < 0 || child < 0) return;
        const pModel = rest.pos[child].clone().sub(rest.pos[bone]).normalize();
        const pl = rig.rest.localP[child].clone().normalize();
        let ql = null;
        if (full) {
          const c = skinCentroid(rig, bone, extra);
          if (c) {
            const sModel = c.sub(rest.pos[bone]); sModel.addScaledVector(pModel, -sModel.dot(pModel)).normalize();
            const sl = sModel.applyQuaternion(rest.quat[bone].clone().invert());
            const cl = new THREE.Vector3().crossVectors(pl, sl);
            ql = new THREE.Quaternion().setFromRotationMatrix(_m.makeBasis(pl, sl, cl)).invert();
          }
        }
        entries.push({ role, bone, child, pl, qlInv: ql, k: ROLE_K[role] });
      };
      const tertialRoots = w.branches.filter(b => b.at !== w.hand).map(b => b.root);
      add('shoulder', w.shoulder, w.elbow, true, w.branches.filter(b => b.at === w.shoulder).map(b => b.root));
      add('elbow', w.elbow, w.wrist, true, w.branches.filter(b => b.at === w.elbow).map(b => b.root));
      add('wrist', w.wrist, w.hand, true);
      add('hand', w.hand, w.digit, false);
      add('digit', w.digit, w.digitTip, false);
      add('innerDigit', w.innerDigit, w.innerDigitTip, false);
      w.branches.filter(b => b.at !== w.hand).forEach(b => { if (b.bones.length > 1) add('tertial', b.root, b.bones[1], false); });
      this.wingData[s] = { w, mirror, entries, attach: w.attach, tertialRoots };
    }
  }

  _buildFeathers() {
    const { rig } = this; const { rest, parent } = rig;
    this.featherChains = rig.chains.map(c => {
      const d = c.dir.clone().normalize();
      let a = new THREE.Vector3().crossVectors(d, AX.Y);
      if (a.lengthSq() < 0.04) a.crossVectors(d, AX.X);
      a.normalize();
      const b = new THREE.Vector3().crossVectors(d, a).normalize();
      const segs = c.bones.map(k => ({
        bone: k,
        a: a.clone().applyQuaternion(this.parentRestInv[k]),
        b: b.clone().applyQuaternion(this.parentRestInv[k]),
      }));
      // lateral sign around the body midline (tail fan) and a stable random phase
      const side = Math.sign(rest.pos[c.bones[0]].z - rig.frame.midZ) || 1;
      return { ...c, segs, side, phase: (c.id * 2.399) % (Math.PI * 2), lenN: c.bones.length };
    });
  }

  // model-space rotation of bone i from current local rotations (memoised per frame)
  modelQ(i) {
    if (this.stamp[i] === this.frame) return this.mq[i];
    const p = this.rig.parent[i];
    if (p < 0) this.mq[i].copy(this.local[i]);
    else this.mq[i].multiplyQuaternions(this.modelQ(p), this.local[i]);
    this.stamp[i] = this.frame;
    return this.mq[i];
  }

  // rotate bone i about a model-space (rest-frame) axis, pre-multiplied in its parent frame
  rot(i, axis, angle) {
    if (i < 0 || !angle) return;
    _v.copy(axis).applyQuaternion(this.parentRestInv[i]);
    _q.setFromAxisAngle(_v, angle);
    this.local[i].premultiply(_q);
  }

  update(dt) {
    const { rig, params: P } = this;
    const { bones, rest } = rig;
    this.time += dt;
    const t = this.time;
    this.frame++;
    for (let i = 0; i < rig.n; i++) this.local[i].copy(rest.localQ[i]);
    if (!this.enabled) { this._write(); return; }

    // ---------- body posture ----------
    const breath = Math.sin(t * 1.6) * 0.012 * P.breathe;
    const pitch = P.posture * 0.5 + P.crouch * 0.22 + breath;
    this.rot(rig.root, AX.Z, pitch);
    const legs = rig.legs;
    // crouch: zig-zag legs so the feet stay roughly planted; flight: tuck legs back
    for (const s of ['R', 'L']) {
      const L = legs[s]; if (!L || !L.length) continue;
      const c = P.crouch * (1 - P.legTuck);
      this.rot(L[0], AX.Z, -pitch * (1 - P.legTuck) + c * 0.35 + P.legTuck * 1.5);
      this.rot(L[1], AX.Z, -c * 0.75 - P.legTuck * 0.35);
      this.rot(L[2], AX.Z, c * 0.45 + P.legTuck * 0.3);
      if (L[3] >= 0) this.rot(L[3], AX.Z, P.legTuck * 0.4);
    }
    // ---------- neck & head ----------
    const neck = rig.neck, nN = neck.length;
    const sway = Math.sin(t * 0.7) * 0.03 + Math.sin(t * 1.9 + 1) * 0.012;
    for (let k = 0; k < nN; k++) {
      const f = (k + 1) / nN;
      const flightNeck = P.posture * (k === 0 ? 0.55 : k === 1 ? 0.25 : -0.15);
      this.rot(neck[k], AX.Z, clamp(flightNeck + P.crouch * 0.12 - pitch * 0.25 + P.lookPitch * f * 0.5 - breath * 2, -LIMIT.neck, LIMIT.neck));
      this.rot(neck[k], AX.Y, clamp(P.lookYaw * f * 0.6 + sway * f, -LIMIT.neck, LIMIT.neck));
    }
    this.rot(rig.head, AX.Z, clamp(-P.posture * 0.25 - P.lookPitch * 0.4 + P.alert * 0.1, -0.6, 0.6));
    this.rot(rig.head, AX.Y, P.lookYaw * 0.3);
    // ---------- wings ----------
    const elev = P.elevation + P.flapAmp * Math.cos(P.flapPhase * Math.PI * 2);
    this.elevVel = dt > 0 ? THREE.MathUtils.lerp(this.elevVel, (elev - this._prevElev) / dt, 0.3) : 0;
    this._prevElev = elev;
    for (const s of ['R', 'L']) if (this.wingData[s]) this._solveWing(this.wingData[s]);
    // crest follows the head (it hangs off the neck in this rig)
    this._followHead();
    // ---------- tail main chains ----------
    rig.tailChains.forEach((chain, ci) => {
      chain.forEach((b, k) => {
        const f = k / chain.length;
        const wave = Math.sin(t * (1.1 + P.speed * 0.4) - k * 0.75 + ci * 1.7) * (0.035 + 0.05 * P.windStrength) * (0.4 + f);
        const stream = -P.posture * (k === 0 ? 0.42 : 0.04) + P.tailLift * (k === 0 ? 1 : 0);
        this.rot(b, AX.Z, clamp(wave + stream, -LIMIT.tail, LIMIT.tail));
        this.rot(b, AX.Y, clamp(Math.sin(t * 0.8 - k * 0.6 + ci) * 0.03 * (1 + P.windStrength) * f, -LIMIT.tail, LIMIT.tail));
      });
    });
    // ---------- feathers (secondary motion) ----------
    this._feathers(t);
    this._write();
  }

  _wingTargets(role, k, outP, outT) {
    const P = this.params;
    const ph = P.flapPhase - P.lag * k;
    const c = Math.cos(ph * Math.PI * 2), sn = Math.sin(ph * Math.PI * 2);
    const up = Math.max(0, -sn); // upstroke half
    let fold = clamp(P.fold + P.flexUp * P.flapAmp * 1.6 * up * up * (k >= 2 ? 1 : 0.5), 0, 1);
    const e = P.elevation * (1 + 0.1 * k) + P.flapAmp * c * (1 + 0.16 * k);
    outP.copy(WING_SHAPE.spread[role]).lerp(WING_SHAPE.fold[role], fold).normalize();
    outT.copy(WING_SHAPE.spread.trail).lerp(WING_SHAPE.fold.trail, fold).normalize();
    _q.setFromAxisAngle(AX.Y, P.sweep + P.flapAmp * sn * 0.12);
    _q2.setFromAxisAngle(AX.X, e);
    _q3.multiplyQuaternions(_q2, _q);
    outP.applyQuaternion(_q3); outT.applyQuaternion(_q3);
    // angle of attack: feathering on the upstroke, bite on the downstroke
    const aoa = P.pitch + P.flapAmp * (sn * 0.35);
    _q.setFromAxisAngle(outP, aoa);
    outT.applyQuaternion(_q);
  }

  _solveWing(wd) {
    const { rig } = this;
    // targets follow the body: current attach rotation relative to rest
    const bodyDelta = _q3.copy(rig.rest.quat[wd.attach]).invert().premultiply(this.modelQ(wd.attach)).clone();
    const pT = new THREE.Vector3(), tT = new THREE.Vector3();
    for (const e of wd.entries) {
      this._wingTargets(e.role, e.k, pT, tT);
      if (wd.mirror) { pT.z = -pT.z; tT.z = -tT.z; }
      pT.applyQuaternion(bodyDelta); tT.applyQuaternion(bodyDelta);
      const parentQ = this.modelQ(this.rig.parent[e.bone]);
      let Q;
      if (e.qlInv) {
        tT.addScaledVector(pT, -tT.dot(pT)).normalize();
        _v3.crossVectors(pT, tT);
        Q = _q.setFromRotationMatrix(_m.makeBasis(pT, tT, _v3)).multiply(e.qlInv);
      } else {
        // minimal rotation from the inherited orientation (keeps twist continuous with the parent)
        _q2.multiplyQuaternions(parentQ, this.rig.rest.localQ[e.bone]);
        _v.copy(e.pl).applyQuaternion(_q2);
        Q = _q.setFromUnitVectors(_v, pT).multiply(_q2);
      }
      this.local[e.bone].copy(parentQ).invert().multiply(Q);
      this.mq[e.bone].copy(Q); this.stamp[e.bone] = this.frame;
    }
  }

  _followHead() {
    const { rig } = this;
    if (!rig.crestRoots.length) return;
    const hq = this.modelQ(rig.head);
    const delta = _q2.copy(rig.rest.quat[rig.head]).invert().premultiply(hq);
    for (const c of rig.crestRoots) {
      const want = _q3.multiplyQuaternions(delta, rig.rest.quat[c]);
      const pq = this.modelQ(rig.parent[c]);
      this.local[c].copy(pq).invert().multiply(want);
    }
  }

  _feathers(t) {
    const P = this.params; const { REGION } = PhoenixRigController;
    const flapBend = clamp(-this.elevVel * 0.06, -0.3, 0.3);
    const wind = P.windStrength, spd = P.speed;
    for (const c of this.featherChains) {
      const n = c.lenN;
      let A = 0, B = 0, flutterAmp = 0, root = 0, rootB = 0;
      switch (c.region) {
        case 1: // wing
          A = flapBend; flutterAmp = 0.02 + 0.04 * wind + 0.02 * spd; root = P.featherSpread * 0.16; break;
        case 2: // tail
          A = -P.posture * 0.02; flutterAmp = 0.03 + 0.05 * wind + 0.03 * spd; rootB = P.tailSpread * 0.12 * c.side; break;
        case 3: // crest
          A = -P.posture * 0.08 - spd * 0.05; flutterAmp = 0.05 + 0.08 * wind + 0.05 * spd; break;
        default: // back / body
          flutterAmp = 0.012 + 0.02 * wind; root = P.featherSpread * 0.1 + Math.sin(t * 1.6) * 0.01 * P.breathe;
      }
      for (let s = 0; s < n; s++) {
        const seg = c.segs[s];
        const f = (s + 1) / n;
        const fl = Math.sin(t * (3.1 + spd * 2.5) + c.phase + s * 0.9) * flutterAmp * (0.4 + f)
                 + Math.sin(t * 7.3 + c.phase * 1.7 + s * 1.3) * flutterAmp * 0.35 * f;
        const a = clamp((s === 0 ? root : 0) + A * (0.5 + f) + fl, -LIMIT.feather, LIMIT.feather);
        const b = clamp((s === 0 ? rootB : 0) + Math.sin(t * 2.3 + c.phase * 0.7 + s) * flutterAmp * 0.5 * f, -LIMIT.feather, LIMIT.feather);
        _q.setFromAxisAngle(seg.a, a); _q2.setFromAxisAngle(seg.b, b);
        this.local[seg.bone].premultiply(_q2).premultiply(_q);
      }
    }
  }

  _write() {
    const bones = this.rig.bones;
    for (let i = 0; i < bones.length; i++) bones[i].quaternion.copy(this.local[i]);
  }
}
PhoenixRigController.REGION = { BODY: 0, WING: 1, TAIL: 2, HEAD: 3, LEG: 4 };

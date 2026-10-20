// PhoenixFlightController — state machine IDLE → ANTICIPATION → TAKEOFF → FLIGHT/GLIDE →
// HOVER, expressed as pure functions of timeline time (scrub/scroll safe). Produces the
// world transform of the phoenix and the procedural rig parameters with smooth blends.
import * as THREE from 'three';
import { SEQUENCE } from '../core/Timeline.js';

export const STATES = ['IDLE', 'ANTICIPATION', 'TAKEOFF', 'FLIGHT', 'GLIDE', 'HOVER'];
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp = THREE.MathUtils.clamp;
const sm = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// base rig parameter sets per state
const BASE = {
  IDLE: { posture: 0, crouch: 0, fold: 0.8, elevation: 0.06, sweep: 0, pitch: 0, flapAmp: 0, flexUp: 0.5, featherSpread: 0, tailSpread: 0.15, tailLift: 0, legTuck: 0, energy: 0.38, freq: 0 },
  ANTICIPATION: { posture: 0.12, crouch: 0.55, fold: 0.1, elevation: 0.98, sweep: 0.14, pitch: 0.08, flapAmp: 0, flexUp: 0.5, featherSpread: 1, tailSpread: 0.7, tailLift: 0.12, legTuck: 0, energy: 0.95, freq: 0 },
  TAKEOFF: { posture: 0.55, crouch: 0, fold: 0.04, elevation: 0.2, sweep: 0.2, pitch: 0.12, flapAmp: 0.8, flexUp: 0.65, featherSpread: 0.6, tailSpread: 0.8, tailLift: 0.05, legTuck: 0.35, energy: 1.45, freq: 1.05 },
  FLIGHT: { posture: 1, crouch: 0, fold: 0.04, elevation: 0.14, sweep: 0.05, pitch: 0.02, flapAmp: 0.6, flexUp: 0.55, featherSpread: 0.2, tailSpread: 0.35, tailLift: 0, legTuck: 1, energy: 1.0, freq: 1.0 },
  GLIDE: { posture: 1, crouch: 0, fold: 0.0, elevation: 0.12, sweep: 0.0, pitch: 0.06, flapAmp: 0.025, flexUp: 0.3, featherSpread: 0.35, tailSpread: 0.55, tailLift: 0.02, legTuck: 1, energy: 0.88, freq: 0.35 },
  HOVER: { posture: 0.42, crouch: 0, fold: 0.03, elevation: 0.32, sweep: 0.26, pitch: 0.1, flapAmp: 0.72, flexUp: 0.6, featherSpread: 0.5, tailSpread: 0.85, tailLift: 0.1, legTuck: 0.25, energy: 1.12, freq: 1.25 },
};
const KEYS = Object.keys(BASE.IDLE);

// intro trajectory (relative to perch); t ∈ [takeoff start, loop start]
const PATH = [
  { t: 9.40, p: v3(0, 0, 0) },
  { t: 9.80, p: v3(-0.25, 0.75, 0.15) },
  { t: 10.45, p: v3(-1.0, 2.9, 0.5) },
  { t: 11.3, p: v3(-2.8, 5.4, 0.2) },
  { t: 12.3, p: v3(-6.4, 8.2, -2.8) },
  { t: 14.2, p: v3(-16, 12.5, -15) },
  { t: 16.4, p: v3(-25, 16.5, -34) },
  { t: 18.6, p: v3(-12, 18.5, -50) },
  { t: 20.8, p: v3(6, 14.5, -37) },
  { t: 22.7, p: v3(5.0, 7.0, -10) },
  { t: SEQUENCE.loopStart, p: v3(0.5, 4.3, 1.6) },
];
function pathAt(t, out) {
  const n = PATH.length;
  if (t <= PATH[0].t) return out.copy(PATH[0].p);
  if (t >= PATH[n - 1].t) return out.copy(PATH[n - 1].p);
  let i = 0; while (i < n - 2 && t > PATH[i + 1].t) i++;
  const a = PATH[Math.max(0, i - 1)], b = PATH[i], c = PATH[i + 1], d = PATH[Math.min(n - 1, i + 2)];
  const h = c.t - b.t, s = (t - b.t) / h, s2 = s * s, s3 = s2 * s;
  const m1 = c.p.clone().sub(a.p).multiplyScalar(h / Math.max(1e-3, c.t - a.t));
  const m2 = d.p.clone().sub(b.p).multiplyScalar(h / Math.max(1e-3, d.t - b.t));
  if (i === 0) m1.set(0, 0.2, 0);
  if (i + 1 === n - 1) { const L = loopOffset(0, new THREE.Vector3()); const L2 = loopOffset(0.05, new THREE.Vector3()); m2.copy(L2.sub(L).multiplyScalar(h / 0.05)); }
  return out.copy(b.p).multiplyScalar(2 * s3 - 3 * s2 + 1).addScaledVector(m1, s3 - 2 * s2 + s).addScaledVector(c.p, -2 * s3 + 3 * s2).addScaledVector(m2, s3 - s2);
}
// hero loop: hover above the summit, glide swoop to the right and back, flap climb
function loopOffset(tau, out) {
  const w = Math.PI * 2 / SEQUENCE.loopPeriod;
  out.set(0.5 + 1.6 * Math.sin(w * tau), 4.3 + 0.5 * Math.sin(2 * w * tau), 1.6 + 1.0 * Math.sin(w * tau + 1.2) - 1.0 * Math.sin(1.2));
  const s = Math.sin(Math.PI * clamp((tau - 9) / 9, 0, 1)); const sw = s * s;
  out.x += 7.0 * sw; out.y += -0.6 * sw + 1.4 * Math.sin(Math.PI * clamp((tau - 13) / 6, 0, 1)) ** 2; out.z += -5.0 * sw;
  return out;
}
function loopWeights(tau) {
  // HOVER 0-8.5, GLIDE 9.5-14, FLIGHT 14.8-18.5, HOVER 19.5-26
  const glide = sm(8.2, 9.8, tau) * (1 - sm(13.6, 15.0, tau));
  const flight = sm(13.6, 15.0, tau) * (1 - sm(18.2, 19.8, tau));
  return { HOVER: Math.max(0, 1 - glide - flight), GLIDE: glide, FLIGHT: flight };
}

export class PhoenixFlightController {
  constructor() {
    this.perch = new THREE.Vector3();
    this.perchFacing = v3(-0.86, 0, 0.5).normalize();
    this.manual = null; // { state, t0, anchor }
    this._p = new THREE.Vector3(); this._q = new THREE.Quaternion();
    this.out = { state: 'IDLE', weights: {}, position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), params: {}, energy: 0.4, speed: 0, flapPhase: 0 };
    this._phaseTable(); 
  }

  setManual(state, t, currentPos) { this.manual = state ? { state, t0: t, anchor: currentPos.clone() } : null; }

  weightsAt(t) {
    const W = {};
    if (this.manual) { W[this.manual.state] = 1; return W; }
    const A = SEQUENCE;
    if (t < A.loopStart) {
      const ant = sm(4.6, 6.9, t), tko = sm(9.25, 9.55, t), fl = sm(11.6, 12.8, t);
      const glide = sm(14.0, 15.3, t) * (1 - sm(18.0, 19.4, t));
      const hover = sm(21.4, 23.6, t);
      W.IDLE = 1 - ant;
      W.ANTICIPATION = ant * (1 - tko);
      W.TAKEOFF = tko * (1 - fl);
      const flight = fl * (1 - hover);
      W.FLIGHT = flight * (1 - glide); W.GLIDE = flight * glide; W.HOVER = fl * hover;
    } else Object.assign(W, loopWeights((t - A.loopStart) % A.loopPeriod));
    return W;
  }

  // cumulative flap phase (∫ frequency dt) so frequency changes never pop
  _phaseTable() {
    const dt = 1 / 60, T = SEQUENCE.loopStart + SEQUENCE.loopPeriod;
    this.ptDt = dt; this.pt = new Float32Array(Math.ceil(T / dt) + 2);
    let ph = 0;
    for (let i = 1; i < this.pt.length; i++) {
      const t = i * dt; const W = this.weightsAt(t);
      let f = 0; for (const k in W) f += (BASE[k].freq || 0) * W[k];
      // takeoff: two powerful first beats
      if (t > 9.35 && t < 11.2) f *= 1.15;
      ph += f * dt; this.pt[i] = ph;
    }
    this.loopPhase0 = this.pt[Math.round(SEQUENCE.loopStart / dt)];
    this.loopPhaseSpan = this.pt[this.pt.length - 2] - this.loopPhase0;
  }
  phaseAt(t) {
    if (t >= SEQUENCE.loopStart) {
      const k = Math.floor((t - SEQUENCE.loopStart) / SEQUENCE.loopPeriod);
      const tau = (t - SEQUENCE.loopStart) % SEQUENCE.loopPeriod;
      // keep the loop's total phase an integer so wraps are seamless
      const span = Math.round(this.loopPhaseSpan);
      const local = this._lookup(SEQUENCE.loopStart + tau) - this.loopPhase0;
      return this.loopPhase0 + k * span + local * (span / this.loopPhaseSpan);
    }
    return this._lookup(t);
  }
  _lookup(t) { const f = t / this.ptDt; const i = Math.min(this.pt.length - 2, Math.max(0, Math.floor(f))); const s = f - i; return this.pt[i] * (1 - s) + this.pt[i + 1] * s; }

  positionAt(t, out) {
    if (this.manual) return out.copy(this.manual.anchor);
    if (t < 9.4) return out.copy(this.perch);
    if (t < SEQUENCE.loopStart) return pathAt(t, out).add(this.perch);
    return loopOffset((t - SEQUENCE.loopStart) % SEQUENCE.loopPeriod, out).add(this.perch);
  }

  evaluate(t, time) {
    const o = this.out;
    const W = this.weightsAt(t);
    const P = {};
    for (const k of KEYS) { let v = 0, ws = 0; for (const s in W) { if (!W[s]) continue; v += BASE[s][k] * W[s]; ws += W[s]; } P[k] = ws > 0 ? v / ws : BASE.IDLE[k]; }
    // state-specific life
    const idleW = (W.IDLE || 0) + (W.ANTICIPATION || 0) * 0.5;
    P.lookYaw = idleW * (0.32 * Math.sin(time * 0.31) + 0.14 * Math.sin(time * 0.83 + 1.7)) + (W.ANTICIPATION || 0) * 0.15;
    P.lookPitch = idleW * 0.06 * Math.sin(time * 0.53) - (W.ANTICIPATION || 0) * 0.32;
    P.alert = W.ANTICIPATION || 0;
    // awakening beat: the head lifts before the wings open
    const wake = sm(4.0, 5.2, t) * (1 - sm(5.6, 7.0, t));
    P.lookPitch -= wake * 0.25; P.lookYaw += wake * 0.4;
    // takeoff: the first downstroke is a single powerful beat
    if (!this.manual && t > 9.2 && t < 11.4) {
      const s = sm(9.2, 9.5, t) * (1 - sm(10.9, 11.4, t));
      P.flapAmp = THREE.MathUtils.lerp(P.flapAmp, 0.95, s);
      P.energy += 0.4 * Math.exp(-Math.pow((t - 9.7) / 0.5, 2));
    }
    const phase = this.manual ? (time - this.manual.t0) * (BASE[this.manual.state].freq || 0) : this.phaseAt(t);
    P.flapPhase = phase % 1;
    o.flapPhase = P.flapPhase;
    // body bob from the wing beat (lift on the downstroke)
    const flapW = P.flapAmp;
    const bob = -Math.sin(P.flapPhase * Math.PI * 2 - 0.6) * 0.16 * flapW;
    // position
    const p = this.positionAt(t, this._p);
    if (this.manual && this.manual.state !== 'IDLE' && this.manual.state !== 'ANTICIPATION') {
      const lt = time - this.manual.t0; p.y += 2.5 * sm(0, 2, lt); p.x += Math.sin(lt * 0.5) * 1.2; p.z += Math.sin(lt * 0.3) * 0.8;
    }
    if (this.manual && (this.manual.state === 'IDLE' || this.manual.state === 'ANTICIPATION')) p.copy(this.perch);
    o.position.copy(p); o.position.y += bob;
    // velocity → heading / bank / climb
    const dt = 0.05;
    const pa = this.positionAt(t - dt, new THREE.Vector3()), pb = this.positionAt(t + dt, new THREE.Vector3());
    const vel = pb.clone().sub(pa).divideScalar(2 * dt);
    const speed = vel.length(); o.speed = speed;
    const vh = new THREE.Vector3(vel.x, 0, vel.z);
    const flying = (W.FLIGHT || 0) + (W.GLIDE || 0) + (W.TAKEOFF || 0) * 0.6;
    const hoverFacing = v3(-0.78, 0, 0.62).applyAxisAngle(v3(0, 1, 0), 0.18 * Math.sin(time * 0.21));
    let facing = this.perchFacing.clone();
    if (flying > 0.01 && vh.lengthSq() > 0.25) facing.lerp(vh.normalize(), clamp(flying * 1.2, 0, 1));
    facing.lerp(hoverFacing, (W.HOVER || 0) * (1 - flying)).normalize();
    // bank from turn rate
    const pc = this.positionAt(t + 2 * dt, new THREE.Vector3());
    const v2 = pc.clone().sub(pb).divideScalar(dt); const v1 = pb.clone().sub(this.positionAt(t, new THREE.Vector3())).divideScalar(dt);
    const turn = new THREE.Vector3().crossVectors(new THREE.Vector3(v1.x, 0, v1.z), new THREE.Vector3(v2.x, 0, v2.z)).y / Math.max(1, v1.lengthSq());
    const bank = clamp(-turn * 7.5, -0.6, 0.6) * flying + Math.sin(time * 0.7) * 0.04 * (W.GLIDE || 0);
    const climb = clamp(Math.atan2(vel.y, Math.max(1, Math.hypot(vel.x, vel.z))), -0.5, 0.6) * flying * 0.5;
    // group orientation: model forward (-Z after pivot) → facing
    const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), facing.clone().negate(), v3(0, 1, 0));
    o.quaternion.setFromRotationMatrix(m);
    o.quaternion.multiply(this._q.setFromAxisAngle(v3(1, 0, 0), -climb));
    o.quaternion.multiply(this._q.setFromAxisAngle(v3(0, 0, 1), bank));
    // speed-dependent plumage and stabilising tail
    P.speed = clamp(speed / 12, 0, 1.5);
    P.tailLift += -climb * 0.4;
    o.params = P; o.energy = P.energy; o.weights = W; o.bank = bank; o.climb = climb;
    let best = 'IDLE', bw = -1; for (const s in W) if (W[s] > bw) { bw = W[s]; best = s; }
    o.state = best;
    return o;
  }
}

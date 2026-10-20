// CinematicCamera — directed camera on a time-parameterised Hermite path. Shots frame the
// phoenix at authored screen positions (right third, negative space on the left), with
// damped tracking, true positional parallax from the pointer and terrain clearance.
import * as THREE from 'three';
import { SEQUENCE } from '../core/Timeline.js';

const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
// t, camera position (relative to perch), framing ndc of the phoenix, tracking weight, free target, fov
const KEYS = [
  { t: 0.0, c: v3(-15.5, 6.8, 52), f: [0.34, 0.02], k: 0.35, target: v3(-9, -5, -60), fov: 37 },
  { t: 4.0, c: v3(-10.8, 3.3, 22.5), f: [0.31, 0.10], k: 1, fov: 34 },
  { t: 9.4, c: v3(-8.9, 2.5, 17.0), f: [0.31, 0.05], k: 1, fov: 33.5 },
  { t: 11.0, c: v3(-8.8, 3.8, 17.2), f: [0.27, -0.04], k: 1, fov: 35 },
  { t: 13.0, c: v3(-7.4, 6.6, 15.4), f: [0.16, 0.02], k: 1, fov: 35 },
  { t: 16.0, c: v3(-6.0, 11.5, 9.0), f: [0.06, 0.02], k: 1, fov: 36 },
  { t: 19.0, c: v3(-3.0, 14.2, 3.0), f: [0.00, 0.03], k: 1, fov: 36 },
  { t: 21.6, c: v3(-9.5, 5.6, 19.0), f: [0.2, 0.12], k: 1, fov: 34.5 },
  { t: SEQUENCE.loopStart, c: v3(-11.6, 3.1, 21.5), f: [0.30, 0.22], k: 1, fov: 34 },
];

function hermite(keys, t, get, out) {
  const n = keys.length;
  if (t <= keys[0].t) return out.copy(get(keys[0]));
  if (t >= keys[n - 1].t) return out.copy(get(keys[n - 1]));
  let i = 0; while (i < n - 2 && t > keys[i + 1].t) i++;
  const k0 = keys[Math.max(0, i - 1)], k1 = keys[i], k2 = keys[i + 1], k3 = keys[Math.min(n - 1, i + 2)];
  const h = k2.t - k1.t, s = (t - k1.t) / h;
  const p1 = get(k1), p2 = get(k2);
  const m1 = get(k2).clone().sub(get(k0)).multiplyScalar(h / Math.max(1e-3, k2.t - k0.t));
  const m2 = get(k3).clone().sub(get(k1)).multiplyScalar(h / Math.max(1e-3, k3.t - k1.t));
  if (i === 0) m1.set(0, 0, 0);
  const s2 = s * s, s3 = s2 * s;
  return out.copy(p1).multiplyScalar(2 * s3 - 3 * s2 + 1).addScaledVector(m1, s3 - 2 * s2 + s).addScaledVector(p2, -2 * s3 + 3 * s2).addScaledVector(m2, s3 - s2);
}
const smooth = s => s * s * (3 - 2 * s);

export class CinematicCamera {
  constructor(aspect) {
    this.camera = new THREE.PerspectiveCamera(34, aspect, 0.3, 90000);
    this.camera.name = 'CinematicCamera';
    this.pointer = new THREE.Vector2(); this.pointerSmooth = new THREE.Vector2();
    this.parallax = 1;
    this.reducedMotion = false;
    this.perch = new THREE.Vector3();
    this.trackPos = new THREE.Vector3(); this.trackVel = new THREE.Vector3(); this.tracked = false;
    this._c = new THREE.Vector3(); this._tgt = new THREE.Vector3();
    this.sunNDC = new THREE.Vector3();
    this.free = false; // debug: orbit-free camera
  }
  setPointer(x, y) { this.pointer.set(x, y); }

  _loopCam(tau, out) {
    const w = Math.PI * 2 / SEQUENCE.loopPeriod;
    return out.copy(KEYS[KEYS.length - 1].c).add(v3(1.3 * Math.sin(w * tau), 0.45 * Math.sin(2 * w * tau + 0.6), -1.6 * (1 - Math.cos(w * tau))));
  }

  update(t, dt, birdPos, terrain) {
    const cam = this.camera;
    // damped tracking of the phoenix (ignores wing-beat bob); sub-stepped so slow frames still converge
    if (!this.tracked) { this.trackPos.copy(birdPos); this.trackVel.set(0, 0, 0); this.tracked = true; }
    const k = 16, d = 2 * Math.sqrt(k);
    let rem = Math.min(dt, 1.0);
    while (rem > 1e-5) {
      const h = Math.min(rem, 1 / 60); rem -= h;
      const acc = birdPos.clone().sub(this.trackPos).multiplyScalar(k).addScaledVector(this.trackVel, -d);
      this.trackVel.addScaledVector(acc, h); this.trackPos.addScaledVector(this.trackVel, h);
    }
    let c = this._c, framing, track, fov, freeTarget = null;
    if (t < SEQUENCE.loopStart) {
      hermite(KEYS, t, kf => kf.c, c);
      let i = 0; while (i < KEYS.length - 2 && t > KEYS[i + 1].t) i++;
      const a = KEYS[i], b = KEYS[Math.min(KEYS.length - 1, i + 1)];
      const s = smooth(THREE.MathUtils.clamp((t - a.t) / Math.max(1e-3, b.t - a.t), 0, 1));
      framing = [a.f[0] + (b.f[0] - a.f[0]) * s, a.f[1] + (b.f[1] - a.f[1]) * s];
      track = a.k + (b.k - a.k) * s; fov = a.fov + (b.fov - a.fov) * s;
      if (a.target || b.target) freeTarget = (a.target || b.target);
    } else {
      const tau = (t - SEQUENCE.loopStart) % SEQUENCE.loopPeriod;
      this._loopCam(tau, c);
      const w = Math.PI * 2 / SEQUENCE.loopPeriod;
      framing = [0.30 + 0.025 * Math.sin(w * tau + 1.1), 0.22 + 0.02 * Math.sin(2 * w * tau)];
      track = 1; fov = 34 + 0.6 * Math.sin(w * tau);
    }
    c.add(this.perch);
    // positional parallax from the pointer (camera moves, framing re-solves → real parallax)
    const pk = this.reducedMotion ? 0 : this.parallax;
    this.pointerSmooth.lerp(this.pointer, 1 - Math.exp(-dt * 2.2));
    const fwd = this.trackPos.clone().sub(c).normalize();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    c.addScaledVector(right, this.pointerSmooth.x * 0.9 * pk).y += this.pointerSmooth.y * 0.45 * pk;
    // subtle handheld drift
    if (!this.reducedMotion) { c.x += Math.sin(t * 0.31) * 0.03; c.y += Math.sin(t * 0.43 + 1) * 0.025; }
    if (terrain) { const g = terrain.heightAt(c.x, c.z); if (c.y < g + 2.2) c.y = g + 2.2; }
    cam.position.copy(c);
    cam.fov = fov; cam.updateProjectionMatrix();
    // aim so the phoenix lands on the authored screen position
    const tgt = this._aim(c, this.trackPos, framing[0], framing[1]);
    if (freeTarget && track < 1) tgt.lerp(freeTarget.clone().add(this.perch), 1 - track);
    cam.lookAt(tgt);
    cam.updateMatrixWorld();
  }

  _aim(c, b, nx, ny) {
    const cam = this.camera;
    const f = b.clone().sub(c); const dist = f.length(); f.normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const r = new THREE.Vector3().crossVectors(f, up).normalize();
    const tanV = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2), tanH = tanV * cam.aspect;
    const ax = Math.atan(nx * tanH), ay = Math.atan(ny * tanV);
    f.applyAxisAngle(up, ax);
    r.crossVectors(f, up).normalize();
    f.applyAxisAngle(r, -ay);
    return c.clone().addScaledVector(f, dist);
  }

  resize(aspect) { this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }
  snap() { this.tracked = false; }

  sunScreen(sunDir) {
    const p = this.camera.position.clone().addScaledVector(sunDir, 10000).project(this.camera);
    const vis = sunDir.dot(this.camera.getWorldDirection(new THREE.Vector3())) > 0 ? 1 : 0;
    return this.sunNDC.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5, vis);
  }
}

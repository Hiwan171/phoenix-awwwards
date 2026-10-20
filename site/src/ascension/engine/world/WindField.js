// WindField — one procedural wind shared by clouds, fire, embers, feathers, plumage and sky.
import * as THREE from 'three';
import { U } from '../core/SharedUniforms.js';
import { vnoise3 } from '../shaders/noise.glsl.js';

export class WindField {
  constructor() {
    this.baseDir = new THREE.Vector3(0.84, 0.0, 0.54).normalize();
    this.dir = this.baseDir.clone();
    this.baseSpeed = 6.5;
    this.speed = this.baseSpeed;
    this.gust = 0;
    this.displacement = new THREE.Vector3();
    this.cloudAdvection = 3.2;
    this.turbulence = 2.2;
    this.enabled = true;
  }
  update(dt, t) {
    const g = 0.5 + 0.35 * Math.sin(t * 0.37) * Math.sin(t * 0.13 + 1.3) + 0.3 * vnoise3(t * 0.21, 3.1, 0.7);
    this.gust = THREE.MathUtils.clamp(g, 0, 1.2);
    this.speed = this.enabled ? this.baseSpeed * (0.65 + 0.7 * this.gust) : 0;
    const veer = 0.18 * Math.sin(t * 0.05) + 0.08 * vnoise3(t * 0.04, 9.2, 1.1);
    this.dir.copy(this.baseDir).applyAxisAngle(new THREE.Vector3(0, 1, 0), veer);
    this.displacement.addScaledVector(this.dir, this.speed * dt * this.cloudAdvection);
    U.uWindDir.value.copy(this.dir);
    U.uWindSpeed.value = this.speed;
    U.uWindGust.value = this.gust;
    U.uWindOffset.value.copy(this.displacement).negate();
  }
  // wind velocity (m/s) at p with curl-like turbulence
  sample(p, t, out) {
    const s = 0.11, k = t * 0.35;
    const nx = vnoise3(p.x * s + k, p.y * s, p.z * s);
    const ny = vnoise3(p.x * s + 17.3, p.y * s + k, p.z * s + 5.1);
    const nz = vnoise3(p.x * s - 9.7, p.y * s + 3.3, p.z * s + k);
    const tb = this.enabled ? this.turbulence * (0.6 + this.gust) : 0;
    return out.set(this.dir.x * this.speed + nx * tb, ny * tb * 0.55 + 0.25, this.dir.z * this.speed + nz * tb);
  }
}

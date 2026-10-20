// FlameParticleSystem — procedural fire integrated with the phoenix anatomy.
//   flames: short-lived instanced billboards spawned on feather-chain tips (wings, crest,
//           tail, back), stretched along their velocity, shaded with domain-warped noise
//   embers: long-lived sparks with curl-like turbulence and velocity-aligned trails
// Both inherit the bones' motion, follow the shared wind, rise with buoyancy, are soft
// depth-tested against the scene depth buffer, and feed a heat mask for distortion.
import * as THREE from 'three';
import { U } from '../core/SharedUniforms.js';
import { NOISE_GLSL } from '../shaders/noise.glsl.js';

const VS = /* glsl */`
attribute vec3 iPos; attribute vec3 iVel; attribute vec4 iData; // age01, size, seed, kind
uniform float uStretch;
varying vec2 vUv; varying vec4 vData; varying float vViewZ; varying float vSpeed;
void main(){
  vec3 P = iPos; vec3 vel = iVel; float sp = length(vel);
  vec3 viewDir = normalize(P - cameraPosition);
  vec3 axis = sp > 1e-3 ? vel / sp : vec3(0.0, 1.0, 0.0);
  if (iData.w < 0.5) axis = normalize(mix(vec3(0.0, 1.0, 0.0), axis, 0.55));
  vec3 ay = axis - viewDir * dot(axis, viewDir);
  ay = length(ay) > 1e-4 ? normalize(ay) : vec3(0.0, 1.0, 0.0);
  vec3 ax = normalize(cross(ay, viewDir));
  float age = iData.x, size = iData.y;
  float grow = iData.w < 0.5 ? smoothstep(0.0, 0.18, age) * (1.0 - 0.45*age) : 1.0;
  float w = size * grow * (iData.w < 0.5 ? 0.85 : 0.3);
  float len = size * grow * (iData.w < 0.5 ? 1.0 + sp*0.05 : 0.5 + sp*uStretch);
  vec3 world = P + ax * position.x * w + ay * (position.y * len + (iData.w < 0.5 ? len*0.6 : -len*0.4));
  vUv = position.xy; vData = iData; vSpeed = sp;
  vec4 mv = viewMatrix * vec4(world, 1.0); vViewZ = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const FS = /* glsl */`
${NOISE_GLSL}
uniform sampler2D tDepth; uniform vec2 uResolution; uniform float uNear; uniform float uFar; uniform float uTime; uniform float uIntensity; uniform float uHeatPass;
uniform vec3 uCrimson; uniform vec3 uMolten; uniform vec3 uGold; uniform vec3 uEmber;
varying vec2 vUv; varying vec4 vData; varying float vViewZ; varying float vSpeed;
float viewZ(float d){ return (uNear * uFar) / ((uFar - uNear) * d - uFar) * -1.0; }
vec3 ramp(float h){
  vec3 c = mix(uCrimson * 0.6, uMolten, smoothstep(0.1, 0.45, h));
  c = mix(c, uGold, smoothstep(0.4, 0.75, h));
  return mix(c, uEmber * 1.2, smoothstep(0.72, 1.0, h));
}
void main(){
  float age = vData.x, seed = vData.z;
  float d = texture2D(tDepth, gl_FragCoord.xy / uResolution).x;
  float sz = viewZ(d);
  float soft = clamp((sz - vViewZ) / 0.35, 0.0, 1.0);
  if (soft <= 0.0) discard;
  vec3 col; float a;
  if (vData.w < 0.5){
    // flame tongue: teardrop with domain-warped noise, cooling with age and height
    float y = vUv.y * 0.5 + 0.5;
    vec2 q = vec2(vUv.x * 1.3, y * 1.6 - uTime * 2.6 - age * 1.5) + seed * 13.1;
    vec2 wq = q + 0.55 * vec2(fbm2(q * 1.7, 3), fbm2(q * 1.7 + 5.2, 3));
    float n = fbm2(wq * 2.1, 4) * 0.5 + 0.5;
    float wdt = mix(0.92, 0.12, pow(y, 0.75)) * (0.75 + 0.5 * n);
    float x = vUv.x + (n - 0.5) * 0.65 * y;
    float shape = smoothstep(wdt, 0.0, abs(x)) * smoothstep(1.0, 0.45 - 0.3*n, y) * smoothstep(-0.02, 0.3, y);
    float dens = shape * smoothstep(0.3, 0.8, n + 0.3 * (1.0 - y)) * 0.75;
    float temp = clamp((1.15 - age * 0.9) * (1.0 - y * 0.55) + n * 0.25, 0.0, 1.2);
    a = dens * (1.0 - smoothstep(0.55, 1.0, age));
    col = ramp(temp) * (0.6 + temp * 2.4);
  } else {
    // ember: hot core with a cooling trail
    float r = length(vec2(vUv.x * 2.2, vUv.y));
    float core = exp(-r * r * 5.0);
    float trail = smoothstep(1.0, -0.6, vUv.y) * exp(-vUv.x * vUv.x * 9.0) * 0.45;
    float flick = 0.65 + 0.35 * sin(uTime * (17.0 + seed * 11.0) + seed * 40.0);
    a = (core + trail) * flick * (1.0 - smoothstep(0.6, 1.0, age)) * smoothstep(0.0, 0.05, age);
    float temp = clamp(1.1 - age * 0.9, 0.0, 1.1);
    col = ramp(temp) * (1.4 + 3.0 * core * temp);
  }
  a *= soft;
  if (uHeatPass > 0.5){ gl_FragColor = vec4(a * (vData.w < 0.5 ? 0.6 : 0.0), 0.0, 0.0, 1.0); return; }
  gl_FragColor = vec4(col * a * uIntensity, 0.0);
}`;

class Pool {
  constructor(cap) {
    this.cap = cap; this.n = 0;
    this.pos = new Float32Array(cap * 3); this.vel = new Float32Array(cap * 3); this.data = new Float32Array(cap * 4); this.life = new Float32Array(cap);
  }
  spawn(p, v, life, size, kind) {
    if (this.n >= this.cap) return;
    const i = this.n++;
    this.pos.set([p.x, p.y, p.z], i * 3); this.vel.set([v.x, v.y, v.z], i * 3);
    this.data.set([0, size, Math.random(), kind], i * 4); this.life[i] = life;
  }
  kill(i) {
    const j = --this.n; if (i === j) return;
    this.pos.copyWithin(i * 3, j * 3, j * 3 + 3); this.vel.copyWithin(i * 3, j * 3, j * 3 + 3);
    this.data.copyWithin(i * 4, j * 4, j * 4 + 4); this.life[i] = this.life[j];
  }
}

const REGION_W = { 0: 0.22, 1: 1.0, 2: 0.62, 3: 0.75, 4: 0 };
const _p = new THREE.Vector3(), _v = new THREE.Vector3(), _w = new THREE.Vector3();

export class FlameParticleSystem {
  constructor(q, palette) {
    this.flames = new Pool(q.flames); this.embers = new Pool(q.embers);
    this.cap = q.flames + q.embers;
    const base = new THREE.PlaneGeometry(2, 2);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index; g.setAttribute('position', base.attributes.position);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aVel = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aData = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.aPos); g.setAttribute('iVel', this.aVel); g.setAttribute('iData', this.aData);
    g.instanceCount = 0;
    this.geometry = g;
    const uniforms = {
      tDepth: { value: null }, uResolution: U.uResolution, uNear: U.uNear, uFar: U.uFar, uTime: U.uTime, uIntensity: { value: 0.9 }, uStretch: { value: 0.018 },
      uCrimson: { value: palette.crimson }, uMolten: { value: palette.molten }, uGold: { value: palette.gold }, uEmber: { value: palette.ember }, uHeatPass: { value: 0 },
    };
    this.material = new THREE.ShaderMaterial({ name: 'PhoenixFire', vertexShader: VS, fragmentShader: FS, uniforms, transparent: true, depthTest: false, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, side: THREE.DoubleSide });
    this.heatMaterial = this.material.clone(); this.heatMaterial.uniforms = { ...uniforms, uHeatPass: { value: 1 } };
    this.mesh = new THREE.Mesh(g, this.material); this.mesh.frustumCulled = false; this.mesh.name = 'FlameParticles';
    this.heatMesh = new THREE.Mesh(g, this.heatMaterial); this.heatMesh.frustumCulled = false;
    this.acc = { flame: 0, ember: 0 };
    this.flamesOn = true; this.embersOn = true;
    this.burst = 0;
  }

  setDepth(tex) { this.material.uniforms.tDepth.value = tex; this.heatMaterial.uniforms.tDepth.value = tex; }

  update(dt, t, phoenix, wind, energy, speed) {
    dt = Math.min(dt, 0.05);
    const em = phoenix.emitters, ep = phoenix.emitterPos, ev = phoenix.emitterVel;
    // spawn
    const fl = this.flames, eb = this.embers;
    const flameRate = this.flamesOn ? fl.cap / 1.1 * THREE.MathUtils.clamp(0.12 + 0.45 * energy, 0, 1.2) : 0;
    const emberRate = this.embersOn ? (eb.cap / 3.2) * THREE.MathUtils.clamp(0.15 + 0.7 * energy + this.burst, 0, 2.2) : 0;
    this.burst = Math.max(0, this.burst - dt * 0.8);
    this.acc.flame += flameRate * dt; this.acc.ember += emberRate * dt;
    const pick = () => { for (let tries = 0; tries < 6; tries++) { const i = (Math.random() * em.length) | 0; if (Math.random() < REGION_W[em[i].region]) return i; } return (Math.random() * em.length) | 0; };
    const s = phoenix.root.scale.x * 2.2;
    while (this.acc.flame >= 1) {
      this.acc.flame -= 1;
      const i = pick();
      _p.copy(ep[i]).lerp(phoenix.emitterPrev[i], Math.random() * 0.3);
      _p.x += (Math.random() - 0.5) * 0.08; _p.y += (Math.random() - 0.5) * 0.08; _p.z += (Math.random() - 0.5) * 0.08;
      _v.copy(ev[i]).multiplyScalar(0.35).add(_w.set((Math.random() - 0.5) * 0.5, 0.7 + Math.random() * 0.6, (Math.random() - 0.5) * 0.5));
      const reg = em[i].region;
      fl.spawn(_p, _v, 0.3 + Math.random() * 0.45, (reg === 1 ? 0.24 : reg === 2 ? 0.2 : 0.17) * (0.7 + Math.random() * 0.7) * s / 2.2 * 0.55, 0);   // smaller tongues: her plumage carries its own fire
    }
    while (this.acc.ember >= 1) {
      this.acc.ember -= 1;
      const i = pick();
      _p.copy(ep[i]);
      _v.copy(ev[i]).multiplyScalar(0.55).add(_w.set((Math.random() - 0.5) * 1.6, 0.5 + Math.random() * 1.4, (Math.random() - 0.5) * 1.6));
      eb.spawn(_p, _v, 1.4 + Math.random() * 2.6, 0.025 + Math.random() * 0.035, 1);
    }
    // integrate
    const sim = (pool, drag, buoy, turb) => {
      for (let i = pool.n - 1; i >= 0; i--) {
        const a = pool.data[i * 4] + dt / pool.life[i];
        if (a >= 1) { pool.kill(i); continue; }
        pool.data[i * 4] = a;
        const k = i * 3;
        _p.set(pool.pos[k], pool.pos[k + 1], pool.pos[k + 2]);
        wind.sample(_p, t + pool.data[i * 4 + 2] * 10, _w);
        const vx = pool.vel[k], vy = pool.vel[k + 1], vz = pool.vel[k + 2];
        const ph = pool.data[i * 4 + 2] * 6.28 + t * 2.3;
        pool.vel[k] = vx + ((_w.x - vx) * drag + Math.sin(ph) * turb) * dt;
        pool.vel[k + 1] = vy + ((_w.y - vy) * drag + buoy + Math.cos(ph * 1.3) * turb * 0.6) * dt;
        pool.vel[k + 2] = vz + ((_w.z - vz) * drag + Math.cos(ph) * turb) * dt;
        pool.pos[k] += pool.vel[k] * dt; pool.pos[k + 1] += pool.vel[k + 1] * dt; pool.pos[k + 2] += pool.vel[k + 2] * dt;
      }
    };
    sim(fl, 2.2, 2.4, 0.8);
    sim(eb, 0.9, 0.35, 2.4);
    // upload
    const n1 = fl.n, n2 = eb.n;
    this.aPos.array.set(fl.pos.subarray(0, n1 * 3), 0); this.aPos.array.set(eb.pos.subarray(0, n2 * 3), n1 * 3);
    this.aVel.array.set(fl.vel.subarray(0, n1 * 3), 0); this.aVel.array.set(eb.vel.subarray(0, n2 * 3), n1 * 3);
    this.aData.array.set(fl.data.subarray(0, n1 * 4), 0); this.aData.array.set(eb.data.subarray(0, n2 * 4), n1 * 4);
    const cnt = n1 + n2;
    for (const a of [this.aPos, this.aVel, this.aData]) { a.clearUpdateRanges(); a.addUpdateRange(0, cnt * a.itemSize); a.needsUpdate = true; }
    this.geometry.instanceCount = cnt;
    this.count = cnt;
  }
}

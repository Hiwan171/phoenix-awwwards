// FeatherParticleSystem — instanced 3D feathers (curved rachis + vanes) with drag, reduced
// gravity, flutter, tumbling rotation and wind; lit by the shared sun/sky, they burn away
// from the edge as they age (glowing dissolve). A few ambient feathers drift close to the
// camera for parallax. Rendered in the opaque pass so clouds and depth stay correct.
import * as THREE from 'three';
import { U } from '../core/SharedUniforms.js';
import { NOISE_GLSL } from '../shaders/noise.glsl.js';
import { ATMOSPHERE_GLSL } from '../world/AtmosphereShader.js';

function featherGeometry() {
  const segV = 12, cols = [-1, -0.5, 0, 0.5, 1];
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= segV; i++) {
    const v = i / segV;
    const w = 0.2 * Math.pow(Math.sin(Math.PI * Math.pow(v, 0.72)), 0.9) + 0.012;
    for (const u of cols) {
      const x = u * w * (u < 0 ? 0.82 : 1.0);
      const z = 0.07 * v * v + 0.035 * u * u * w * 5 - 0.02 * Math.sin(v * 3.1);
      pos.push(x, v, z); uv.push(u, v);
    }
  }
  const C = cols.length;
  for (let i = 0; i < segV; i++) for (let j = 0; j < C - 1; j++) {
    const a = i * C + j, b = a + 1, c = a + C, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _w = new THREE.Vector3(), _n = new THREE.Vector3(), _t = new THREE.Vector3();

export class FeatherParticleSystem {
  constructor(q, palette) {
    this.cap = q.feathers;
    this.items = [];
    const g = featherGeometry();
    this.aData = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iData', this.aData);
    this.material = new THREE.ShaderMaterial({
      name: 'FeatherParticles', side: THREE.DoubleSide,
      uniforms: { ...U, uCrimson: { value: palette.crimson }, uCopper: { value: palette.copper }, uGold: { value: palette.gold }, uEmber: { value: palette.ember }, uMolten: { value: palette.molten } },
      vertexShader: /* glsl */`
        attribute vec4 iData; varying vec2 vUv; varying vec4 vData; varying vec3 vN; varying vec3 vW;
        void main(){
          vUv = uv; vData = iData;
          mat3 im = mat3(instanceMatrix);
          vN = normalize(im * normal);
          vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0); vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */`
        ${NOISE_GLSL}
        ${ATMOSPHERE_GLSL}
        uniform vec3 uCamPos; uniform vec3 uCrimson; uniform vec3 uCopper; uniform vec3 uGold; uniform vec3 uEmber; uniform vec3 uMolten;
        varying vec2 vUv; varying vec4 vData; varying vec3 vN; varying vec3 vW;
        void main(){
          float age = vData.x, seed = vData.y, glow = vData.z;
          float u = vUv.x, v = vUv.y;
          // vane outline with notches; barbs angled along the rachis
          float edge = 0.9 + 0.1 * vnoise(vec2(v * 34.0, seed * 50.0 + sign(u) * 7.0));
          if (abs(u) > edge || v > 0.985) discard;
          float burn = smoothstep(0.62, 1.0, age);
          float bn = vnoise(vec2(u * 4.0, v * 9.0) + seed * 31.0) * 0.5 + 0.5;
          float thr = burn * 1.15 - (1.0 - abs(u)) * 0.25 * burn;
          if (bn < thr) discard;
          float rim = 1.0 - smoothstep(0.0, 0.08, bn - thr);
          float barbs = 0.75 + 0.25 * sin((v * 70.0 + abs(u) * 28.0) + seed * 9.0);
          float rach = smoothstep(0.08, 0.0, abs(u));
          vec3 alb = mix(uCrimson, uCopper, smoothstep(0.1, 0.6, v + seed * 0.2));
          alb = mix(alb, uGold * 0.85, smoothstep(0.55, 1.0, v) * 0.7 + smoothstep(0.75, 1.0, abs(u)) * 0.35);
          alb *= barbs; alb = mix(alb, uGold * 0.6, rach * 0.6);
          vec3 N = normalize(gl_FrontFacing ? vN : -vN);
          vec3 V = normalize(vW - uCamPos); float dist = length(vW - uCamPos);
          float ndl = dot(N, uSunDir);
          float back = pow(max(dot(V, uSunDir), 0.0), 3.0);
          vec3 col = alb * (uSunRadiance * max(ndl, 0.0) + uSkyAmbient * (0.6 + 0.4 * N.y) + uHorizonAmbient * 0.35);
          col += alb * uSunRadiance * (0.25 + 1.8 * back) * 0.6; // thin vane translucency
          float tipGlow = smoothstep(0.7, 1.0, v) * glow + smoothstep(0.8, 1.0, abs(u)) * glow * 0.6;
          col += mix(uMolten, uEmber, tipGlow) * (tipGlow * 2.2 + rim * burn * 9.0);
          col = aerial(col, uCamPos, V, dist);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.mesh = new THREE.InstancedMesh(g, this.material, this.cap);
    this.mesh.name = 'FeatherParticles'; this.mesh.frustumCulled = false; this.mesh.count = 0;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.enabled = true;
    this.burstQueue = 0;
    this.ambientTimer = 0;
  }

  spawn(p, v, size, life, glow, ambient = false) {
    if (this.items.length >= this.cap) return;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28));
    this.items.push({ p: p.clone(), v: v.clone(), q, size, life, age: 0, seed: Math.random(), glow, ambient, w: new THREE.Vector3((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 3) });
  }

  burst(n) { this.burstQueue += n; }

  update(dt, t, phoenix, wind, camera, rate) {
    dt = Math.min(dt, 0.05);
    if (this.enabled && phoenix) {
      const em = phoenix.emitters;
      let want = this.burstQueue + rate * dt;
      while (want >= 1 || (want > 0 && Math.random() < want)) {
        want -= 1; this.burstQueue = Math.max(0, this.burstQueue - 1);
        let i = (Math.random() * em.length) | 0;
        for (let k = 0; k < 6 && em[i].region !== 1 && em[i].region !== 2; k++) i = (Math.random() * em.length) | 0;
        const v = phoenix.emitterVel[i].clone().multiplyScalar(0.25).add(new THREE.Vector3((Math.random() - 0.5) * 1.5, Math.random() * 1.2, (Math.random() - 0.5) * 1.5));
        this.spawn(phoenix.emitterPos[i], v, 0.32 + Math.random() * 0.35, 4.5 + Math.random() * 4, 0.55 + Math.random() * 0.45);
      }
    }
    // ambient parallax feathers near the camera, released upstream of the wind
    this.ambientTimer -= dt;
    if (this.enabled && camera && this.ambientTimer <= 0 && this.items.filter(f => f.ambient).length < 3) {
      this.ambientTimer = 2.5 + Math.random() * 3;
      const fwd = camera.getWorldDirection(new THREE.Vector3());
      const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
      const d = 3.5 + Math.random() * 7;
      const p = camera.position.clone().addScaledVector(fwd, d).addScaledVector(right, -d * 0.9 - 2).add(new THREE.Vector3(0, (Math.random() - 0.3) * d * 0.4, 0));
      this.spawn(p, wind.dir.clone().multiplyScalar(wind.speed * 0.6), 0.28 + Math.random() * 0.2, 7 + Math.random() * 3, 0.35, true);
    }
    // integrate
    for (let i = this.items.length - 1; i >= 0; i--) {
      const f = this.items[i];
      f.age += dt / f.life;
      if (f.age >= 1) { this.items.splice(i, 1); continue; }
      wind.sample(f.p, t + f.seed * 20, _w);
      _n.set(0, 0, 1).applyQuaternion(f.q);
      const flutter = Math.sin(t * (2.2 + f.seed * 1.5) + f.seed * 40) * 1.6;
      f.v.x += ((_w.x - f.v.x) * 1.5 + _n.x * flutter) * dt;
      f.v.y += ((_w.y - f.v.y) * 1.5 - 1.15 + _n.y * flutter * 0.6) * dt;
      f.v.z += ((_w.z - f.v.z) * 1.5 + _n.z * flutter) * dt;
      f.p.addScaledVector(f.v, dt);
      _e.set((Math.sin(t * 1.7 + f.seed * 9) * 2.2 + f.w.x) * dt, (0.8 + Math.sin(t * 0.9 + f.seed * 5) * 1.6 + f.w.y) * dt, (Math.cos(t * 2.3 + f.seed * 3) * 1.6 + f.w.z) * dt);
      f.q.multiply(_q.setFromEuler(_e));
    }
    const n = this.items.length;
    for (let i = 0; i < n; i++) {
      const f = this.items[i];
      const sc = f.size * Math.min(1, f.age * 12);
      _m.compose(f.p, f.q, _s.set(sc, sc, sc));
      this.mesh.setMatrixAt(i, _m);
      this.aData.array.set([f.age, f.seed, f.glow, 0], i * 4);
    }
    this.mesh.count = n; this.count = n;
    this.mesh.instanceMatrix.needsUpdate = true; this.aData.needsUpdate = true;
  }
}

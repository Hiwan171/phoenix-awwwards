// AtmosphereShader — physically inspired sky (single scattering Rayleigh + Mie + ozone
// with a multiple-scattering approximation) baked into a sky-view LUT, plus the shared
// aerial-perspective model used by terrain, water, clouds and FX.
import * as THREE from 'three';
import { U } from '../core/SharedUniforms.js';
import { NOISE_GLSL } from '../shaders/noise.glsl.js';

export const ATMO = {
  planetR: 6360e3, atmoR: 6460e3,
  rayleigh: [5.802e-6, 13.558e-6, 33.1e-6], HR: 8000,
  mieScat: 3.996e-6, mieExt: 4.4e-6, HM: 1200, g: 0.78,
  ozone: [0.65e-6, 1.881e-6, 0.085e-6],
  haze: 3.4, sunIntensity: 16, groundAlbedo: 0.18, ms: 0.35,
};

const LUT_GLSL = /* glsl */`
precision highp float;
uniform vec3 uSun; uniform float uObsAlt; uniform float uHaze; uniform float uIntensity; uniform float uMS;
uniform vec3 uRay; uniform float uMieS; uniform float uMieE; uniform vec3 uOz; uniform float uG; uniform float uAlbedo;
varying vec2 vUv;
#define RP ${ATMO.planetR.toFixed(1)}
#define RA ${ATMO.atmoR.toFixed(1)}
#define PI 3.141592653589793
float rsFar(vec3 ro, vec3 rd, float r){ float b = dot(ro, rd), c = dot(ro, ro) - r*r, d = b*b - c; return d < 0.0 ? -1.0 : -b + sqrt(d); }
float rsNear(vec3 ro, vec3 rd, float r){ float b = dot(ro, rd), c = dot(ro, ro) - r*r, d = b*b - c; if (d < 0.0) return -1.0; float t = -b - sqrt(d); return t > 0.0 ? t : -1.0; }
vec3 dens(float h){ return vec3(exp(-h/${ATMO.HR.toFixed(1)}), exp(-h/${ATMO.HM.toFixed(1)}), max(0.0, 1.0 - abs(h - 25000.0)/15000.0)); }
vec3 ext(vec3 d){ return uRay*d.x + vec3(uMieE*uHaze)*d.y + uOz*d.z; }
vec3 sunT(vec3 p){
  if (rsNear(p, uSun, RP) > 0.0) return vec3(0.0);
  float tt = rsFar(p, uSun, RA); float dt = tt/16.0; vec3 od = vec3(0.0);
  for (int i = 0; i < 16; i++){ vec3 q = p + uSun*(float(i)+0.5)*dt; od += ext(dens(length(q) - RP))*dt; }
  return exp(-od);
}
float csPhase(float mu, float g){ float k = 3.0/(8.0*PI)*(1.0-g*g)/(2.0+g*g); return k*(1.0+mu*mu)/pow(1.0+g*g-2.0*g*mu, 1.5); }
void main(){
  // u: azimuth from the sun (0..PI), v: elevation with horizon-dense mapping
  float az = vUv.x * PI;
  float s = vUv.y * 2.0 - 1.0; float el = sign(s) * s * s * PI * 0.5;
  vec3 sunH = normalize(vec3(uSun.x, 0.0, uSun.z)); vec3 side = normalize(cross(vec3(0.0,1.0,0.0), sunH));
  vec3 rd = normalize(cos(el) * (cos(az) * sunH + sin(az) * side) + vec3(0.0, sin(el), 0.0));
  vec3 ro = vec3(0.0, RP + uObsAlt, 0.0);
  float tG = rsNear(ro, rd, RP); float tA = rsFar(ro, rd, RA);
  float tMax = min(tG > 0.0 ? tG : tA, 600e3);
  float mu = dot(rd, uSun);
  float pr = 3.0/(16.0*PI)*(1.0+mu*mu), pm = csPhase(mu, uG);
  vec3 L = vec3(0.0), T = vec3(1.0);
  const int N = 48; float tPrev = 0.0;
  for (int i = 0; i < N; i++){
    float tc = tMax * pow((float(i)+1.0)/float(N), 2.2);
    float dt = tc - tPrev; float tm = tPrev + dt*0.5; tPrev = tc;
    vec3 p = ro + rd*tm; float h = length(p) - RP;
    vec3 d = dens(h); vec3 e = ext(d);
    vec3 st = sunT(p);
    vec3 sR = uRay*d.x, sM = vec3(uMieS*uHaze*d.y);
    float lit = clamp(dot(normalize(p), uSun)*8.0 + 0.6, 0.0, 1.0);
    vec3 S = (sR*pr + sM*pm) * st + (sR + sM) * uMS * 0.08 * lit;
    vec3 segT = exp(-e*dt);
    L += T * (S - S*segT) / max(e, vec3(1e-12));
    T *= segT;
  }
  if (tG > 0.0){ vec3 pg = ro + rd*tG; vec3 n = normalize(pg); L += T * uAlbedo / PI * max(dot(n, uSun), 0.0) * sunT(pg + n*10.0) * 0.6; }
  gl_FragColor = vec4(L * uIntensity, dot(T, vec3(0.333)));
}`;

// sky / aerial perspective chunk (needs U uniforms declared)
export const ATMOSPHERE_GLSL = /* glsl */`
uniform sampler2D uSkyLUT; uniform vec3 uSunDir; uniform vec3 uSunRadiance; uniform vec3 uSkyAmbient; uniform vec3 uHorizonAmbient;
uniform vec3 uBetaR; uniform vec3 uBetaM; uniform float uObsAlt; uniform vec4 uValleyFog; uniform float uAerialScale; uniform float uAtmosphereOn;
#ifndef PI
#define PI 3.141592653589793
#endif
vec2 skyUV(vec3 rd){
  vec2 sh = normalize(uSunDir.xz); float lh = length(rd.xz);
  float ca = lh > 1e-5 ? dot(rd.xz / lh, sh) : 1.0;
  float az = acos(clamp(ca, -1.0, 1.0)) / PI;
  float el = asin(clamp(rd.y, -1.0, 1.0));
  float v = 0.5 + 0.5 * sign(el) * sqrt(abs(el) / (PI * 0.5));
  return vec2(az, v);
}
vec3 skyRadiance(vec3 rd){ return texture2D(uSkyLUT, skyUV(rd)).rgb; }
vec3 fogColor(vec3 rd){ return skyRadiance(normalize(vec3(rd.x, max(rd.y, 0.012), rd.z))); }
float expInt(float a, float b, float d, float H){
  float e0 = exp(clamp(-a / H, -80.0, 80.0));
  if (abs(b) < 1e-5) return e0 * d;
  return e0 * H / b * (1.0 - exp(clamp(-b * d / H, -80.0, 80.0)));
}
vec3 opticalDepth(vec3 ro, vec3 rd, float d){
  float a = ro.y + uObsAlt;
  vec3 od = uBetaR * expInt(a, rd.y, d, 8000.0) + uBetaM * expInt(a, rd.y, d, 1200.0);
  od += vec3(uValleyFog.x) * expInt(ro.y - uValleyFog.z, rd.y, d, uValleyFog.y);
  return od * uAerialScale;
}
vec3 aerialT(vec3 ro, vec3 rd, float d){ return exp(-opticalDepth(ro, rd, d)); }
vec3 aerial(vec3 col, vec3 ro, vec3 rd, float d){
  if (uAtmosphereOn < 0.5) return col;
  vec3 T = aerialT(ro, rd, d);
  return col * T + fogColor(rd) * (1.0 - T);
}
float hgPhase(float mu, float g){ float g2 = g*g; return (1.0 - g2) / (4.0*PI*pow(max(1.0 + g2 - 2.0*g*mu, 1e-4), 1.5)); }
`;

const FS_VERT = /* glsl */`varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
export function fullscreenGeometry() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  return g;
}
export const FS_VERTEX = FS_VERT;

export class AtmosphereShader {
  constructor(renderer) {
    this.renderer = renderer;
    this.lut = new THREE.WebGLRenderTarget(256, 160, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter, depthBuffer: false, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping });
    this.lutMat = new THREE.ShaderMaterial({
      vertexShader: FS_VERT, fragmentShader: LUT_GLSL, depthTest: false, depthWrite: false,
      uniforms: {
        uSun: { value: new THREE.Vector3() }, uObsAlt: { value: U.uObsAlt.value }, uHaze: { value: ATMO.haze }, uIntensity: { value: ATMO.sunIntensity },
        uMS: { value: ATMO.ms }, uRay: { value: new THREE.Vector3(...ATMO.rayleigh) }, uMieS: { value: ATMO.mieScat }, uMieE: { value: ATMO.mieExt },
        uOz: { value: new THREE.Vector3(...ATMO.ozone) }, uG: { value: ATMO.g }, uAlbedo: { value: ATMO.groundAlbedo },
      },
    });
    this.quad = new THREE.Mesh(fullscreenGeometry(), this.lutMat); this.quad.frustumCulled = false;
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    U.uSkyLUT.value = this.lut.texture;
    this.skyMaterial = this._skyMaterial();
    this.skyMesh = new THREE.Mesh(fullscreenGeometry(), this.skyMaterial);
    this.skyMesh.frustumCulled = false; this.skyMesh.renderOrder = -1000; this.skyMesh.name = 'AtmosphereSky';
  }

  // sun transmittance at the observer (CPU mirror of the LUT model) → lighting colour
  _sunTransmittance(sun) {
    const RP = ATMO.planetR, RA = ATMO.atmoR;
    const ro = [0, RP + U.uObsAlt.value, 0];
    const b = ro[1] * sun.y, c = ro[1] * ro[1] - RA * RA; const tt = -b + Math.sqrt(b * b - c);
    const N = 96, dt = tt / N; const od = [0, 0, 0];
    for (let i = 0; i < N; i++) {
      const t = (i + 0.5) * dt; const px = sun.x * t, py = ro[1] + sun.y * t, pz = sun.z * t;
      const h = Math.hypot(px, py, pz) - RP;
      const dr = Math.exp(-h / ATMO.HR), dm = Math.exp(-h / ATMO.HM), dz = Math.max(0, 1 - Math.abs(h - 25000) / 15000);
      for (let k = 0; k < 3; k++) od[k] += (ATMO.rayleigh[k] * dr + ATMO.mieExt * ATMO.haze * dm + ATMO.ozone[k] * dz) * dt;
    }
    return od.map(v => Math.exp(-v));
  }

  update(sunDir) {
    const sun = sunDir.clone().normalize();
    U.uSunDir.value.copy(sun);
    this.lutMat.uniforms.uSun.value.copy(sun);
    const prev = this.renderer.getRenderTarget();
    this.quad.material = this.lutMat;
    this.renderer.setRenderTarget(this.lut); this.renderer.render(this.quad, this.cam);
    this.renderer.setRenderTarget(prev);
    const T = this._sunTransmittance(sun);
    const I = 5.2;
    U.uSunRadiance.value.set(T[0] * I, T[1] * I, T[2] * I);
    // extinction coefficients for aerial perspective (sea-level betas; altitude handled analytically)
    U.uBetaR.value.set(...ATMO.rayleigh);
    U.uBetaM.value.setScalar(ATMO.mieExt * ATMO.haze);
    // ambient irradiance estimates: CPU mirror of the LUT integrator over a few directions
    const avg = dirs => { const a = [0, 0, 0]; dirs.forEach(d => { const L = this._skyCPU(d, sun); a[0] += L[0]; a[1] += L[1]; a[2] += L[2]; }); return a.map(v => v / dirs.length); };
    const zenDirs = [], horDirs = [];
    const sunAz = Math.atan2(sun.z, sun.x);
    for (const el of [0.35, 0.8, 1.25]) for (let k = 0; k < 6; k++) { const az = sunAz + k * Math.PI / 3; zenDirs.push(new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az))); }
    zenDirs.push(new THREE.Vector3(0, 1, 0));
    for (let k = 0; k < 8; k++) { const az = sunAz + k * Math.PI / 4; horDirs.push(new THREE.Vector3(Math.cos(az), 0.05, Math.sin(az)).normalize()); }
    const zen = avg(zenDirs), hor = avg(horDirs);
    if (zen.every(Number.isFinite)) { U.uSkyAmbient.value.set(...zen); U.uHorizonAmbient.value.set(...hor); }
    this.ambientSampled = { zenith: zen, horizon: hor, sun: T };
  }

  _skyCPU(rd, sun) {
    const RP = ATMO.planetR, RA = ATMO.atmoR, oy = RP + U.uObsAlt.value;
    const far = (o, d, r) => { const b = o[0] * d.x + o[1] * d.y + o[2] * d.z, c = o[0] * o[0] + o[1] * o[1] + o[2] * o[2] - r * r, q = b * b - c; return q < 0 ? -1 : -b + Math.sqrt(q); };
    const near = (o, d, r) => { const b = o[0] * d.x + o[1] * d.y + o[2] * d.z, c = o[0] * o[0] + o[1] * o[1] + o[2] * o[2] - r * r, q = b * b - c; if (q < 0) return -1; const t = -b - Math.sqrt(q); return t > 0 ? t : -1; };
    const dens = h => [Math.exp(-h / ATMO.HR), Math.exp(-h / ATMO.HM), Math.max(0, 1 - Math.abs(h - 25000) / 15000)];
    const ext = d => ATMO.rayleigh.map((r, k) => r * d[0] + ATMO.mieExt * ATMO.haze * d[1] + ATMO.ozone[k] * d[2]);
    const sunT = p => { if (near(p, sun, RP) > 0) return [0, 0, 0]; const tt = far(p, sun, RA), dt = tt / 8; const od = [0, 0, 0]; for (let i = 0; i < 8; i++) { const t = (i + 0.5) * dt; const q = [p[0] + sun.x * t, p[1] + sun.y * t, p[2] + sun.z * t]; const e = ext(dens(Math.hypot(...q) - RP)); for (let k = 0; k < 3; k++) od[k] += e[k] * dt; } return od.map(v => Math.exp(-v)); };
    const ro = [0, oy, 0];
    const tG = near(ro, rd, RP), tA = far(ro, rd, RA); const tMax = Math.min(tG > 0 ? tG : tA, 600e3);
    const mu = rd.x * sun.x + rd.y * sun.y + rd.z * sun.z, g = ATMO.g;
    const pr = 3 / (16 * Math.PI) * (1 + mu * mu), pm = 3 / (8 * Math.PI) * (1 - g * g) / (2 + g * g) * (1 + mu * mu) / Math.pow(1 + g * g - 2 * g * mu, 1.5);
    const L = [0, 0, 0], T = [1, 1, 1]; const N = 24; let tPrev = 0;
    for (let i = 0; i < N; i++) {
      const tc = tMax * Math.pow((i + 1) / N, 2.2), dt = tc - tPrev, tm = tPrev + dt * 0.5; tPrev = tc;
      const p = [rd.x * tm, oy + rd.y * tm, rd.z * tm]; const r = Math.hypot(...p); const h = r - RP;
      const d = dens(h), e = ext(d), st = sunT(p);
      const lit = Math.min(1, Math.max(0, (p[0] * sun.x + p[1] * sun.y + p[2] * sun.z) / r * 8 + 0.6));
      for (let k = 0; k < 3; k++) {
        const sR = ATMO.rayleigh[k] * d[0], sM = ATMO.mieScat * ATMO.haze * d[1];
        const S = (sR * pr + sM * pm) * st[k] + (sR + sM) * ATMO.ms * 0.08 * lit;
        const segT = Math.exp(-e[k] * dt);
        L[k] += T[k] * (S - S * segT) / Math.max(e[k], 1e-12); T[k] *= segT;
      }
    }
    return L.map(v => v * ATMO.sunIntensity);
  }

  _skyMaterial() {
    return new THREE.ShaderMaterial({
      name: 'AtmosphereSky',
      depthTest: false, depthWrite: false,
      uniforms: { ...U, uCirrus: { value: 1 }, uSunSize: { value: 0.0075 } },
      vertexShader: /* glsl */`
        uniform mat4 uInvProj; uniform mat4 uCamWorld; varying vec3 vDir;
        void main(){ vec4 v = uInvProj * vec4(position.xy, 1.0, 1.0); vDir = (uCamWorld * vec4(v.xyz / v.w, 0.0)).xyz; gl_Position = vec4(position.xy, 1.0, 1.0); }`,
      fragmentShader: /* glsl */`
        ${NOISE_GLSL}
        uniform float uTime; uniform vec3 uWindOffset; uniform float uCirrus; uniform float uSunSize; uniform vec2 uResolution; uniform float uFrame;
        ${ATMOSPHERE_GLSL}
        varying vec3 vDir;
        void main(){
          vec3 rd = normalize(vDir);
          vec3 col = uAtmosphereOn > 0.5 ? skyRadiance(rd) : mix(vec3(0.35,0.3,0.32), vec3(0.08,0.12,0.22), clamp(rd.y*2.0,0.0,1.0));
          float mu = dot(rd, uSunDir);
          // sun disk with limb darkening (HDR, drives bloom + light shafts)
          float sd = acos(clamp(mu, -1.0, 1.0));
          float disk = smoothstep(uSunSize, uSunSize*0.82, sd);
          float limb = sqrt(max(0.0, 1.0 - pow(sd/uSunSize, 2.0)));
          col += uSunRadiance * disk * (0.55 + 0.45*limb) * 90.0;
          col += uSunRadiance * (hgPhase(mu, 0.96) * 0.06 + hgPhase(mu, 0.86) * 0.05);
          // high-altitude cirrus / altocumulus layer (2D procedural, lit by the shared sun)
          if (uCirrus > 0.5 && rd.y > 0.0){
            float t = 6500.0 / max(rd.y, 0.02);
            vec2 p = rd.xz * t + uWindOffset.xz * 3.0;
            vec2 q = p * 0.000085; q = vec2(q.x*0.55 + q.y*0.35, q.y*1.25 - q.x*0.2);
            float n = fbm2(q + 0.35*vec2(fbm2(q*0.5, 3), fbm2(q*0.5 + 4.1, 3)), 6) * 0.5 + 0.5;
            float cov = smoothstep(0.50, 0.78, n) * smoothstep(0.015, 0.22, rd.y) * (1.0 - smoothstep(0.55, 0.95, rd.y));
            float thick = smoothstep(0.55, 0.95, n);
            vec3 lit = uSunRadiance * (0.5 + 6.0*hgPhase(mu, 0.7) + 0.8*thick) + uSkyAmbient * 0.9;
            vec3 cc = mix(lit, uHorizonAmbient * 0.7 + uSunRadiance * 0.15, thick * 0.55);
            float atten = exp(-t * 0.000018);
            col = mix(col, mix(col, cc, atten), cov * 0.82);
          }
          col += (hash12(gl_FragCoord.xy + fract(uFrame*0.618)*100.0) - 0.5) / 255.0;
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
  }
}

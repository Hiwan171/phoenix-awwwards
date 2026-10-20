// VolumetricClouds — shader-driven volumetric clouds.
//   • tileable Perlin-Worley 3D noise (128³, GPU-generated) + weather map (coverage/type)
//   • three layers: valley-filling sea of clouds, orographic corridors hugging slopes,
//     sparse towering cumulus near the horizon
//   • ray march with blue-noise temporal dithering, Beer-Lambert transmittance, dual-lobe
//     Henyey-Greenstein phase, multi-scattering octaves, light march self-shadowing,
//     terrain shadowing via the baked shadow-height map, aerial perspective per sample
//   • reduced-resolution render, temporal reprojection with neighbourhood clamping,
//     depth-aware (bilateral) upsampling and composition against the scene depth buffer
import * as THREE from 'three';
import { U } from '../core/SharedUniforms.js';
import { NOISE_GLSL } from '../shaders/noise.glsl.js';
import { ATMOSPHERE_GLSL, fullscreenGeometry } from './AtmosphereShader.js';

const VS = /* glsl */`varying vec2 vUv; void main(){ vUv = position.xy*0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const NOISE3D_FS = /* glsl */`
precision highp float;
uniform float uSlice; uniform float uSize;
vec3 h33(vec3 p){ p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
float worley(vec3 p, float per){
  vec3 id = floor(p), f = fract(p); float md = 1.0;
  for (int k = -1; k <= 1; k++) for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++){
    vec3 o = vec3(float(i), float(j), float(k));
    vec3 r = o + h33(mod(id + o, per)) - f; md = min(md, dot(r, r));
  }
  return 1.0 - sqrt(md);
}
float gnoise(vec3 p, float per){
  vec3 i = floor(p), f = fract(p); vec3 u = f*f*f*(f*(f*6.0 - 15.0) + 10.0);
  float n = 0.0;
  float v[8];
  for (int c = 0; c < 8; c++){
    vec3 o = vec3(float(c & 1), float((c >> 1) & 1), float((c >> 2) & 1));
    vec3 g = normalize(h33(mod(i + o, per)) * 2.0 - 1.0);
    v[c] = dot(g, f - o);
  }
  return mix(mix(mix(v[0], v[1], u.x), mix(v[2], v[3], u.x), u.y), mix(mix(v[4], v[5], u.x), mix(v[6], v[7], u.x), u.y), u.z);
}
float remap(float v, float a, float b, float c, float d){ return c + (v - a) * (d - c) / (b - a); }
void main(){
  vec3 p = vec3(gl_FragCoord.xy, uSlice + 0.5) / uSize;
  float pf = gnoise(p*4.0, 4.0)*0.6 + gnoise(p*8.0, 8.0)*0.28 + gnoise(p*16.0, 16.0)*0.12;
  pf = clamp(pf*0.9 + 0.5, 0.0, 1.0);
  float w1 = worley(p*4.0, 4.0), w2 = worley(p*8.0, 8.0), w3 = worley(p*16.0, 16.0), w4 = worley(p*32.0, 32.0);
  float wf = w1*0.625 + w2*0.25 + w3*0.125;
  float pw = clamp(remap(pf, 0.0, 1.0, wf, 1.0), 0.0, 1.0);
  gl_FragColor = vec4(pw, wf, w2*0.625 + w3*0.25 + w4*0.125, w3*0.625 + w4*0.375);
}`;

const WEATHER_FS = /* glsl */`
precision highp float;
${NOISE_GLSL}
varying vec2 vUv;
vec2 hh(vec2 p){ return hash22(p); }
float wor2(vec2 p, float per){ vec2 id = floor(p), f = fract(p); float md = 1.0; for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++){ vec2 o = vec2(float(i), float(j)); vec2 r = o + hh(mod(id + o, per)) - f; md = min(md, dot(r, r)); } return 1.0 - sqrt(md); }
float tn(vec2 p, float per){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0 - 2.0*f);
  float a = hash12(mod(i, per)), b = hash12(mod(i + vec2(1.0, 0.0), per)), c = hash12(mod(i + vec2(0.0, 1.0), per)), d = hash12(mod(i + vec2(1.0, 1.0), per));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y); }
float tfbm(vec2 p, float per){ float a = 0.0, b = 0.5; for (int i = 0; i < 6; i++){ a += b*tn(p, per); p *= 2.0; per *= 2.0; b *= 0.5; } return a / 0.984; }
void main(){
  vec2 p = vUv;
  float base = tfbm(p*6.0, 6.0);
  float cells = wor2(p*10.0, 10.0)*0.6 + wor2(p*22.0, 22.0)*0.4;
  float sea = smoothstep(0.30, 0.62, base*0.75 + cells*0.35);
  float top = tfbm(p*14.0 + 3.0, 14.0);
  float corr = smoothstep(0.42, 0.7, tfbm(p*9.0 + 7.0, 9.0)*0.7 + wor2(p*30.0, 30.0)*0.4);
  float cu = smoothstep(0.66, 0.86, tfbm(p*5.0 + 11.0, 5.0)*0.6 + wor2(p*12.0, 12.0)*0.5);
  gl_FragColor = vec4(sea, top, corr, cu);
}`;

const MARCH_FS = /* glsl */`
precision highp float; precision highp sampler3D;
${NOISE_GLSL}
${ATMOSPHERE_GLSL}
uniform sampler3D tNoise; uniform sampler2D tWeather; uniform sampler2D tDepth; uniform sampler2D tHM;
uniform vec4 uHMRect; uniform mat4 uInvProj; uniform mat4 uCamWorld; uniform vec3 uCamPos; uniform float uFrame; uniform float uTime;
uniform vec3 uWindOffset; uniform vec4 uLayerA; uniform vec4 uLayerB; uniform vec4 uLayerC; uniform vec4 uMarch; uniform vec4 uLight;
uniform vec2 uLowRes;
varying vec2 vUv;
float remap(float v, float a, float b, float c, float d){ return c + (v - a) * (d - c) / max(b - a, 1e-4); }
vec2 hmAt(vec2 xz){ return texture2D(tHM, (xz - uHMRect.xy) / uHMRect.zw).rg; }
float sceneDist(vec2 uv, out vec3 rd){
  float d = texture2D(tDepth, uv).x;
  vec4 v = uInvProj * vec4(uv*2.0 - 1.0, d*2.0 - 1.0, 1.0); v.xyz /= v.w;
  rd = normalize((uCamWorld * vec4(v.xyz, 0.0)).xyz);
  return d >= 0.999999 ? 1e9 : length(v.xyz);
}
// coverage (0..1) and layer height fraction for p
float layerShape(vec3 p, vec4 w, vec2 th, out float hfrac, out float kind){
  float d = 0.0; hfrac = 0.0; kind = 0.0;
  float topA = uLayerA.y + (w.g - 0.5) * 110.0;
  float hA = (p.y - uLayerA.x) / (topA - uLayerA.x);
  if (hA > 0.0 && hA < 1.0){
    float valley = smoothstep(uLayerA.y + 80.0, uLayerA.x - 100.0, th.x);
    float cov = clamp(w.r * uLayerA.z * (0.62 + 0.55*valley), 0.0, 1.0);
    float prof = smoothstep(0.0, 0.1, hA) * smoothstep(1.0, 0.55, hA);
    d = prof * cov; hfrac = hA;
  }
  float above = p.y - th.x;
  if (p.y > uLayerB.x && p.y < uLayerB.y && above > -5.0){
    float hb = (p.y - uLayerB.x) / (uLayerB.y - uLayerB.x);
    float hug = smoothstep(-5.0, 30.0, above) * (1.0 - smoothstep(70.0, 260.0, above));
    // corridors live between the distant massifs, never around the hero summit / camera
    float away = smoothstep(260.0, 900.0, length(p.xz)) * smoothstep(120.0, 500.0, length(p - uCamPos));
    float c = hug * away * smoothstep(0.35, 0.8, w.b) * uLayerB.z * smoothstep(0.0, 0.25, hb) * smoothstep(1.0, 0.45, hb);
    if (c > d){ d = c; hfrac = hb; kind = 1.0; }
  }
  if (p.y > uLayerC.x && p.y < uLayerC.y){
    float hc = (p.y - uLayerC.x) / (uLayerC.y - uLayerC.x);
    float dist = length(p.xz - uCamPos.xz);
    float far = smoothstep(4500.0, 10000.0, dist);
    float cov = texture2D(tWeather, (p.xz + uWindOffset.xz) / 47000.0 + 0.37).a;
    // cumulus profile: flat base, billowing middle, tops that shrink and round off
    float base = smoothstep(0.0, 0.06, hc);
    float need = pow(smoothstep(0.04, 1.0, hc), 2.2) * 0.9;
    float c = clamp((cov * 1.1 - need) * 2.4, 0.0, 1.0) * base * uLayerC.z * far;
    if (c > d){ d = c; hfrac = hc; kind = 2.0; }
  }
  return d;
}
float density(vec3 p, float detail, out float hfrac, out float kind){
  vec3 q = p + uWindOffset;
  vec4 w = texture2D(tWeather, q.xz / 19000.0);
  vec2 th = hmAt(p.xz);
  float cov = layerShape(p, w, th, hfrac, kind);
  if (cov <= 0.002) return 0.0;
  float sc = kind > 1.5 ? 2600.0 : 1150.0;
  vec4 n = texture(tNoise, q / sc);
  float wf = n.g*0.625 + n.b*0.25 + n.a*0.125;
  float shape = remap(n.r, wf - 1.0, 1.0, 0.0, 1.0);
  float c = clamp(remap(shape, 1.0 - cov, 1.0, 0.0, 1.0), 0.0, 1.0);
  if (detail > 0.0 && c > 0.0){
    vec4 dn = texture(tNoise, q / (kind > 1.5 ? 520.0 : 230.0) + vec3(0.0, -uTime*0.0018, 0.0));
    float df = mix(dn.b, 1.0 - dn.b, clamp(hfrac*4.0, 0.0, 1.0)) * 0.6 + dn.a * 0.4;
    c = clamp(remap(c, df * 0.42 * detail, 1.0, 0.0, 1.0), 0.0, 1.0);
  }
  return c * (kind > 1.5 ? uLayerC.w : kind > 0.5 ? uLayerB.w : uLayerA.w);
}
float hg(float mu, float g){ float g2 = g*g; return (1.0 - g2) / (4.0*PI*pow(1.0 + g2 - 2.0*g*mu, 1.5)); }
void integrateSample(vec3 ro, vec3 rd, vec3 p, float t, float ds, float dens, float hf, float mu, inout vec3 S, inout float T, inout float tw, inout float twS){
  float od = 0.0; float lt = uLight.y;
  for (int j = 0; j < 8; j++){
    if (float(j) >= uLight.x) break;
    float h2, k2;
    od += density(p + uSunDir * lt, 0.0, h2, k2) * lt * 0.55;
    lt *= 2.05;
  }
  vec2 th = hmAt(p.xz);
  float tsh = smoothstep(th.y - 40.0, th.y + 25.0, p.y);
  float sigma = uLight.z;
  vec3 sunL = vec3(0.0); float a = 1.0, b = 1.0, c = 1.0;
  for (int o = 0; o < 3; o++){ sunL += a * mix(hg(mu, 0.78*c), hg(mu, -0.22*c), 0.28) * exp(-od * sigma * b); a *= 0.52; b *= 0.45; c *= 0.6; }
  sunL *= uSunRadiance * tsh * uLight.w;
  vec3 amb = mix(uSkyAmbient * 0.34 + uHorizonAmbient * 0.06, uSkyAmbient * 0.8 + uHorizonAmbient * 0.1, clamp(hf*1.15, 0.0, 1.0)) * (0.45 + 0.55*tsh);
  float st = dens * sigma;
  float powder = 1.0 - 0.6 * exp(-dens * 9.0);
  vec3 Sc = (sunL * 4.8 * powder + amb) * st;
  float Ts = exp(-st * ds);
  vec3 Si = (Sc - Sc*Ts) / max(st, 1e-6);
  S += T * Si * aerialT(ro, rd, t);
  float dT = T * (1.0 - Ts);
  tw += t * dT; twS += dT;
  T *= Ts;
}
// two-speed march over one slab segment: coarse steps through empty space, step back and
// refine when density is found, distance-proportional step length
void marchSegment(vec3 ro, vec3 rd, float ta, float tb, float n, float mu, float jit, inout vec3 S, inout float T, inout float tw, inout float twS){
  if (tb <= ta) return;
  float t = ta + max(uMarch.w, ta*uMarch.y) * jit;
  bool coarse = true; float emptyRun = 0.0; float it = 0.0;
  for (int i = 0; i < 140; i++){
    if (t >= tb || T < 0.012 || it >= n * (coarse ? 1.0 : 1.8)) break;
    it += 1.0;
    float ds = clamp(t * uMarch.y, uMarch.w, max((tb - ta) * 0.25, uMarch.w));
    vec3 p = ro + rd*t;
    float hf, kind;
    if (coarse){
      float d0 = density(p, 0.0, hf, kind);
      if (d0 > 0.002){ coarse = false; t = max(ta, t - ds * 1.4); continue; }
      t += ds * (1.8 + 1.2 * fract(jit + it * 0.6180339)); continue;
    }
    ds = min(ds, 55.0 + t * 0.011); // fine steps stay short inside clouds (no terracing)
    float det = 1.0 - smoothstep(1800.0, 3400.0, t);
    float dens = density(p, det, hf, kind);
    if (dens > 0.003){ emptyRun = 0.0; integrateSample(ro, rd, p, t, ds, dens, hf, mu, S, T, tw, twS); }
    else { emptyRun += 1.0; if (emptyRun > 4.0) coarse = true; }
    t += ds * (0.7 + 0.6 * fract(jit * 1.37 + it * 0.7548777));
  }
}
vec2 slab(vec3 ro, vec3 rd, float y0, float y1){
  if (abs(rd.y) < 1e-5) return (ro.y >= y0 && ro.y <= y1) ? vec2(0.0, 1e9) : vec2(1.0, 0.0);
  float ta = (y0 - ro.y) / rd.y, tb = (y1 - ro.y) / rd.y;
  return vec2(max(min(ta, tb), 0.0), max(ta, tb));
}
void main(){
  vec3 rd; float sd = sceneDist(vUv, rd);
  vec3 ro = uCamPos;
  float tMax = min(sd, uMarch.z);
  float mu = dot(rd, uSunDir);
  float jit = ign(gl_FragCoord.xy, uFrame);
  vec3 S = vec3(0.0); float T = 1.0; float tw = 0.0, twS = 0.0;
  vec2 lo = slab(ro, rd, uLayerA.x - 60.0, max(uLayerA.y + 130.0, uLayerB.y));
  vec2 hi = slab(ro, rd, uLayerC.x, uLayerC.y);
  marchSegment(ro, rd, lo.x, min(lo.y, tMax), uMarch.x * 0.62, mu, jit, S, T, tw, twS);
  marchSegment(ro, rd, hi.x, min(hi.y, tMax), uMarch.x * 0.5, mu, jit, S, T, tw, twS);
  if (twS > 1e-4 && uAtmosphereOn > 0.5){
    float te = tw / twS;
    S += (1.0 - T) * fogColor(rd) * (1.0 - aerialT(ro, rd, te));
  }
  gl_FragColor = vec4(S, T);
}`;

const TEMPORAL_FS = /* glsl */`
precision highp float;
uniform sampler2D tCur; uniform sampler2D tHist; uniform sampler2D tDepth;
uniform mat4 uInvProj; uniform mat4 uCamWorld; uniform mat4 uPrevViewProj; uniform vec3 uCamPos; uniform vec2 uLowRes;
uniform float uBlend; uniform vec4 uLayerA; uniform vec4 uLayerC; uniform float uValid;
varying vec2 vUv;
void main(){
  vec4 cur = texture2D(tCur, vUv);
  float d = texture2D(tDepth, vUv).x;
  vec4 v = uInvProj * vec4(vUv*2.0 - 1.0, d*2.0 - 1.0, 1.0); v.xyz /= v.w;
  vec3 rd = normalize((uCamWorld * vec4(v.xyz, 0.0)).xyz);
  float sd = d >= 0.999999 ? 1e9 : length(v.xyz);
  float tr = rd.y < 0.0 ? (uLayerA.y - uCamPos.y) / rd.y : (uLayerC.x - uCamPos.y) / max(rd.y, 1e-4);
  tr = clamp(min(tr, sd), 30.0, 40000.0);
  vec4 pc = uPrevViewProj * vec4(uCamPos + rd*tr, 1.0);
  vec2 puv = pc.xy / pc.w * 0.5 + 0.5;
  vec4 mn = cur, mx = cur;
  vec2 tx = 1.0 / uLowRes;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++){ vec4 s = texture2D(tCur, vUv + vec2(float(i), float(j))*tx); mn = min(mn, s); mx = max(mx, s); }
  vec4 h = texture2D(tHist, puv);
  vec4 hc = clamp(h, mn, mx);
  float ok = uValid * step(0.0, puv.x) * step(puv.x, 1.0) * step(0.0, puv.y) * step(puv.y, 1.0) * step(0.0, pc.w);
  gl_FragColor = mix(cur, hc, uBlend * ok);
}`;

const COMPOSITE_FS = /* glsl */`
precision highp float;
uniform sampler2D tScene; uniform sampler2D tDepth; uniform sampler2D tClouds; uniform vec2 uLowRes; uniform float uOn;
uniform mat4 uInvProj;
varying vec2 vUv;
float dist(vec2 uv){ float d = texture2D(tDepth, uv).x; vec4 v = uInvProj * vec4(uv*2.0 - 1.0, d*2.0 - 1.0, 1.0); return d >= 0.999999 ? 1e6 : length(v.xyz / v.w); }
void main(){
  vec3 scene = texture2D(tScene, vUv).rgb;
  if (uOn < 0.5){ gl_FragColor = vec4(scene, 1.0); return; }
  float d0 = dist(vUv);
  vec2 lp = vUv * uLowRes - 0.5; vec2 f = fract(lp); vec2 base = (floor(lp) + 0.5) / uLowRes;
  vec4 acc = vec4(0.0); float ws = 0.0;
  for (int k = 0; k < 4; k++){
    vec2 o = vec2(float(k - (k/2)*2), float(k/2));
    vec2 uv = base + o / uLowRes;
    float dk = dist(uv);
    float wb = (o.x > 0.5 ? f.x : 1.0 - f.x) * (o.y > 0.5 ? f.y : 1.0 - f.y);
    float rel = abs(dk - d0) / max(min(dk, d0), 1.0);
    float w = (wb + 1e-3) / (1e-3 + rel*rel*40.0);
    acc += texture2D(tClouds, uv) * w; ws += w;
  }
  vec4 c = acc / ws;
  gl_FragColor = vec4(scene * c.a + c.rgb, 1.0);
}`;

export class VolumetricClouds {
  constructor(renderer, q, terrain) {
    this.renderer = renderer;
    this.enabled = true;
    this.quad = new THREE.Mesh(fullscreenGeometry()); this.quad.frustumCulled = false;
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.q = q;
    this._genNoise(q.noiseSize || 128);
    this._genWeather();
    this.hm = terrain.cloudHeightMap;
    this.layers = {
      A: new THREE.Vector4(-380, -55, 1.0, 1.0), // sea of clouds: base, top, coverage gain, density
      B: new THREE.Vector4(-210, 70, 0.85, 0.55), // corridors
      C: new THREE.Vector4(700, 2600, 1.0, 0.4), // towering cumulus
    };
    const common = { uInvProj: U.uInvProj, uCamWorld: U.uCamWorld, uCamPos: U.uCamPos };
    this.marchMat = new THREE.ShaderMaterial({
      name: 'VolumetricCloudsMarch', vertexShader: VS, fragmentShader: MARCH_FS, depthTest: false, depthWrite: false,
      uniforms: { ...U, tNoise: { value: this.noise.texture }, tWeather: { value: this.weather.texture }, tDepth: { value: null }, tHM: { value: this.hm.texture },
        uHMRect: { value: terrain.cloudHeightRect }, uLayerA: { value: this.layers.A }, uLayerB: { value: this.layers.B }, uLayerC: { value: this.layers.C },
        uMarch: { value: new THREE.Vector4(q.cloudSteps, q.cloudStepK, 42000, 9) }, uLight: { value: new THREE.Vector4(q.cloudLightSteps, 22, 0.046, 1.0) },
        uLowRes: { value: new THREE.Vector2() } },
    });
    this.temporalMat = new THREE.ShaderMaterial({
      name: 'VolumetricCloudsTemporal', vertexShader: VS, fragmentShader: TEMPORAL_FS, depthTest: false, depthWrite: false,
      uniforms: { ...common, uPrevViewProj: U.uPrevViewProj, tCur: { value: null }, tHist: { value: null }, tDepth: { value: null }, uLowRes: { value: new THREE.Vector2() },
        uBlend: { value: 0.9 }, uLayerA: { value: this.layers.A }, uLayerC: { value: this.layers.C }, uValid: { value: 0 } },
    });
    this.compositeMat = new THREE.ShaderMaterial({
      name: 'VolumetricCloudsComposite', vertexShader: VS, fragmentShader: COMPOSITE_FS, depthTest: false, depthWrite: false,
      uniforms: { uInvProj: U.uInvProj, tScene: { value: null }, tDepth: { value: null }, tClouds: { value: null }, uLowRes: { value: new THREE.Vector2() }, uOn: { value: 1 } },
    });
    this.hist = []; this.histIdx = 0; this.validHistory = false;
  }

  _genNoise(N) {
    this.noise = new THREE.WebGL3DRenderTarget(N, N, N, { format: THREE.RGBAFormat, type: THREE.UnsignedByteType, depthBuffer: false });
    const tex = this.noise.texture;
    tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping; tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false;
    const mat = new THREE.ShaderMaterial({ vertexShader: `void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }`, fragmentShader: NOISE3D_FS, uniforms: { uSlice: { value: 0 }, uSize: { value: N } }, depthTest: false, depthWrite: false });
    this.quad.material = mat;
    for (let z = 0; z < N; z++) { mat.uniforms.uSlice.value = z; this.renderer.setRenderTarget(this.noise, z); this.renderer.render(this.quad, this.cam); }
    this.renderer.setRenderTarget(null); mat.dispose();
  }

  _genWeather() {
    this.weather = new THREE.WebGLRenderTarget(512, 512, { format: THREE.RGBAFormat, type: THREE.UnsignedByteType, depthBuffer: false, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    const mat = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: WEATHER_FS, depthTest: false, depthWrite: false });
    this.quad.material = mat; this.renderer.setRenderTarget(this.weather); this.renderer.render(this.quad, this.cam); this.renderer.setRenderTarget(null); mat.dispose();
  }

  setSize(w, h) {
    const s = this.q.cloudScale;
    const lw = Math.max(1, Math.floor(w * s)), lh = Math.max(1, Math.floor(h * s));
    this.hist.forEach(r => r.dispose()); if (this.cur) this.cur.dispose();
    const mk = () => new THREE.WebGLRenderTarget(lw, lh, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
    this.cur = mk(); this.hist = [mk(), mk()]; this.validHistory = false;
    this.low = new THREE.Vector2(lw, lh);
    this.marchMat.uniforms.uLowRes.value.copy(this.low); this.temporalMat.uniforms.uLowRes.value.copy(this.low); this.compositeMat.uniforms.uLowRes.value.copy(this.low);
  }

  setQuality(q) {
    this.q = q;
    this.marchMat.uniforms.uMarch.value.x = q.cloudSteps; this.marchMat.uniforms.uMarch.value.y = q.cloudStepK;
    this.marchMat.uniforms.uLight.value.x = q.cloudLightSteps;
  }

  invalidateHistory() { this.validHistory = false; }

  render(sceneRT, outRT) {
    const r = this.renderer;
    const depth = sceneRT.depthTexture;
    if (this.enabled) {
      this.marchMat.uniforms.tDepth.value = depth;
      this.quad.material = this.marchMat; r.setRenderTarget(this.cur); r.render(this.quad, this.cam);
      const prev = this.hist[this.histIdx], next = this.hist[this.histIdx ^ 1];
      const tm = this.temporalMat.uniforms;
      tm.tCur.value = this.cur.texture; tm.tHist.value = prev.texture; tm.tDepth.value = depth; tm.uValid.value = this.validHistory ? 1 : 0;
      this.quad.material = this.temporalMat; r.setRenderTarget(next); r.render(this.quad, this.cam);
      this.histIdx ^= 1; this.validHistory = true;
    }
    const cm = this.compositeMat.uniforms;
    cm.tScene.value = sceneRT.texture; cm.tDepth.value = depth; cm.tClouds.value = this.hist[this.histIdx].texture; cm.uOn.value = this.enabled ? 1 : 0;
    this.quad.material = this.compositeMat; r.setRenderTarget(outRT); r.render(this.quad, this.cam);
  }
}

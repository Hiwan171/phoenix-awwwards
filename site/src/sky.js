// Physically-based sky for the ascent: single-scattering atmosphere (Rayleigh + Mie), a real sun disc,
// stars, and two procedural cloud decks (cumulus deck + high cirrus) lit with the sun's real transmittance.
//
//   altitude a ∈ [0,1]  ->  camera height 0..4200 m  and  sun elevation -16°..+24°
//   a = 0     pre-dawn void (continuous with the hero)
//   a ≈ 0.43  crossing the cumulus deck at 1800 m (white-out mist)
//   a ≈ 0.5   sunrise above a sea of clouds
//
// Everything is analytic (no textures except one 256² noise tile generated at runtime): 0 KB of assets.
import * as THREE from 'three';

export const SKY = { deckH: 1800, cirrusH: 7500, maxAlt: 4200 };

// ───────────────────────── CPU-side atmosphere helpers (sun colour as seen by clouds) ─────────────────────────
const R_PLANET = 6371e3, R_ATMOS = 6471e3;
const K_RLH = [5.5e-6, 13.0e-6, 22.4e-6], K_MIE = 21e-6, H_RLH = 8e3, H_MIE = 1.2e3;

/** transmittance of sunlight reaching a point at `heightM` when the sun is `elevDeg` above the horizon */
function sunTransmittance(elevDeg, heightM) {
  const e = (elevDeg * Math.PI) / 180, d = [Math.cos(e), Math.sin(e)], p0 = [0, R_PLANET + heightM];
  const b = 2 * (p0[0] * d[0] + p0[1] * d[1]);
  const cA = p0[0] ** 2 + p0[1] ** 2 - R_ATMOS ** 2;
  const t1 = (-b + Math.sqrt(b * b - 4 * cA)) / 2;
  const cP = p0[0] ** 2 + p0[1] ** 2 - R_PLANET ** 2, dP = b * b - 4 * cP;
  if (dP > 0 && (-b - Math.sqrt(dP)) / 2 > 0) return [0, 0, 0];          // the planet is in the way
  let odR = 0, odM = 0; const n = 24, dt = t1 / n;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) * dt, x = p0[0] + d[0] * t, y = p0[1] + d[1] * t;
    const h = Math.hypot(x, y) - R_PLANET;
    odR += Math.exp(-h / H_RLH) * dt; odM += Math.exp(-h / H_MIE) * dt;
  }
  return K_RLH.map((k) => Math.exp(-(k * odR + K_MIE * odM)));
}
/** soft version: averages a small penumbra so colours never pop when the planet edge passes */
function sunColour(elevDeg, heightM) {
  const s = [0, 0, 0];
  for (const o of [-3.6, -1.8, 0, 1.8, 3.6]) sunTransmittance(elevDeg + o, heightM).forEach((v, i) => { s[i] += v / 5; });
  return s;
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** all the per-altitude numbers the shader and the lights need (pure function of a) */
export function skyState(a, { sunAz = 0.14 } = {}) {
  const elev = -16 + 40 * Math.pow(a, 1.15);
  const camH = a * SKY.maxAlt;
  const e = (elev * Math.PI) / 180;
  const sunDir = [-Math.sin(sunAz) * Math.cos(e), Math.sin(e), Math.cos(sunAz) * Math.cos(e)];
  const deck = sunColour(elev, SKY.deckH), high = sunColour(elev, SKY.cirrusH), eye = sunColour(elev, camH + 2);
  const day = smooth(-6, 16, elev), dawn = Math.exp(-(((elev + 1) / 6) ** 2));
  const amb = [0.012, 0.014, 0.03].map((n, i) => n + (([0.33, 0.42, 0.6][i]) - n) * day + [0.34, 0.12, 0.04][i] * dawn);
  return { a, elev, camH, sunDir, deck, high, eye, amb, day, dawn,
           mist: Math.exp(-(((camH - SKY.deckH) / 120) ** 2)) };
}

// ───────────────────────── GLSL ─────────────────────────
const VERT = /* glsl */`
uniform mat4 uInvProj; uniform mat4 uCamWorld;
varying vec3 vRay;
void main() {
  vec4 v = uInvProj * vec4(position.xy, 1.0, 1.0);
  vRay = (uCamWorld * vec4(v.xyz / v.w, 0.0)).xyz;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}`;

const FRAG = (iSteps, jSteps) => /* glsl */`
precision highp float;
uniform float uTime, uAlt, uCover, uWind, uSunI, uStars, uClouds, uCirrus;
uniform vec3 uSunDir, uSunDeck, uSunHigh, uSunEye, uAmb;
uniform sampler2D uNoise;
varying vec3 vRay;
const float PI = 3.14159265;
const float R_P = 6371e3, R_A = 6471e3;
const vec3  K_RLH = vec3(5.5e-6, 13.0e-6, 22.4e-6);
const float K_MIE = 21e-6, SH_RLH = 8e3, SH_MIE = 1.2e3, G = 0.758;

vec2 rsi(vec3 r0, vec3 rd, float sr) {
  float b = 2.0 * dot(rd, r0), c = dot(r0, r0) - sr * sr, d = b * b - 4.0 * c;
  if (d < 0.0) return vec2(1e5, -1e5);
  float s = sqrt(d); return vec2((-b - s) * 0.5, (-b + s) * 0.5);
}

vec3 atmosphere(vec3 r, vec3 r0, vec3 sun) {
  vec2 p = rsi(r0, r, R_A);
  if (p.x > p.y) return vec3(0.0);
  vec2 pl = rsi(r0, r, R_P);
  if (pl.x > 0.0 && pl.x < pl.y) p.y = min(p.y, pl.x);     // the ground is in the way
  p.x = max(p.x, 0.0);
  float stepS = (p.y - p.x) / float(${iSteps});
  float t = p.x;
  vec3 totR = vec3(0.0), totM = vec3(0.0);
  float odR = 0.0, odM = 0.0;
  float mu = dot(r, sun), mumu = mu * mu, gg = G * G;
  float pR = 3.0 / (16.0 * PI) * (1.0 + mumu);
  float pM = 3.0 / (8.0 * PI) * ((1.0 - gg) * (mumu + 1.0)) / (pow(1.0 + gg - 2.0 * mu * G, 1.5) * (2.0 + gg));
  for (int i = 0; i < ${iSteps}; i++) {
    vec3 pos = r0 + r * (t + stepS * 0.5);
    float h = length(pos) - R_P;
    float dR = exp(-h / SH_RLH) * stepS, dM = exp(-h / SH_MIE) * stepS;
    odR += dR; odM += dM;
    float jS = max(rsi(pos, sun, R_A).y, 0.0) / float(${jSteps});
    float jt = 0.0, jR = 0.0, jM = 0.0;
    for (int j = 0; j < ${jSteps}; j++) {
      vec3 jp = pos + sun * (jt + jS * 0.5);
      float jh = length(jp) - R_P;
      jR += exp(-jh / SH_RLH) * jS; jM += exp(-jh / SH_MIE) * jS;
      jt += jS;
    }
    vec3 attn = exp(-(K_MIE * (odM + jM) + K_RLH * (odR + jR)));
    totR += dR * attn; totM += dM * attn;
    t += stepS;
  }
  return uSunI * (pR * K_RLH * totR + pM * K_MIE * totM);
}

float noise(vec2 x) {
  vec2 p = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return texture2D(uNoise, (p + f + 0.5) / 256.0).r;
}
float fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) { s += a * noise(p); p = m * p; a *= 0.5; }
  return s;
}
float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }

// one planar cloud deck. returns (rgb, alpha). H = deck height, sunCol = sunlight reaching that deck
vec4 deck(vec3 rd, float H, float scale, vec2 stretch, float cover, float soft, vec3 sunCol, float lift) {
  float dh = H - uAlt;
  if (dh * rd.y <= 0.0) return vec4(0.0);
  float t = dh / rd.y;
  vec2 p = (rd.xz * t + vec2(uTime * uWind, uTime * uWind * 0.35)) * scale * stretch;
  float d0 = fbm(p);
  float dens = smoothstep(1.0 - cover, 1.0 - cover + soft, d0);
  if (dens < 0.004) return vec4(0.0);
  // self-shadowing: density one step toward the sun
  vec2 sd = normalize(uSunDir.xz + vec2(1e-4)) * (0.09 + 0.04 * (1.0 - uSunDir.y));
  float d1 = fbm(p + sd * stretch);
  float lit = clamp((d0 - d1) * 3.6 + 0.50, 0.0, 1.0);
  bool below = uAlt < H;
  float under = below ? 0.55 : 1.0;
  float cosS = max(dot(rd, uSunDir), 0.0);
  float silver = pow(cosS, 7.0) * (1.0 - smoothstep(0.0, 0.7, dens));        // bright rims when facing the sun
  vec3 col = uAmb * (0.9 - 0.45 * dens) + sunCol * (lit * 1.25 * under + silver * 2.4) * lift;
  float horizon = smoothstep(0.0, 0.06, abs(rd.y));
  float far = exp(-t / 70000.0);
  return vec4(col, dens * horizon * far);
}

void main() {
  vec3 rd = normalize(vRay);
  vec3 r0 = vec3(0.0, R_P + 2.0 + uAlt, 0.0);
  vec3 col = atmosphere(rd, r0, uSunDir);

  // night sky: faint airglow so the "void" is a deep blue dome with a glow at the horizon, not flat black
  float dark = 1.0 - smoothstep(-0.20, 0.02, uSunDir.y);
  col += vec3(0.010, 0.020, 0.052) * dark * (0.55 + 1.5 * exp(-abs(rd.y) * 5.0));

  // stars: only on a dark sky, above the horizon, twinkling
  float night = (1.0 - smoothstep(-0.20, -0.02, uSunDir.y)) * uStars;
  if (night > 0.001 && rd.y > 0.0) {
    vec3 q = rd * 150.0, c = floor(q), f = fract(q) - 0.5;
    float h = hash3(c);
    vec3 off = (vec3(hash3(c + 1.7), hash3(c + 3.1), hash3(c + 5.3)) - 0.5) * 0.55;
    float d = length(f - off);
    float s = step(0.965, h) * smoothstep(0.11, 0.0, d) * (0.55 + 0.45 * sin(uTime * 2.5 + h * 300.0)) * (0.4 + 2.2 * (h - 0.965) / 0.035);
    col += vec3(0.85, 0.9, 1.0) * s * night * smoothstep(0.0, 0.25, rd.y);
  }

  // land / sea far below: dark, with the horizon haze already in col
  if (rd.y < 0.0 && uAlt < 1800.0) {
    vec3 g = uAmb * 0.22 + uSunDeck * 0.06 * max(uSunDir.y, 0.0);
    col += g * (1.0 - exp(-abs(rd.y) * 22.0));
  }

  // the sun itself (disc ~1.3 deg, hidden below the horizon)
  float cs = dot(rd, uSunDir);
  float disc = smoothstep(0.99962, 0.99985, cs) * smoothstep(-0.015, 0.012, rd.y);
  col += uSunEye * disc * 55.0;

  // cloud decks: cirrus first (farther), then the cumulus deck
  if (uCirrus > 0.0) {
    vec4 c = deck(rd, 7500.0, 1.0 / 3200.0, vec2(0.45, 1.5), 0.50, 0.55, uSunHigh * 2.0, 1.0);
    col = mix(col, c.rgb, c.a * 0.7 * uCirrus);
  }
  if (uClouds > 0.0) {
    vec4 c = deck(rd, 1800.0, 1.0 / 1500.0, vec2(1.0, 1.0), uCover, 0.34, uSunDeck * 2.6, 1.0);
    col = mix(col, c.rgb, c.a * uClouds);
  }
  // HDR safety: a single NaN/Inf pixel would be smeared over the whole frame by the bloom pass
  if (!(col.r >= 0.0 && col.g >= 0.0 && col.b >= 0.0)) col = vec3(0.0);
  gl_FragColor = vec4(min(col, vec3(48.0)), 1.0);
}`;

// ───────────────────────── scene object ─────────────────────────
export function createSky({ quality = 'high' } = {}) {
  const [iS, jS] = quality === 'low' ? [6, 3] : quality === 'mid' ? [8, 4] : [12, 5];

  // 256² tile of uniform random values -> value noise through bilinear filtering
  const data = new Uint8Array(256 * 256 * 4);
  let seed = 1337; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < data.length; i++) data[i] = (rnd() * 255) | 0;
  const noiseTex = new THREE.DataTexture(data, 256, 256, THREE.RGBAFormat);
  noiseTex.wrapS = noiseTex.wrapT = THREE.RepeatWrapping;
  noiseTex.minFilter = noiseTex.magFilter = THREE.LinearFilter;
  noiseTex.needsUpdate = true;

  const uniforms = {
    uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() },
    uTime: { value: 0 }, uAlt: { value: 0 }, uCover: { value: 0.58 }, uWind: { value: 9 }, uSunI: { value: 14 },
    uStars: { value: 1 }, uClouds: { value: 1 }, uCirrus: { value: 1 },
    uSunDir: { value: new THREE.Vector3(0, -0.3, 1) }, uSunDeck: { value: new THREE.Vector3() },
    uSunHigh: { value: new THREE.Vector3() }, uSunEye: { value: new THREE.Vector3() }, uAmb: { value: new THREE.Vector3() },
    uNoise: { value: noiseTex },
  };
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG(iS, jS), depthTest: false, depthWrite: false }));
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;

  /** push a skyState into the shader. camera supplies the view rays. */
  function update(state, camera, time) {
    uniforms.uAlt.value = state.camH;
    uniforms.uTime.value = time;
    uniforms.uSunDir.value.set(...state.sunDir).normalize();
    uniforms.uSunDeck.value.set(...state.deck);
    uniforms.uSunHigh.value.set(...state.high);
    uniforms.uSunEye.value.set(...state.eye);
    uniforms.uAmb.value.set(...state.amb);
    camera.updateMatrixWorld();
    uniforms.uInvProj.value.copy(camera.projectionMatrixInverse);
    uniforms.uCamWorld.value.copy(camera.matrixWorld);
  }
  return { mesh, uniforms, update };
}

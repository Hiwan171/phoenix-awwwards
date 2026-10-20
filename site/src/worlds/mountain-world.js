// The opening world: the mountains and cloud sea of "mountain1" (S. Guillitte 2021, Shadertoy fddSzl, field after Yonatan;
// licence CC BY-NC-SA 3.0, credit the author on the site), with the phoenix perched on one of ITS peaks.
//
//   * the terrain of the shader is analytic (sums of |sines| with a rotation per octave): it is ported to JS (fieldH), so her feet,
//     claws and tail touch exactly the mountain the shader draws. The field's highest, most prominent peak is at its origin: that
//     is her perch; a second peak 1.5 units away is where she lands.
//   * world = shader * K (+ Y0 in height): 1 shader unit = 30 m.
//   * the shader's own march starts 2.5 units (75 m) from its camera, so: within ~75 m the mountains are a real MESH of the same
//     field (with a small rock summit carved on the two needle peaks so a bird can stand); beyond, the shader itself, baked at load
//     as panoramas from her perch (worlds/mountain-panorama.js). The mesh's haze takes the panorama's colour in the same direction:
//     the near mountains melt into the far ones.
//   * mist in the valleys: an exponential height fog (analytic along the ray), coloured by the panorama.
import * as THREE from 'three';
import { bakeMountainPanoramas, PANO_LAT_TOP } from './mountain-panorama.js';
import { createMountainLive } from './mountain-live.js';
// ?live=0: the old look (our own shading of the field); default: the shader itself, live, from our camera
export const LIVE = !(globalThis.location && new URLSearchParams(location.search).get('live') === '0');

export const K = 30;                       // metres per shader unit
// her perch is NOT the field's origin (a perfect cone: every octave crosses zero there) but a natural peak of it, at FIELD_O
export const FIELD_O = { x: 0.5348, z: 1.4316 };
export const KY = +(globalThis.location ? new URLSearchParams(location.search).get('ky') ?? (LIVE ? 1 : 1.7) : 1) * K;   // metres per shader unit in HEIGHT: the peaks taller and steeper than the shader's (Chinese-painting spires)
export const Y0 = 19 + 0.1204 * KY;        // world height of the field's origin (so her peak's tip is at ~19 m)
export const MIST_Y = Y0 - 0.5 * KY;        // the top of the valley mist (the cloud sea between the peaks)
export const CLOUD_Y = MIST_Y;             // (name used by the scene for the cloud level)
export const SUN_DIR = new THREE.Vector3(0.52, 0.16, 0.85).normalize();

// ───────────── the field's terrain, in JS ─────────────
/** g >= 0; the terrain surface is y = -g (shader units). Same loop as the GLSL: rotate p.xz by rot(s), then add the octave */
export function fieldG(x, z) {
  let s = 2, f = 0;
  while (s < 800) {
    const c = Math.cos(s), sn = Math.sin(s);
    const nx = c * x + sn * z; z = -sn * x + c * z; x = nx;          // p.xz *= rot(s)   (GLSL: v * M = M^T v)
    f += Math.abs((Math.sin(x * s * 0.5) + Math.sin(z * s * 0.5)) / s);
    s *= 1.6;
  }
  return f;
}
// the field's origin is a perfect cone (every octave crosses zero there): it is sunk into the clouds
const ORIGIN_SINK = (x, z) => { const t = Math.max(0, 1 - Math.hypot(x, z) / 0.35); return 0.6 * t * t * (3 - 2 * t); };
const fieldWorldH = (X, Z) => { const x = X / K + FIELD_O.x, z = Z / K + FIELD_O.z; return Y0 - (fieldG(x, z) + ORIGIN_SINK(x, z)) * KY; };
/** the field with the octaves finer than ~4 mesh cells faded out (cell in metres) */
function fieldGFiltered(x, z, cell) {
  let s = 2, f = 0;
  while (s < 800) {
    const c = Math.cos(s), sn = Math.sin(s);
    const nx = c * x + sn * z; z = -sn * x + c * z; x = nx;
    const lambda = (4 * Math.PI / s) * K;                            // the octave's wavelength in metres
    const w = Math.min(1, Math.max(0, (lambda / cell - 3) / 3));
    if (w > 0) f += w * Math.abs((Math.sin(x * s * 0.5) + Math.sin(z * s * 0.5)) / s);
    s *= 1.6;
  }
  return f;
}

// the two perches: a small rock summit carved on each needle (a dome of radius r, its top a little below the needle's tip)
export const PEAK = { x: 0, z: 0, r: 0.75 };
export const LEDGE = { x: (0.5429 - FIELD_O.x) * K, z: (2.0775 - FIELD_O.z) * K, r: 1.2 };   // the neighbouring peak, 19 m behind her (she flies a loop)
PEAK.top = fieldWorldH(PEAK.x, PEAK.z) - 0.22;
LEDGE.top = fieldWorldH(LEDGE.x, LEDGE.z) - 0.2;
const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
const vnoise = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; };
function summit(X, Z, P) {
  const r = Math.hypot(X - P.x, Z - P.z) / P.r;
  // a dome over the needle: gentle on top, falling fast beyond its radius (it merges into the flanks of the peak)
  const dome = P.top - 0.22 * r * r - 6.0 * Math.pow(Math.max(0, r - 0.95), 1.4);   // falls fast past its rim: the needle's own flanks take over
  const rock = 0.06 * (vnoise(X * 3.1 + P.x, Z * 3.1) - 0.5) + 0.025 * (vnoise(X * 9, Z * 9 + P.z) - 0.5);
  return dome + rock * Math.exp(-r * r * 0.5);
}
export function heightAt(X, Z) {
  let h = fieldWorldH(X, Z);
  // on the two perches the needle's tip is REPLACED by the carved summit (it poked up through her), merging back into the field
  for (const P of [PEAK, LEDGE]) if (Math.abs(X - P.x) < 4 * P.r && Math.abs(Z - P.z) < 4 * P.r) {
    const hs = summit(X, Z, P), w = Math.min(1, Math.max(0, (Math.hypot(X - P.x, Z - P.z) / P.r - 1.0) / 0.35)), ws = w * w * (3 - 2 * w);
    h = hs + (h - hs) * ws;                                            // past the rim: the needle's own (real) flanks
  }
  return h;
}

// ───────────── meshes: the whole range as real geometry (a polar grid, LOD by distance) + two fine patches on the summits ─────────────
// (the far mountains used to be the baked panorama: a photo, soft and flat; now every mountain to the horizon is the field itself)
const FAR = { cx: -5, cz: -12, N: 384, R: 1400, minCell: 1.0 };
export const PATCHES = [{ x: PEAK.x, z: PEAK.z, size: 6, seg: 150 }, { x: LEDGE.x, z: LEDGE.z, size: 7, seg: 160 }];
const inPatch = (x, z) => PATCHES.some((q) => Math.abs(x - q.x) < q.size / 2 - 0.15 && Math.abs(z - q.z) < q.size / 2 - 0.15);
const SURF = PATCHES.map((q) => ({ cx: q.x, cz: q.z, sx: q.size, sz: q.size, nx: q.seg, nz: q.seg }));
const surfCache = SURF.map(() => new Map());
/** the height of the RENDERED terrain (the mesh triangles, cached corners) */
export function surfaceAt(x, z) {
  let k = -1;
  for (let i = 0; i < PATCHES.length; i++) { const q = SURF[i]; if (Math.abs(x - q.cx) < q.sx / 2 && Math.abs(z - q.cz) < q.sz / 2) { k = i; break; } }
  if (k < 0) return heightAt(x, z);                                   // (her feet and tail only ever touch the patches)
  const q = SURF[k], cx = q.sx / q.nx, cz = q.sz / q.nz, gx = (x - q.cx + q.sx / 2) / cx, gz = (z - q.cz + q.sz / 2) / cz;
  const ix = Math.min(q.nx - 1, Math.max(0, Math.floor(gx))), iz = Math.min(q.nz - 1, Math.max(0, Math.floor(gz))), fx = gx - ix, fz = gz - iz;
  const H = (a, b) => { const key = a * 8192 + b, m = surfCache[k]; let h = m.get(key); if (h === undefined) { h = heightAt(q.cx - q.sx / 2 + a * cx, q.cz - q.sz / 2 + b * cz) ; m.set(key, h); } return h; };
  const ha = H(ix, iz), hb = H(ix, iz + 1), hc = H(ix + 1, iz + 1), hd = H(ix + 1, iz);
  return fx + fz <= 1 ? ha + (hd - ha) * fx + (hb - ha) * fz : hc + (hb - hc) * (1 - fx) + (hd - hc) * (1 - fz);
}

// ───────────── shared GLSL: the far world's colour in a direction (panorama + grade), the haze ─────────────
const GLSL_PANO = /* glsl */`
uniform sampler2D uPanoA, uPanoB; uniform float uPanoMix, uPanoOn; uniform vec3 uMwSun;
float mwToward(vec3 d) { return smoothstep(-0.4, 1.0, dot(d, uMwSun)); }
// the baked panorama, graded to the sunset: blue-violet shadows, rose mid tones, gold highlights toward the sun
vec3 mwPano(vec3 d) {
  float lat = asin(clamp(d.y, -1.0, 1.0)), lon = atan(d.x, -d.z);
  vec2 uv = vec2(lon / 6.2831853 + 0.5, (lat + 1.5707963) / (1.5707963 + ${PANO_LAT_TOP.toFixed(4)}));
  uv.y = min(uv.y, 0.995);
  vec3 pc = mix(texture2D(uPanoA, uv).rgb, texture2D(uPanoB, uv).rgb, uPanoMix);
  pc = pow(pc, vec3(2.2));
  float lum = dot(pc, vec3(0.2126, 0.7152, 0.0722)), to = mwToward(d);
  vec3 tint = mix(vec3(0.30, 0.34, 0.62), vec3(0.95, 0.62, 0.62), smoothstep(0.02, 0.25, lum));
  tint = mix(tint, mix(vec3(1.0, 0.80, 0.62), vec3(1.25, 0.70, 0.36), to), smoothstep(0.25, 0.85, lum));
  return tint * (lum / (1.0 + 0.6 * lum) * 1.25) * mix(0.85, 1.25, to);
}
uniform float uCloudY, uCloudT, uLiveOn, uLiveGain, uLiveMix; uniform sampler2D uLive, uLiveHi;
// the live shader at a screen position, graded darker and colder (sombre): display -> linear, shadows pushed to blue-violet
vec3 mwLive(vec2 uv) {
  vec3 c = pow(mix(texture2D(uLive, uv).rgb, texture2D(uLiveHi, uv).rgb, uLiveMix), vec3(2.2));
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  vec3 cold = c * vec3(0.78, 0.84, 1.08);
  c = mix(cold, c, smoothstep(0.05, 0.5, l));                        // the darks colder, the lit haze keeps its warmth
  return c * uLiveGain;
}
float mwH(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float mwN(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(mwH(i), mwH(i + vec3(1,0,0)), f.x), mix(mwH(i + vec3(0,1,0)), mwH(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(mwH(i + vec3(0,0,1)), mwH(i + vec3(1,0,1)), f.x), mix(mwH(i + vec3(0,1,1)), mwH(i + vec3(1,1,1)), f.x), f.y), f.z); }
// billows of the cloud top at xz (metres): 0..1, the finer octaves fade with the footprint fw (metres per pixel)
float mwBillow(vec2 xz, float fw) {
  vec3 q = vec3(xz * 0.018, uCloudT * 0.012);
  float b = 0.5 * mwN(q) + 0.3 * mwN(q * 2.3 + 1.7) * (1.0 - smoothstep(9.0, 22.0, fw))
          + 0.2 * mwN(q * 5.1 + 3.1) * (1.0 - smoothstep(4.0, 9.0, fw));
  return b;
}
// the cloud sea seen along a ray from eye: its colour and the height of its top where the ray meets it
vec3 mwCloud(vec3 eye, vec3 dir, out vec2 hitXZ, out float dist) {
  float t = (uCloudY - eye.y) / min(dir.y, -1e-3);
  hitXZ = eye.xz + dir.xz * t; dist = t;
  float fw = t * 0.0015 + 0.05;                                    // ~ metres per pixel there
  float b = mwBillow(hitXZ, fw);
  vec3 q0 = vec3(hitXZ * 0.018, uCloudT * 0.012);
  float c0 = mwN(q0), bx = mwN(q0 + vec3(0.108, 0.0, 0.0)), bz = mwN(q0 + vec3(0.0, 0.108, 0.0));   // the lighting normal: coarse octave only
  vec3 n = normalize(vec3(-(bx - c0) * 4.5, 1.0, -(bz - c0) * 4.5));
  float to = mwToward(dir);
  float lit = clamp(dot(n, uMwSun) * 1.6 + 0.35, 0.0, 1.0);
  vec3 shadowC = vec3(0.17, 0.17, 0.30), litC = vec3(1.10, 0.74, 0.52);
  vec3 c = mix(shadowC, litC, lit * (0.45 + 0.55 * b));
  c = mix(c, c * 0.62 + vec3(0.06, 0.05, 0.10), smoothstep(0.55, 0.2, b));            // the troughs between the billows
  c += vec3(1.25, 0.62, 0.28) * pow(max(dot(dir, uMwSun), 0.0), 6.0) * (0.3 + 0.7 * b) * 0.9;   // silver lining toward the sun
  c *= mix(0.8, 1.15, to);
  return c;
}`;

export function createMountainWorld({ scene }) {
  const U = { uPanoA: { value: null }, uPanoB: { value: null }, uPanoMix: { value: 0 }, uPanoOn: { value: 0 }, uMwSun: { value: SUN_DIR.clone() },
    uMwCam: { value: new THREE.Vector3() }, uMwTime: { value: 0 }, uMistY: { value: MIST_Y },
    uCloudY: { value: MIST_Y }, uCloudT: { value: 0 }, uLiveOn: { value: LIVE ? 1 : 0 }, uLive: { value: null }, uLiveHi: { value: null }, uLiveMix: { value: 0 }, uLiveGain: { value: +(globalThis.location ? new URLSearchParams(location.search).get('lg') ?? 0.55 : 0.55) },
    uSummitA: { value: new THREE.Vector3(PEAK.x, PEAK.z, PEAK.r) }, uSummitB: { value: new THREE.Vector3(LEDGE.x, LEDGE.z, LEDGE.r) } };
  const occluders = [];

  // ───────── sky: our sunset above the horizon, the baked mountains below ─────────
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, uniforms: U,
    vertexShader: 'varying vec3 vD; varying vec4 vClip; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); vClip = gl_Position; }',
    fragmentShader: /* glsl */`uniform float uMwTime; uniform vec3 uMwCam; varying vec3 vD; varying vec4 vClip;
      ${GLSL_PANO}
      float h1(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float n3(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(h1(i), h1(i + vec3(1,0,0)), f.x), mix(h1(i + vec3(0,1,0)), h1(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(h1(i + vec3(0,0,1)), h1(i + vec3(1,0,1)), f.x), mix(h1(i + vec3(0,1,1)), h1(i + vec3(1,1,1)), f.x), f.y), f.z); }
      void main() {
        vec3 d = normalize(vD); float h = d.y, sd = dot(d, uMwSun), toward = mwToward(d);
        vec3 horAway = vec3(0.24, 0.17, 0.32), horSun = vec3(1.25, 0.52, 0.22);
        vec3 hor = mix(horAway, horSun, toward * toward);
        vec3 mid = mix(vec3(0.10, 0.08, 0.20), vec3(0.55, 0.22, 0.20), toward * toward * toward);
        vec3 zen = vec3(0.025, 0.025, 0.07);
        float hh = clamp(h, 0.0, 1.0);
        vec3 c = mix(hor, mid, smoothstep(0.0, 0.18, hh));
        c = mix(c, zen, smoothstep(0.12, 0.75, hh));
        float s = max(sd, 0.0);
        c += vec3(1.0, 0.45, 0.18) * pow(s, 5.0) * 0.55 + vec3(1.0, 0.68, 0.38) * pow(s, 60.0) * 1.4;
        c += vec3(1.0, 0.86, 0.62) * smoothstep(0.99955, 0.99975, sd) * 10.0;
        if (h > 0.0) {                                                  // high cirrus lit by the sunset
          vec2 q = d.xz / (h + 0.12);
          float ci = 0.55 * n3(vec3(q.x * 1.3 + uMwTime * 0.004, q.y * 5.0, 0.5)) + 0.3 * n3(vec3(q.x * 2.7, q.y * 10.0, 1.7)) + 0.15 * n3(vec3(q * 6.0, 3.3));
          ci = smoothstep(0.55, 0.85, ci) * smoothstep(0.0, 0.08, h) * (1.0 - smoothstep(0.35, 0.7, h));
          c += mix(vec3(0.35, 0.18, 0.28), vec3(1.4, 0.6, 0.3), toward) * ci * 0.45;
        }
        vec3 sp = floor(d * 380.0);
        c += vec3(0.8, 0.85, 1.0) * step(0.9975, h1(sp)) * smoothstep(0.25, 0.7, h) * (1.0 - toward) * 0.8;
        if (uPanoOn > 0.5) c = mix(c, mwPano(d), 1.0 - smoothstep(-0.03, 0.05, asin(clamp(h, -1.0, 1.0))));
        else if (h < 0.0) {
          vec2 hxz; float hd; vec3 cl = mwCloud(uMwCam, d, hxz, hd);
          vec3 haze = mix(vec3(0.22, 0.16, 0.30), vec3(1.15, 0.52, 0.24), toward * toward);
          cl = mix(cl, haze, 1.0 - exp(-hd * 0.0016));
          c = mix(c, cl, smoothstep(0.0, -0.004, h));
        }
        if (uLiveOn > 0.5) {
          // the shader below and at the horizon (its haze band); above, a sombre dusk (the shader's sky is a flat white glow)
          vec3 lv = mwLive(vClip.xy / vClip.w * 0.5 + 0.5);
          vec3 dusk = mix(vec3(0.11, 0.10, 0.12), vec3(0.012, 0.014, 0.026), smoothstep(0.04, 0.55, h));
          dusk += vec3(0.30, 0.16, 0.08) * pow(max(sd, 0.0), 6.0) * (1.0 - smoothstep(0.0, 0.35, h));      // a dull warm patch where the sun set
          if (h > 0.0) {
            vec2 q = d.xz / (h + 0.12);
            float ci = 0.55 * n3(vec3(q.x * 1.3 + uMwTime * 0.004, q.y * 5.0, 0.5)) + 0.3 * n3(vec3(q.x * 2.7, q.y * 10.0, 1.7)) + 0.15 * n3(vec3(q * 6.0, 3.3));
            dusk = mix(dusk, dusk * 1.8 + vec3(0.02, 0.018, 0.02), smoothstep(0.5, 0.85, ci) * (1.0 - smoothstep(0.3, 0.7, h)) * 0.6);   // dark cloud banks
          }
          c = mix(lv, dusk, smoothstep(0.03, 0.2, h));
        }
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(480, 48, 24), skyMat); sky.renderOrder = -1; sky.frustumCulled = false; scene.add(sky);

  // ───────── the near mountains (same field), styled like the shader: dark ink rock, warm edges, mist in the valleys ─────────
  const rockMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0, envMapIntensity: 0 });
  const dbg = globalThis.location ? new URLSearchParams(location.search) : new Map();
  rockMat.defines = { MW_OCT: +(dbg.get('oct') ?? 13), MW_CLOUD: dbg.get('rcloud') === '0' ? 0 : 1 };
  rockMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vMwW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvMwW = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvMwClip = gl_Position;')
      .replace('#include <common>', '#include <common>\nvarying vec4 vMwClip;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vMwW; varying vec4 vMwClip;\nuniform vec3 uMwCam, uSummitA, uSummitB; uniform float uMistY, uMwTime;\n${GLSL_PANO}
        float r1(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        float rn(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(r1(i), r1(i + vec3(1,0,0)), f.x), mix(r1(i + vec3(0,1,0)), r1(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(r1(i + vec3(0,0,1)), r1(i + vec3(1,0,1)), f.x), mix(r1(i + vec3(0,1,1)), r1(i + vec3(1,1,1)), f.x), f.y), f.z); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 W = vMwW;
          // dark ink rock: cool slate, streaks running down, a little warmth in the grain
          float streak = rn(vec3((W.x + W.z) * 1.1, W.y * 0.15, (W.x - W.z) * 1.1));
          vec3 c = mix(vec3(0.060, 0.058, 0.066), vec3(0.11, 0.085, 0.07), rn(W * 0.6) * 0.8);
          c *= 0.8 + 0.35 * streak;
          c *= 0.95 + 0.08 * rn(W * 5.0);
          diffuseColor.rgb = c;
        }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          // the field's own gradient, per pixel and analytic: every ridge and gully of the shader at any distance. Octaves finer than
          // the pixel's footprint fade out (no shimmer). On the two carved summits the mesh normal is kept.
          vec2 p = vMwW.xz / ${K.toFixed(1)} + vec2(${FIELD_O.x}, ${FIELD_O.z}), ex = vec2(1.0, 0.0), ez = vec2(0.0, 1.0), grad = vec2(0.0);
          float fw = length(fwidth(vMwW.xz)) / ${K.toFixed(1)} + 1e-5;
          { float r0 = length(p), t0 = max(0.0, 1.0 - r0 / 0.35); if (t0 > 0.0 && r0 > 1e-4) grad += 0.6 * 6.0 * t0 * (1.0 - t0) * (-(p / r0) / 0.35); }   // the sunk origin
          float s = 2.0;
          for (int i = 0; i < MW_OCT; i++) {
            mat2 M = mat2(cos(s), sin(s), -sin(s), cos(s));
            p = p * M; ex = ex * M; ez = ez * M;
            float a = s * 0.5, v = sin(p.x * a) + sin(p.y * a);
            float w = smoothstep(2.0 * fw, 5.0 * fw, 12.566 / s);
            if (w <= 0.0) break;                                   // finer octaves are all below the pixel
            float cx = cos(p.x * a), cz = cos(p.y * a);
            grad += w * sign(v) * 0.5 * vec2(cx * ex.x + cz * ex.y, cx * ez.x + cz * ez.y);
            s *= 1.6;
          }
          vec3 Nw = normalize(vec3(grad.x * ${(KY / K).toFixed(4)}, 1.0, grad.y * ${(KY / K).toFixed(4)}));
          float onSummit = max(1.0 - smoothstep(3.0, 4.5, length(vMwW.xz - uSummitA.xy)), 1.0 - smoothstep(3.0, 4.5, length(vMwW.xz - uSummitB.xy)));   // the near needle (a smooth cone in the field): crags by bump
          vec3 Nv = normalize((viewMatrix * vec4(Nw, 0.0)).xyz);
          // on the carved summit: the mesh normal with a rock bump (crags), elsewhere the field's own
          if (onSummit > 0.001) {
          vec3 W = vMwW; float e = 0.03;
          #define RK(q) (0.45 * rn(vec3((q).x * 2.2, (q).y * 0.45, (q).z * 2.2)) + 0.35 * rn(vec3((q).x * 5.0, (q).y * 1.6, (q).z * 5.0)) + 0.2 * rn((q) * 12.0))
          float r0 = RK(W), rx = RK(W + vec3(e, 0.0, 0.0)), ry = RK(W + vec3(0.0, e, 0.0)), rz = RK(W + vec3(0.0, 0.0, e));
          vec3 gV = (viewMatrix * vec4(vec3(rx - r0, ry - r0, rz - r0) / e, 0.0)).xyz;
          vec3 Nm = normalize(normal - 0.30 * (gV - dot(gV, normal) * normal));
          normal = normalize(mix(Nv, Nm, onSummit));
          } else normal = Nv;
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          // the low sun behind a ridge lights its edge (the gold lines of the shader's peaks)
          vec3 V = normalize(vViewPosition), Lv = normalize((viewMatrix * vec4(uMwSun, 0.0)).xyz);
          float rim = pow(1.0 - clamp(abs(dot(normal, V)), 0.0, 1.0), 3.0) * (0.35 + 0.65 * pow(max(dot(-V, Lv), 0.0), 2.0));
          totalEmissiveRadiance += vec3(1.25, 0.62, 0.30) * rim * 0.45;
        }`)
      .replace('#include <fog_fragment>', `
        {
          vec3 litC = gl_FragColor.rgb;
          vec3 d = vMwW - uMwCam; float dist = length(d); vec3 dir = d / max(dist, 1e-3);
          float to = mwToward(dir);
          // aerial perspective: the colour of the sky at the horizon in this direction (warm toward the sun, violet away)
          vec3 haze = mix(vec3(0.22, 0.16, 0.30), vec3(1.15, 0.52, 0.24), to * to);
          float aerial = 1.0 - exp(-dist * 0.0016);
          // the sea of clouds: rock below its rolling top is inside the cloud (we see the cloud top instead), with a soft edge where
          // the slope enters it; a thin wet haze lies just above it
          vec3 col = gl_FragColor.rgb;
          if (dir.y < 0.0 && MW_CLOUD > 0) {
            vec2 hxz; float hd;
            vec3 cloud = mwCloud(uMwCam, dir, hxz, hd);
            float top = uCloudY + (mwN(vec3(vMwW.xz * 0.018, uCloudT * 0.012)) - 0.5) * 7.0;
            float inside = smoothstep(top + 1.5, top - 3.5, vMwW.y);
            col = mix(col, cloud, inside);
            float wisp = (1.0 - smoothstep(top, top + 7.0, vMwW.y)) * 0.45;
            col = mix(col, cloud * 0.9, wisp * (1.0 - inside));
          }
          gl_FragColor.rgb = mix(col, haze, clamp(aerial, 0.0, 1.0));
          if (uLiveOn > 0.5) {
            // the shader's own colour of this rock (it draws the same peak behind the mesh), with the mesh's crisp light on it
            vec3 lv = mwLive(vMwClip.xy / vMwClip.w * 0.5 + 0.5);
            float ll = dot(litC, vec3(0.2126, 0.7152, 0.0722));
            gl_FragColor.rgb = lv * (0.45 + 1.1 * smoothstep(0.0, 0.10, ll));
          }
        }`);
  };
  rockMat.customProgramCacheKey = () => 'mw-rock-3';
  const rockMatFar = rockMat.clone(); rockMatFar.defines = { ...rockMat.defines }; rockMatFar.onBeforeCompile = rockMat.onBeforeCompile; rockMatFar.customProgramCacheKey = () => 'mw-rock-3-far';

  function terrainMesh(cx, cz, sx, sz, nx, nz, lower) {
    const geo = new THREE.PlaneGeometry(sx, sz, nx, nz); geo.rotateX(-Math.PI / 2); geo.translate(cx, 0, cz);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); p.setY(i, heightAt(x, z) - (lower && inPatch(x, z) ? 0.03 : 0)); }
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, rockMat); mesh.receiveShadow = true; scene.add(mesh); occluders.push(mesh);
    return mesh;
  }
  // the range: polar grid around the flight; cells of 1 m near it, growing with the distance (the angular spacing) out to 1.4 km
  {
    const { cx, cz, N, R, minCell } = FAR, radii = [0];
    while (radii[radii.length - 1] < R) { const r = radii[radii.length - 1]; radii.push(r + Math.max(minCell, r * 2 * Math.PI / N)); }
    const pos = new Float32Array(radii.length * N * 3), idx = [];
    radii.forEach((r, i) => {
      const cell = Math.max(minCell, r * 2 * Math.PI / N);
      for (let j = 0; j < N; j++) {
        const a = (j / N) * Math.PI * 2, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r, o = (i * N + j) * 3;
        const fx = x / K + FIELD_O.x, fz = z / K + FIELD_O.z;
        let y = Y0 - (fieldGFiltered(fx, fz, cell) + ORIGIN_SINK(fx, fz)) * KY;
        for (const P of [PEAK, LEDGE]) if (Math.hypot(x - P.x, z - P.z) < 3 * P.r) y = heightAt(x, z);   // the carved summits
        if (inPatch(x, z)) y -= 0.03;                                       // the fine patch covers it there
        pos[o] = x; pos[o + 1] = y; pos[o + 2] = z;
      }
    });
    for (let i = 0; i < radii.length - 1; i++) for (let j = 0; j < N; j++) {
      const a = i * N + j, b = i * N + (j + 1) % N, c = (i + 1) * N + j, d = (i + 1) * N + (j + 1) % N;
      idx.push(a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
    // no shadows on the range (her shadow only ever falls on the summits, which are the patches): the PCF lookups cost ~3 ms
    // live: the range only writes DEPTH (it hides her behind a peak; the picture is the shader's), with a trivial material
    const mesh = new THREE.Mesh(geo, LIVE ? new THREE.MeshBasicMaterial({ colorWrite: false }) : rockMatFar); mesh.receiveShadow = false; mesh.frustumCulled = false; scene.add(mesh); occluders.push(mesh);
  }
  for (const q of PATCHES) terrainMesh(q.x, q.z, q.size, q.size, q.seg, q.seg, false);

  const live = LIVE ? createMountainLive({ K, KY, Y0, FIELD_O, scale: +(globalThis.location ? new URLSearchParams(location.search).get('ls') ?? 0.25 : 0.25), hiScale: +(globalThis.location ? new URLSearchParams(location.search).get('lhs') ?? 0.6 : 0.6) }) : null;
  if (live) { U.uLive.value = live.out.lo; U.uLiveHi.value = live.out.hi; }
  return {
    live,
    /** the live shader pass: call once a frame before the scene is drawn */
    renderLive(renderer, camera) { if (live) { live.render(renderer, camera); U.uLiveMix.value = live.out.mix; } },
    heightAt, surfaceAt, PEAK, LEDGE, CLOUD_Y, MIST_Y, SUN_DIR, occluders, sky, uniforms: U,
    sunColor: new THREE.Color(1.0, 0.70, 0.45), skyLight: new THREE.Color(0.40, 0.36, 0.62), groundLight: new THREE.Color(0.95, 0.70, 0.62),   // ground = the sunlit cloud sea below
    /** bakes the far world from her perch (async: show the loader). onProgress(0..1) */
    async bakeFar(renderer, onProgress) {
      if (!(globalThis.location && new URLSearchParams(location.search).get('pano') === '1')) { onProgress?.(1); return; }
      // camera heights in shader units above the origin peak: at her eye on the perch, and high in the flight
      const tex = await bakeMountainPanoramas(renderer, { heights: [(PEAK.top + 1.2 - Y0) / K, (PEAK.top + 6 - Y0) / K], onProgress });
      U.uPanoA.value = tex[0]; U.uPanoB.value = tex[1]; U.uPanoOn.value = 1;
    },
    update({ time, camera }) {
      U.uMwCam.value.copy(camera.position); U.uMwTime.value = time; U.uCloudT.value = time;
      U.uPanoMix.value = Math.min(1, Math.max(0, (camera.position.y - (PEAK.top + 1.2)) / 4.8));
      sky.position.copy(camera.position);
    },
  };
}

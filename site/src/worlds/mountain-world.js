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

export const K = 30;                       // metres per shader unit
export const Y0 = 19;                      // world height of the field's origin peak (her perch)
export const MIST_Y = Y0 - 0.5 * K;        // the top of the valley mist (the cloud sea between the peaks)
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
const fieldWorldH = (X, Z) => Y0 - fieldG(X / K, Z / K) * K;

// the two perches: a small rock summit carved on each needle (a dome of radius r, its top a little below the needle's tip)
export const PEAK = { x: 0, z: 0, r: 0.75 };
export const LEDGE = { x: -0.53 * K, z: -1.43 * K, r: 1.2 };
PEAK.top = fieldWorldH(PEAK.x, PEAK.z) - 0.22;
LEDGE.top = fieldWorldH(LEDGE.x, LEDGE.z) - 0.2;
const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
const vnoise = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; };
function summit(X, Z, P) {
  const r = Math.hypot(X - P.x, Z - P.z) / P.r;
  // a dome over the needle: gentle on top, falling fast beyond its radius (it merges into the flanks of the peak)
  const dome = P.top - 0.22 * r * r - 2.2 * Math.pow(Math.max(0, r - 1), 1.5);
  const rock = 0.06 * (vnoise(X * 3.1 + P.x, Z * 3.1) - 0.5) + 0.025 * (vnoise(X * 9, Z * 9 + P.z) - 0.5);
  return dome + rock * Math.exp(-r * r * 0.5);
}
export function heightAt(X, Z) {
  let h = fieldWorldH(X, Z);
  // on the two perches the needle's tip is REPLACED by the carved summit (it poked up through her), merging back into the field
  for (const P of [PEAK, LEDGE]) if (Math.abs(X - P.x) < 4 * P.r && Math.abs(Z - P.z) < 4 * P.r) {
    const hs = summit(X, Z, P), w = Math.min(1, Math.max(0, (Math.hypot(X - P.x, Z - P.z) / P.r - 1.2) / 0.6)), ws = w * w * (3 - 2 * w);
    h = hs + (Math.max(h, hs) - hs) * ws;
  }
  return h;
}

// ───────────── meshes: a big near field + two fine patches on the summits ─────────────
const BASE = { cx: -6, cz: -18, sx: 160, sz: 190, cell: 0.9 };
export const PATCHES = [{ x: PEAK.x, z: PEAK.z, size: 6, seg: 150 }, { x: LEDGE.x, z: LEDGE.z, size: 7, seg: 160 }];
const inPatch = (x, z) => PATCHES.some((q) => Math.abs(x - q.x) < q.size / 2 - 0.15 && Math.abs(z - q.z) < q.size / 2 - 0.15);
const SURF = [...PATCHES.map((q) => ({ cx: q.x, cz: q.z, sx: q.size, sz: q.size, nx: q.seg, nz: q.seg })),
  { cx: BASE.cx, cz: BASE.cz, sx: BASE.sx, sz: BASE.sz, nx: Math.round(BASE.sx / BASE.cell), nz: Math.round(BASE.sz / BASE.cell) }];
const surfCache = SURF.map(() => new Map());
/** the height of the RENDERED terrain (the mesh triangles, cached corners) */
export function surfaceAt(x, z) {
  let k = SURF.length - 1;
  for (let i = 0; i < PATCHES.length; i++) { const q = SURF[i]; if (Math.abs(x - q.cx) < q.sx / 2 && Math.abs(z - q.cz) < q.sz / 2) { k = i; break; } }
  const q = SURF[k], cx = q.sx / q.nx, cz = q.sz / q.nz, gx = (x - q.cx + q.sx / 2) / cx, gz = (z - q.cz + q.sz / 2) / cz;
  const ix = Math.min(q.nx - 1, Math.max(0, Math.floor(gx))), iz = Math.min(q.nz - 1, Math.max(0, Math.floor(gz))), fx = gx - ix, fz = gz - iz;
  const H = (a, b) => { const key = a * 8192 + b, m = surfCache[k]; let h = m.get(key); if (h === undefined) { h = heightAt(q.cx - q.sx / 2 + a * cx, q.cz - q.sz / 2 + b * cz) - (k === SURF.length - 1 && inPatch(q.cx - q.sx / 2 + a * cx, q.cz - q.sz / 2 + b * cz) ? 0.03 : 0); m.set(key, h); } return h; };
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
}`;

export function createMountainWorld({ scene }) {
  const U = { uPanoA: { value: null }, uPanoB: { value: null }, uPanoMix: { value: 0 }, uPanoOn: { value: 0 }, uMwSun: { value: SUN_DIR.clone() },
    uMwCam: { value: new THREE.Vector3() }, uMwTime: { value: 0 }, uMistY: { value: MIST_Y } };
  const occluders = [];

  // ───────── sky: our sunset above the horizon, the baked mountains below ─────────
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, uniforms: U,
    vertexShader: 'varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */`uniform float uMwTime; varying vec3 vD;
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
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(480, 48, 24), skyMat); sky.renderOrder = -1; sky.frustumCulled = false; scene.add(sky);

  // ───────── the near mountains (same field), styled like the shader: dark ink rock, warm edges, mist in the valleys ─────────
  const rockMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0, envMapIntensity: 0 });
  rockMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vMwW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvMwW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vMwW;\nuniform vec3 uMwCam; uniform float uMistY;\n${GLSL_PANO}
        float r1(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        float rn(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(r1(i), r1(i + vec3(1,0,0)), f.x), mix(r1(i + vec3(0,1,0)), r1(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(r1(i + vec3(0,0,1)), r1(i + vec3(1,0,1)), f.x), mix(r1(i + vec3(0,1,1)), r1(i + vec3(1,1,1)), f.x), f.y), f.z); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 W = vMwW;
          // dark ink rock: cool slate, streaks running down, a little warmth in the grain
          float streak = rn(vec3((W.x + W.z) * 1.1, W.y * 0.15, (W.x - W.z) * 1.1));
          vec3 c = mix(vec3(0.026, 0.026, 0.032), vec3(0.055, 0.042, 0.036), rn(W * 0.6) * 0.8);
          c *= 0.8 + 0.35 * streak;
          c *= 0.95 + 0.08 * rn(W * 5.0);
          diffuseColor.rgb = c;
        }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec3 W = vMwW; float e = 0.02;
          #define RK(q) (0.45 * rn(vec3((q).x * 9.0, (q).y * 2.0, (q).z * 9.0)) + 0.35 * rn((q) * 22.0) + 0.2 * rn((q) * 55.0))
          float r0 = RK(W), rx = RK(W + vec3(e, 0.0, 0.0)), ry = RK(W + vec3(0.0, e, 0.0)), rz = RK(W + vec3(0.0, 0.0, e));
          vec3 gV = (viewMatrix * vec4(vec3(rx - r0, ry - r0, rz - r0) / e, 0.0)).xyz;
          normal = normalize(normal - 0.03 * (gV - dot(gV, normal) * normal));
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
          // haze: the far world's own colour in this direction (so the mesh melts into the panorama), and mist in the valleys:
          // exponential height fog integrated along the ray
          vec3 d = vMwW - uMwCam; float dist = length(d); vec3 dir = d / max(dist, 1e-3);
          vec3 far = uPanoOn > 0.5 ? mwPano(normalize(vec3(dir.x, min(dir.y, 0.02), dir.z))) : vec3(0.35, 0.3, 0.45);
          float aerial = smoothstep(48.0, 78.0, length(vMwW.xz)) * 0.9 + (1.0 - exp(-dist * 0.006)) * 0.35;   // the edge of the mesh melts into the panorama
          float hk = 0.22, dens = 0.035;
          float a = uMwCam.y - uMistY, b = vMwW.y - uMistY;
          float dy = b - a;
          float od = abs(dy) > 1e-3 ? dens * dist * (exp(-hk * a) - exp(-hk * b)) / (hk * dy) : dens * dist * exp(-hk * a);
          float mist = 1.0 - exp(-max(od, 0.0));
          vec3 mistC = far * 1.1 + vec3(0.05, 0.05, 0.09);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, mistC, clamp(max(aerial, mist), 0.0, 1.0));
        }`);
  };
  rockMat.customProgramCacheKey = () => 'mw-rock-1';

  function terrainMesh(cx, cz, sx, sz, nx, nz, lower) {
    const geo = new THREE.PlaneGeometry(sx, sz, nx, nz); geo.rotateX(-Math.PI / 2); geo.translate(cx, 0, cz);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); p.setY(i, heightAt(x, z) - (lower && inPatch(x, z) ? 0.03 : 0)); }
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, rockMat); mesh.receiveShadow = true; scene.add(mesh); occluders.push(mesh);
    return mesh;
  }
  terrainMesh(BASE.cx, BASE.cz, BASE.sx, BASE.sz, Math.round(BASE.sx / BASE.cell), Math.round(BASE.sz / BASE.cell), true);
  for (const q of PATCHES) terrainMesh(q.x, q.z, q.size, q.size, q.seg, q.seg, false);

  return {
    heightAt, surfaceAt, PEAK, LEDGE, CLOUD_Y, MIST_Y, SUN_DIR, occluders, sky, uniforms: U,
    sunColor: new THREE.Color(1.0, 0.70, 0.45), skyLight: new THREE.Color(0.45, 0.38, 0.62), groundLight: new THREE.Color(0.55, 0.42, 0.50),
    /** bakes the far world from her perch (async: show the loader). onProgress(0..1) */
    async bakeFar(renderer, onProgress) {
      // camera heights in shader units above the origin peak: at her eye on the perch, and high in the flight
      const tex = await bakeMountainPanoramas(renderer, { heights: [(PEAK.top + 1.2 - Y0) / K, (PEAK.top + 6 - Y0) / K], onProgress });
      U.uPanoA.value = tex[0]; U.uPanoB.value = tex[1]; U.uPanoOn.value = 1;
    },
    update({ time, camera }) {
      U.uMwCam.value.copy(camera.position); U.uMwTime.value = time;
      U.uPanoMix.value = Math.min(1, Math.max(0, (camera.position.y - (PEAK.top + 1.2)) / 4.8));
      sky.position.copy(camera.position);
    },
  };
}

// The phoenix's world (the opening, and with another sky the rebirth): sandstone pillars piercing a SEA OF CLOUDS at sunset
// (Zhangjiajie, Chinese landscape painting). Everything here is built once; update() moves the clouds and the light.
//
//   * the two perch pillars are a HEIGHTFIELD known in JS (heightAt / surfaceAt): her feet, claws and tail touch them exactly;
//   * the other pillars are instanced meshes (four sculpted variants), placed away from her flight path;
//   * the cloud sea is one displaced grid (big swells moving with the wind) shaded as a dense cloud top: wrap light, silver lining
//     toward the sun, troughs in shadow, her fire lighting the clouds under her, and a soft wispy break-up around every pillar;
//     two thin mist layers drift above it;
//   * one aerial-perspective fog shared by rock, pines and clouds: warm toward the sun, violet away from it, thicker near the clouds.
//
// All colours are LINEAR (the post chain applies ACES + sRGB at the end).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { bakeMountainPanoramas, PANO_LAT_TOP } from './mountain-panorama.js';

export const PANO_HEIGHTS = (globalThis.location ? new URLSearchParams(location.search).get('ph') ?? '0.42,0.8' : '0.42,0.8').split(',').map(Number);   // shader-unit camera heights of the far panoramas (low: the peaks reach the horizon)
export const CLOUD_Y = 8.0;                         // the mean top of the cloud sea
export const PEAK = { x: 0, z: 0, top: 19.0, r: 1.75 };         // her pillar: tall and slender, 11 m of wall above the clouds
export const LEDGE = { x: -12, z: -40, top: 14.0, r: 2.6 };    // where she lands
export const SUN_DIR = new THREE.Vector3(0.52, 0.16, 0.85).normalize();   // low, BEHIND her in the opening shot (she is backlit)

// ───────────── noise (JS) ─────────────
const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
const vnoise = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; };
const fbm = (x, y) => 0.5 * vnoise(x, y) + 0.3 * vnoise(x * 2.03 + 7.1, y * 2.03 - 3.3) + 0.2 * vnoise(x * 4.1 - 1.7, y * 4.1 + 5.2);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ───────────── the perch pillars: a heightfield ─────────────
const FLOOR = -30.0;                                // far below: the pillars sink into the mist (no floor is ever seen)
/** a sandstone pillar: fluted walls (angular noise), a domed, uneven summit, a rounded lip */
function pillarH(x, z, P, seed) {
  const dx = x - P.x, dz = z - P.z, d = Math.hypot(dx, dz), ang = Math.atan2(dz, dx);
  const flute = 0.07 * Math.sin(ang * 9 + seed) + 0.05 * (fbm(Math.cos(ang) * 2.5 + seed, Math.sin(ang) * 2.5) - 0.5) * 2;
  const R = P.r * (1 + flute);
  const q = d / R;
  // the summit: a gentle dome (the rim ~0.45 below the crown) with small rock relief
  const top = P.top - 0.45 * q * q + 0.14 * (fbm(x * 1.6 + seed, z * 1.6) - 0.5) + 0.05 * (vnoise(x * 6, z * 6 + seed) - 0.5) + 0.02 * (vnoise(x * 17, z * 17) - 0.5);
  const wall = smooth(1.12, 0.92, q);                 // the cliff: ~0.2 R from summit to sheer wall
  return FLOOR + (top - FLOOR) * wall;
}
export function heightAt(x, z) {
  return Math.max(FLOOR, pillarH(x, z, PEAK, 1.3), pillarH(x, z, LEDGE, 4.7));
}
export const PATCHES = [{ x: PEAK.x, z: PEAK.z, size: 5.6, seg: 120 }, { x: LEDGE.x, z: LEDGE.z, size: 7.2, seg: 140 }];
const SURF = [...PATCHES.map((q) => ({ cx: q.x, cz: q.z, size: q.size, seg: q.seg }))];
const surfCache = SURF.map(() => new Map());
/** height of the RENDERED terrain (the patch triangles, cached corners); outside the patches the (unseen) floor */
export function surfaceAt(x, z) {
  let k = -1;
  for (let i = 0; i < SURF.length; i++) { const q = SURF[i]; if (Math.abs(x - q.cx) < q.size / 2 && Math.abs(z - q.cz) < q.size / 2) { k = i; break; } }
  if (k < 0) return heightAt(x, z);
  const q = SURF[k], cell = q.size / q.seg, gx = (x - q.cx + q.size / 2) / cell, gz = (z - q.cz + q.size / 2) / cell;
  const ix = Math.min(q.seg - 1, Math.max(0, Math.floor(gx))), iz = Math.min(q.seg - 1, Math.max(0, Math.floor(gz))), fx = gx - ix, fz = gz - iz;
  const H = (a, b) => { const key = a * 4096 + b, m = surfCache[k]; let h = m.get(key); if (h === undefined) { h = heightAt(q.cx - q.size / 2 + a * cell, q.cz - q.size / 2 + b * cell); m.set(key, h); } return h; };
  const ha = H(ix, iz), hb = H(ix, iz + 1), hc = H(ix + 1, iz + 1), hd = H(ix + 1, iz);
  return fx + fz <= 1 ? ha + (hd - ha) * fx + (hb - ha) * fz : hc + (hb - hc) * (1 - fx) + (hd - hc) * (1 - fz);
}

// ───────────── shared GLSL: value noise, aerial fog ─────────────
const GLSL_NOISE = /* glsl */`
float csHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float csNoise(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(csHash(i), csHash(i + vec3(1,0,0)), f.x), mix(csHash(i + vec3(0,1,0)), csHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(csHash(i + vec3(0,0,1)), csHash(i + vec3(1,0,1)), f.x), mix(csHash(i + vec3(0,1,1)), csHash(i + vec3(1,1,1)), f.x), f.y), f.z); }
float csFbm(vec3 p) { return 0.5 * csNoise(p) + 0.3 * csNoise(p * 2.03 + 3.1) + 0.2 * csNoise(p * 4.1 + 7.7); }`;
const GLSL_FOG = /* glsl */`
uniform vec3 uCsSun, uCsFogSun, uCsFogAway, uCsCam;
uniform float uCsFogDen, uCsCloudY;
// aerial perspective: the haze takes the colour of the sky behind it (warm toward the sun, violet away); thicker low (near the clouds)
vec3 csFog(vec3 col, vec3 W) {
  vec3 d = W - uCsCam; float dist = length(d);
  float s = pow(max(dot(d / max(dist, 1e-3), uCsSun), 0.0), 4.0);
  vec3 fc = mix(uCsFogAway, uCsFogSun, s);
  float lowK = 1.0 + 2.2 * smoothstep(uCsCloudY + 5.0, uCsCloudY, W.y);
  float f = 1.0 - exp(-dist * uCsFogDen * lowK);
  return mix(col, fc, f);
}`;

export function createCloudSea({ scene, avoid = [], quality = 1, near = false }) {
  const fogU = {
    uCsSun: { value: SUN_DIR.clone() }, uCsFogSun: { value: new THREE.Color(1.05, 0.48, 0.24) }, uCsFogAway: { value: new THREE.Color(0.13, 0.10, 0.22) },
    uCsCam: { value: new THREE.Vector3() }, uCsFogDen: { value: 0.0042 }, uCsCloudY: { value: CLOUD_Y },
  };
  const occluders = [];

  // ───────── sky ─────────
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uSun: fogU.uCsSun, uTime: { value: 0 }, uPanoA: { value: null }, uPanoB: { value: null }, uPanoMix: { value: 0 }, uPanoOn: { value: 0 }, uYaw: { value: 0.6 } },
    vertexShader: 'varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */`uniform vec3 uSun; uniform float uTime, uPanoMix, uPanoOn, uYaw; uniform sampler2D uPanoA, uPanoB; varying vec3 vD;
      ${GLSL_NOISE}
      void main() {
        vec3 d = normalize(vD); float h = d.y, sd = dot(d, uSun);
        float toward = smoothstep(-0.4, 1.0, sd);
        // the horizon: violet-grey away from the sun, gold-peach toward it; the zenith a deep indigo
        vec3 horAway = vec3(0.24, 0.17, 0.32), horSun = vec3(1.25, 0.52, 0.22);
        vec3 hor = mix(horAway, horSun, toward * toward);
        vec3 mid = mix(vec3(0.10, 0.08, 0.20), vec3(0.55, 0.22, 0.20), toward * toward * toward);
        vec3 zen = vec3(0.025, 0.025, 0.07);
        float hh = clamp(h, 0.0, 1.0);
        vec3 c = mix(hor, mid, smoothstep(0.0, 0.18, hh));
        c = mix(c, zen, smoothstep(0.12, 0.75, hh));
        // the sun: wide glow, tight halo, the disc (HDR: it feeds the bloom)
        float s = max(sd, 0.0);
        c += vec3(1.0, 0.45, 0.18) * pow(s, 5.0) * 0.55 + vec3(1.0, 0.68, 0.38) * pow(s, 60.0) * 1.4;
        c += vec3(1.0, 0.86, 0.62) * smoothstep(0.99955, 0.99975, sd) * 10.0;
        // high cirrus: thin streaks, lit from below by the sunset
        if (h > 0.0) {
          vec2 q = d.xz / (h + 0.12);
          float ci = csFbm(vec3(q.x * 1.3 + uTime * 0.004, q.y * 5.0, 0.5));
          ci = smoothstep(0.55, 0.85, ci) * smoothstep(0.0, 0.08, h) * (1.0 - smoothstep(0.35, 0.7, h));
          c += mix(vec3(0.35, 0.18, 0.28), vec3(1.4, 0.6, 0.3), toward) * ci * 0.45;
        }
        // first stars, away from the sun
        vec3 sp = floor(d * 380.0);
        float st = step(0.9975, csHash(sp)) * smoothstep(0.25, 0.7, h) * (1.0 - toward);
        c += vec3(0.8, 0.85, 1.0) * st * 0.8;
        // below the horizon: the haze over the cloud sea
        c = mix(c, mix(horAway, horSun, toward) * 0.8, smoothstep(0.0, -0.06, h));
        // the far world: baked panoramas of the mountain/cloud field (S. Guillitte, fddSzl), crossfaded by the camera's height,
        // tinted by the sunset (warm toward the sun, blue away); our sky takes over just above the horizon
        if (uPanoOn > 0.5) {
          float lat = asin(clamp(h, -1.0, 1.0)), lon = atan(d.x, -d.z) + uYaw;
          vec2 uv = vec2(lon / 6.2831853 + 0.5, (lat + 1.5707963) / (1.5707963 + ${PANO_LAT_TOP.toFixed(4)}));
          if (uv.y < 1.0) {
            vec3 pa = texture2D(uPanoA, uv).rgb, pb = texture2D(uPanoB, uv).rgb;
            vec3 pc = mix(pa, pb, uPanoMix);
            pc = pow(pc, vec3(2.2));                                      // display values -> linear light
            float lum = dot(pc, vec3(0.2126, 0.7152, 0.0722));
            // grade: shadows blue-violet, mid tones rose, highlights gold toward the sun; the haze is compressed (it was white)
            vec3 shadowT = vec3(0.30, 0.34, 0.62), midT = vec3(0.95, 0.62, 0.62), hiT = mix(vec3(1.0, 0.80, 0.62), vec3(1.25, 0.70, 0.36), toward);
            vec3 tint = mix(shadowT, midT, smoothstep(0.02, 0.25, lum));
            tint = mix(tint, hiT, smoothstep(0.25, 0.85, lum));
            float L = lum / (1.0 + 0.6 * lum) * 1.25;                    // soft shoulder on the bright haze
            pc = tint * L * mix(0.85, 1.25, toward);
            float w = 1.0 - smoothstep(-0.03, 0.05, lat);
            c = mix(c, pc, w);
          }
        }
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(480, 48, 24), skyMat); sky.renderOrder = -1; sky.frustumCulled = false; scene.add(sky);

  // ───────── rock material (perch heightfield, instanced pillars) ─────────
  function rockMaterial() {
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0, envMapIntensity: 0 });   // no grey room fill: sun and sky only
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, fogU);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vRockW;')
        .replace('#include <project_vertex>', `#include <project_vertex>
          #ifdef USE_INSTANCING
            vRockW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
          #else
            vRockW = (modelMatrix * vec4(transformed, 1.0)).xyz;
          #endif`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vRockW;\n${GLSL_NOISE}\n${GLSL_FOG}`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          {
            vec3 W = vRockW, Nw = inverseTransformDirection(normalize(vNormal), viewMatrix);
            // sandstone: grey-tan, vertical water stains running down the walls, horizontal strata, fine grain
            float stain = csFbm(vec3((W.x + W.z) * 0.9, W.y * 0.12, (W.x - W.z) * 0.9));
            float strata = csNoise(vec3(W.x * 0.3, W.y * 3.0, W.z * 0.3) + csNoise(W * 0.5) * 2.0);
            float grain = csNoise(W * 7.0);
            vec3 sand = vec3(0.075, 0.072, 0.080), stainC = vec3(0.018, 0.018, 0.024), warm = vec3(0.16, 0.11, 0.08);
            vec3 c = mix(sand, warm, csNoise(W * 0.35) * 0.7);
            c = mix(c, stainC, smoothstep(0.40, 0.72, stain) * 0.85);
            // horizontal cracks between the sandstone beds
            float crack = smoothstep(0.985, 0.998, 0.5 + 0.5 * sin(W.y * 3.1 + csNoise(W * 0.7) * 5.0 + csNoise(W * 2.3) * 1.2)) * smoothstep(0.55, 0.75, csNoise(W * 1.3 + 9.0));
            c *= (0.78 + 0.30 * strata + 0.16 * (grain - 0.5)) * (1.0 - 0.6 * crack);
            // moss and low scrub on the flat tops and ledges
            float veg = smoothstep(0.80, 0.95, Nw.y) * smoothstep(0.50, 0.72, csFbm(W * 1.3 + 4.0));
            c = mix(c, vec3(0.035, 0.05, 0.03), veg * 0.75);
            c *= 0.85 + 0.3 * csNoise(W * 13.0);                       // lichen speckle
            // the foot of the pillars melts into the cloud sea
            c = mix(c, vec3(0.10, 0.12, 0.20), smoothstep(uCsCloudY + 6.0, uCsCloudY - 4.0, W.y));
            diffuseColor.rgb = c;
          }`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          {
            // rock relief without a texture: the gradient of a world-space noise bends the normal (flutes run down the walls)
            vec3 W = vRockW;
            float e = 0.06;
            #define ROCKH(q) (0.55 * csNoise(vec3((q).x * 2.2, (q).y * 0.35, (q).z * 2.2)) + 0.30 * csNoise((q) * 1.7 + 3.0) + 0.15 * csNoise((q) * 6.0))
            float r0 = ROCKH(W), rx = ROCKH(W + vec3(e, 0.0, 0.0)), ry = ROCKH(W + vec3(0.0, e, 0.0)), rz = ROCKH(W + vec3(0.0, 0.0, e));
            vec3 gW = vec3(rx - r0, ry - r0, rz - r0) / e;
            vec3 gV = (viewMatrix * vec4(gW, 0.0)).xyz;
            normal = normalize(normal - 0.35 * (gV - dot(gV, normal) * normal));
          }`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          {
            // the low sun behind a pillar draws a warm line along its silhouette
            vec3 V = normalize(vViewPosition), Lv = normalize((viewMatrix * vec4(uCsSun, 0.0)).xyz);
            float rim = pow(1.0 - clamp(abs(dot(normal, V)), 0.0, 1.0), 4.0) * pow(max(dot(-V, Lv), 0.0), 2.0);
            totalEmissiveRadiance += vec3(1.3, 0.55, 0.22) * rim * 1.6;
          }`)
        .replace('#include <fog_fragment>', `gl_FragColor.rgb = csFog(gl_FragColor.rgb, vRockW);
          // below the cloud level the pillar is swallowed by the mist of the far world
          gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.16, 0.19, 0.30), smoothstep(uCsCloudY + 2.0, uCsCloudY - 6.0, vRockW.y));`);
    };
    m.customProgramCacheKey = () => 'cs-rock-3';
    return m;
  }
  const rockMat = rockMaterial();

  // perch pillars (the heightfield patches; their walls go down into the clouds)
  for (const q of PATCHES) {
    const geo = new THREE.PlaneGeometry(q.size, q.size, q.seg, q.seg); geo.rotateX(-Math.PI / 2); geo.translate(q.x, 0, q.z);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, rockMat); mesh.receiveShadow = true; mesh.castShadow = false; scene.add(mesh); occluders.push(mesh);
  }

  // ───────── the other pillars: four sculpted variants, instanced ─────────
  // a quartz-sandstone column: few radial segments (faceted faces, not a smooth tube), stacked blocks that step in and out,
  // a slight taper, a flat top. Normals on the non-indexed geometry: hard facets catch the low sun like rock does.
  function pillarGeometry(seed) {
    const seg = 9 + (Math.round(seed) % 4), rows = 26;
    const g = new THREE.CylinderGeometry(1, 1, 1, seg, rows, false); g.translate(0, 0.5, 0);   // y 0 .. 1
    const p = g.attributes.position;
    const blocks = Array.from({ length: rows + 1 }, (_, k) => 1 + 0.10 * (vnoise(k * 0.9 + seed, seed * 0.3) - 0.5) * 2);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), r = Math.hypot(x, z);
      if (r < 1e-4) { if (y > 0.99) p.setY(i, 1.0); continue; }
      const ang = Math.atan2(z, x), row = Math.round(y * rows);
      let f = blocks[row] * (1 + 0.14 * (fbm(Math.cos(ang) * 1.7 + seed, Math.sin(ang) * 1.7 + row * 0.15) - 0.5) * 2);
      f *= 1 + 0.12 * (1 - y);                                   // a slight taper
      p.setX(i, x * f); p.setZ(i, z * f);
      if (y > 0.99) p.setY(i, 1 + 0.008 * (vnoise(x * 3 + seed, z * 3) - 0.5));
    }
    const ng = g.toNonIndexed(); ng.computeVertexNormals();
    return ng;
  }
  const variants = [0, 1, 2, 3].map((k) => pillarGeometry(k * 13.7 + 2));
  // placement: away from her path (xz polyline), away from the two perches, not overlapping
  const pathD = (x, z) => { let m = Infinity; for (let i = 0; i < avoid.length - 1; i++) { const [ax, , az] = avoid[i], [bx, , bz] = avoid[i + 1]; const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz || 1; const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / l2)); m = Math.min(m, Math.hypot(x - ax - vx * t, z - az - vz * t)); } return m; };
  const placed = [];
  let seed = 1;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const N = near ? Math.round(55 * quality) : 0;
  for (let tries = 0; placed.length < N && tries < 6000; tries++) {
    const a = rnd() * Math.PI * 2, rr = 10 + Math.pow(rnd(), 0.9) * 75, x = -6 + Math.cos(a) * rr, z = -20 + Math.sin(a) * rr;
    const r = 1.1 + rnd() * 2.2 * (rr > 80 ? 1.6 : 1);
    if (pathD(x, z) < r + 5) continue;
    if (Math.hypot(x - PEAK.x, z - PEAK.z) < r + 6 || Math.hypot(x - LEDGE.x, z - LEDGE.z) < r + 6) continue;
    { const dz = z - PEAK.z, dx = x - PEAK.x; if (dz > 0 && dz < 160 && Math.abs(dx) < 0.32 * dz + r + 3) continue; }   // the opening's backdrop stays open
    if (placed.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + r + 1.2)) continue;
    const top = CLOUD_Y + 3 + Math.pow(rnd(), 1.3) * (rr > 60 ? 26 : 14);
    placed.push({ x, z, r, top, v: Math.floor(rnd() * 4), rot: rnd() * Math.PI * 2 });
  }
  const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P3 = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
  variants.forEach((geo, v) => {
    const list = placed.filter((o) => o.v === v); if (!list.length) return;
    const im = new THREE.InstancedMesh(geo, rockMat, list.length);
    list.forEach((o, i) => { Q.setFromAxisAngle(Y, o.rot); S.set(o.r, o.top - 1, o.r); P3.set(o.x, 1, o.z); im.setMatrixAt(i, M4.compose(P3, Q, S)); });
    im.frustumCulled = false; im.receiveShadow = false; scene.add(im); occluders.push(im);
  });

  // ───────── pines: horizontal tiers of needles (the pine of Chinese painting), on the pillar tops ─────────
  const pineGeo = (() => {
    const parts = [];
    // a leaning, slightly bent trunk, and lumpy flat pads of needles off to the sides (the pine of Chinese painting)
    const trunk = new THREE.CylinderGeometry(0.025, 0.055, 1, 5, 4); trunk.translate(0, 0.5, 0);
    const tp = trunk.attributes.position; for (let i = 0; i < tp.count; i++) { const y = tp.getY(i); tp.setX(i, tp.getX(i) + 0.12 * y * y); }
    parts.push(trunk);
    const pads = [[0.45, 0.30, -0.18, 0.07], [0.62, 0.26, 0.16, 0.06], [0.78, 0.22, -0.05, 0.06], [0.93, 0.16, 0.14, 0.05], [1.03, 0.10, 0.10, 0.045]];
    pads.forEach(([y, r, ox, h], k) => {
      const pad = new THREE.IcosahedronGeometry(1, 1);
      const pp = pad.attributes.position;
      for (let i = 0; i < pp.count; i++) { const n = 0.75 + 0.5 * vnoise(pp.getX(i) * 3 + k * 5, pp.getZ(i) * 3 + pp.getY(i) * 2); pp.setXYZ(i, pp.getX(i) * n, pp.getY(i) * n, pp.getZ(i) * n); }
      pad.scale(r * 1.3, h, r); pad.translate(ox + 0.12 * y * y, y, (k % 2 ? 0.05 : -0.04)); parts.push(pad);
    });
    const g = mergeGeometries(parts.map((q) => q.toNonIndexed()));
    g.computeVertexNormals();
    return g;
  })();
  const pineMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.025, 0.035, 0.025), roughness: 1, envMapIntensity: 0 });
  pineMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, fogU);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vRockW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvRockW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vRockW;\n${GLSL_FOG}`)
      .replace('#include <fog_fragment>', 'gl_FragColor.rgb = csFog(gl_FragColor.rgb, vRockW);');
  };
  pineMat.customProgramCacheKey = () => 'cs-pine-1';
  const pines = [];
  for (const o of placed) {
    if (Math.hypot(o.x + 6, o.z + 20) > 120) continue;
    const n = 3 + Math.floor(rnd() * 7);
    for (let k = 0; k < n; k++) { const a = rnd() * Math.PI * 2, rr = o.r * (0.3 + rnd() * 0.55); pines.push({ x: o.x + Math.cos(a) * rr, y: o.top - 0.05, z: o.z + Math.sin(a) * rr, s: (0.5 + rnd() * 1.0) * Math.min(1.6, 0.6 + o.r * 0.35), rot: rnd() * 6.28 }); }
  }
  // a few on the landing pillar's rim, and one gnarled pine behind her on the perch (framing; away from where she stands)
  for (const [P, list] of []) {
    for (const [a, s] of list) { const r = P.r * 0.86, x = P.x + Math.cos(a) * r, z = P.z + Math.sin(a) * r; pines.push({ x, y: heightAt(x, z) - 0.03, z, s, rot: a }); }
  }
  const pineMesh = new THREE.InstancedMesh(pineGeo, pineMat, Math.max(1, pines.length)); pineMesh.count = pines.length;
  pines.forEach((o, i) => { Q.setFromAxisAngle(Y, o.rot); S.setScalar(o.s); P3.set(o.x, o.y, o.z); pineMesh.setMatrixAt(i, M4.compose(P3, Q, S)); });
  pineMesh.frustumCulled = false; scene.add(pineMesh);

  // ───────── the cloud sea: a short volumetric march through its fuzzy top ─────────
  // H(x, z): the height of the cloud surface (metres above CLOUD_Y), baked once into a tileable texture (swells, cumulus billows,
  // puffs) that drifts with the wind. A displaced mesh (the ENVELOPE, a little above H) starts every pixel's ray; the fragment
  // marches 8 steps into the cloud: soft density at the boundary, light from the sun through the cloud above the sample (one tap),
  // a forward + back phase (silver lining toward the sun), powder at the edges, sky light from above and her fire from close by.
  // What the 8 steps do not reach is the dense body of the cloud (opaque). Pillars: a baked distance mask parts the clouds.
  const TILE = 240, MASK_SIZE = 600, MASK_O = new THREE.Vector2(-6, -20);
  const hTex = bakeCloudHeight(512);
  const allPillars = [{ x: PEAK.x, z: PEAK.z, r: PEAK.r }, { x: LEDGE.x, z: LEDGE.z, r: LEDGE.r }, ...placed];
  const maskTex = bakePillarMask(allPillars, MASK_O, MASK_SIZE, 512);
  const noiseTex = makeTileNoise(256);
  const cloudU = {
    ...fogU, uH: { value: hTex }, uMask: { value: maskTex }, uNoise: { value: noiseTex }, uTime: { value: 0 }, uWind: { value: new THREE.Vector2(0.55, 0.18) },
    uTile: { value: TILE }, uMaskO: { value: MASK_O }, uMaskSize: { value: MASK_SIZE },
    uLit: { value: new THREE.Color(1.45, 0.72, 0.46) }, uShadow: { value: new THREE.Color(0.13, 0.12, 0.26) },
    uSunCol: { value: new THREE.Color(2.4, 0.95, 0.42) }, uSkyTop: { value: new THREE.Color(0.17, 0.16, 0.36) }, uSkyLow: { value: new THREE.Color(0.04, 0.035, 0.09) },
    uBird: { value: new THREE.Vector3(0, -100, 0) }, uBirdHeat: { value: 0 }, uNearR: { value: 90 },
  };
  const CLOUD_COMMON = /* glsl */`
    uniform sampler2D uH, uMask; uniform float uTime, uTile, uMaskSize; uniform vec2 uWind, uMaskO;
    // H in metres above CLOUD_Y (the texture holds (H + 4) / 8)
    float cH(vec2 xz) { return texture2D(uH, (xz + uWind * uTime) / uTile).r * 8.0 - 4.0; }
    float cHlod(vec2 xz, float l) { return textureLod(uH, (xz + uWind * uTime) / uTile, l).r * 8.0 - 4.0; }
    // distance to the nearest pillar wall (m, 0..10)
    float cMask(vec2 xz) { return texture2D(uMask, (xz - uMaskO) / uMaskSize + 0.5).r * 10.0; }
    float cMaskLod(vec2 xz) { return textureLod(uMask, (xz - uMaskO) / uMaskSize + 0.5, 0.0).r * 10.0; }`;
  const CLOUD_VERT = /* glsl */`
    ${CLOUD_COMMON}
    varying vec3 vW;
    void main() {
      vec4 w = modelMatrix * vec4(position, 1.0);
      float dip = 1.0 - smoothstep(0.0, 5.0, cMaskLod(w.xz));
      w.y += cHlod(w.xz, 3.0) + 1.3 - dip * 2.2;                   // the envelope: above the local puffs (a blurred H + margin)
      vW = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w;
    }`;
  const CLOUD_FRAG = /* glsl */`
    ${CLOUD_COMMON}
    uniform vec3 uSunCol, uSkyTop, uSkyLow, uBird; uniform float uBirdHeat, uNearR;
    varying vec3 vW;
    ${GLSL_FOG}
    float hg(float c, float g) { float g2 = g * g; return (1.0 - g2) / (12.566 * pow(1.0 + g2 - 2.0 * g * c, 1.5)); }
    void main() {
      vec3 rd = normalize(vW - uCsCam);
      float mk = cMask(vW.xz), dip = (1.0 - smoothstep(0.0, 5.0, mk)) * 2.2;
      float stepL = clamp(0.32 / max(-rd.y, 0.10), 0.32, 2.4);
      float cosT = dot(rd, uCsSun);
      float phase = 0.7 * hg(cosT, 0.62) + 0.3 * hg(cosT, -0.15);
      float jit = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
      vec3 p = vW + rd * stepL * jit;
      // the form of the puffs at this pixel: the surface normal from H (finite differences) and the crevice occlusion (H against
      // its blur): with a sun this low the light through the cloud alone hardly varies, the form must come from the surface
      float h0 = cH(vW.xz), hx = cH(vW.xz + vec2(1.1, 0.0)), hz = cH(vW.xz + vec2(0.0, 1.1));
      float H0 = cHlod(vW.xz, 3.0), Hx = cHlod(vW.xz + vec2(4.0, 0.0), 3.0), Hz = cHlod(vW.xz + vec2(0.0, 4.0), 3.0);
      vec3 Nc = normalize(vec3(-(hx - h0) / 1.1 - (Hx - H0) / 4.0 * 1.5, 1.0, -(hz - h0) / 1.1 - (Hz - H0) / 4.0 * 1.5));
      float wrapL = clamp(dot(Nc, uCsSun) * 0.8 + 0.2, 0.0, 1.0);
      float ao = smoothstep(-1.2, 0.7, h0 - cHlod(vW.xz, 4.0));
      float T = 1.0; vec3 acc = vec3(0.0);
      vec3 sunStep = uCsSun * 5.0;
      for (int i = 0; i < 8; i++) {
        float h = uCsCloudY + cH(p.xz) - dip;
        float dens = smoothstep(-0.08, 0.45, h - p.y);
        if (dens > 0.002) {
          float hl = uCsCloudY + cH(p.xz + sunStep.xz) - dip;
          float od = max(0.0, hl - (p.y + sunStep.y));             // cloud between this sample and the sun (the puffs toward it)
          float Tl = exp(-1.3 * od) * (0.3 + 0.7 * smoothstep(-1.2, 0.2, p.y - h + 0.4));
          float powder = 1.0 - exp(-3.0 * dens);
          vec3 amb = mix(uSkyLow, uSkyTop, smoothstep(-1.6, 0.4, p.y - h)) * (0.35 + 0.65 * ao);
          vec3 S = uSunCol * Tl * wrapL * (phase * 6.0 + 0.10) * powder * (0.5 + 0.5 * ao) + amb;
          vec3 tb = uBird - p; S += vec3(1.0, 0.30, 0.06) * uBirdHeat * 3.2 / (1.0 + dot(tb, tb) * 0.35);
          float a = 1.0 - exp(-dens * stepL * 1.7);
          acc += T * a * S; T *= 1.0 - a;
          if (T < 0.03) break;
        }
        p += rd * stepL;
      }
      // the rest: the dense body of the cloud, lit only by the sky (and her)
      vec3 tb = uBird - p;
      vec3 body = uSkyLow * 1.3 + vec3(1.0, 0.30, 0.06) * uBirdHeat * 2.0 / (1.0 + dot(tb, tb) * 0.35);
      vec3 col = acc + T * body;
      col = csFog(col, vW);
      // parted, wispy and see-through where a pillar rises through it
      float a = smoothstep(0.3, 2.2, mk + (cH(vW.xz * 1.7) + 1.0) * 0.6);
      // the near sea only: it thins out with distance and the far world (the baked panoramas) takes over
      float dc = length(vW.xz - uCsCam.xz);
      a *= 1.0 - smoothstep(uNearR * 0.45, uNearR, dc + (cH(vW.xz * 0.6) + 1.0) * 6.0);
      gl_FragColor = vec4(col, a);
    }`;
  const cloudMat = new THREE.ShaderMaterial({ uniforms: cloudU, vertexShader: CLOUD_VERT, fragmentShader: CLOUD_FRAG, transparent: true, depthWrite: true });
  const cloudGeo = new THREE.PlaneGeometry(900, 900, Math.round(240 * Math.sqrt(quality)), Math.round(240 * Math.sqrt(quality))); cloudGeo.rotateX(-Math.PI / 2);
  const clouds = new THREE.Mesh(cloudGeo, cloudMat); clouds.position.set(-6, CLOUD_Y, -20); clouds.frustumCulled = false; clouds.renderOrder = 1; clouds.visible = near; scene.add(clouds);

  // two thin mist layers drifting above the sea (the wind made visible, depth between the pillars)
  const mistU = { ...fogU, uNoise: cloudU.uNoise, uTime: cloudU.uTime, uWind: cloudU.uWind, uLit: cloudU.uLit, uShadow: cloudU.uShadow, uBird: cloudU.uBird, uBirdHeat: cloudU.uBirdHeat };
  const MIST_FRAG = /* glsl */`
    uniform sampler2D uNoise; uniform float uTime, uLayer, uBirdHeat; uniform vec2 uWind; uniform vec3 uLit, uShadow, uBird;
    varying vec3 vW;
    ${GLSL_FOG}
    void main() {
      vec2 p = vW.xz, dr = uWind * uTime * (1.8 + uLayer);
      float n = texture2D(uNoise, (p + dr) * vec2(0.010, 0.022) + uLayer * 0.37).r * 0.6 + texture2D(uNoise, (p + dr * 1.3) * 0.045 + uLayer).g * 0.4;
      float a = smoothstep(0.52, 0.78, n) * 0.30;
      float dist = length(uCsCam - vW);
      a *= smoothstep(3.0, 14.0, dist) * (1.0 - smoothstep(180.0, 320.0, dist));     // never in her face, gone at the horizon
      float toward = pow(max(dot(normalize(vW - uCsCam), uCsSun), 0.0), 2.0);
      vec3 col = mix(uShadow * 1.4, uLit, 0.35 + 0.65 * toward);
      vec3 tb = uBird - vW; col += vec3(1.0, 0.3, 0.06) * uBirdHeat * 2.0 / (1.0 + dot(tb, tb) * 0.4);
      gl_FragColor = vec4(csFog(col, vW), a);
    }`;
  const mists = [1.3, 2.9].map((dy, k) => {
    const m = new THREE.ShaderMaterial({ uniforms: { ...mistU, uLayer: { value: k } }, vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }', fragmentShader: MIST_FRAG, transparent: true, depthWrite: false });
    const g = new THREE.PlaneGeometry(700, 700, 1, 1); g.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(g, m); mesh.position.set(-6, CLOUD_Y + dy, -20); mesh.renderOrder = 2 + k; mesh.frustumCulled = false; mesh.visible = near; scene.add(mesh);
    return mesh;
  });

  return {
    heightAt, surfaceAt, PEAK, LEDGE, CLOUD_Y, SUN_DIR, occluders, sky, clouds, mists, pillars: placed, fog: fogU, cloudUniforms: cloudU,
    sunColor: new THREE.Color(1.0, 0.70, 0.45), skyLight: new THREE.Color(0.45, 0.38, 0.62), groundLight: new THREE.Color(0.75, 0.42, 0.28),
    /** bakes the far panoramas (async, a few seconds on a weak GPU: show the loader). onProgress(0..1) */
    async bakeFar(renderer, onProgress) {
      const tex = await bakeMountainPanoramas(renderer, { heights: PANO_HEIGHTS, onProgress });
      skyMat.uniforms.uPanoA.value = tex[0]; skyMat.uniforms.uPanoB.value = tex[1]; skyMat.uniforms.uPanoOn.value = 1;
    },
    /** time: seconds (wall clock); camera; bird: world position of her body; heat: her fire (0 none) */
    update({ time, camera, bird, heat = 0 }) {
      // the panoramas: among the cloud tops (A) .. high above them (B), by the camera's height
      skyMat.uniforms.uPanoMix.value = Math.min(1, Math.max(0, (camera.position.y - (CLOUD_Y + 3)) / (PEAK.top - CLOUD_Y - 3)));
      fogU.uCsCam.value.copy(camera.position);
      cloudU.uTime.value = time; skyMat.uniforms.uTime.value = time;
      if (bird) cloudU.uBird.value.copy(bird);
      cloudU.uBirdHeat.value = heat;
      sky.position.copy(camera.position);
    },
  };
}

// tileable value noise on a lattice of `per` cells
function tileNoise(per, seed) {
  const g = new Float32Array(per * per); let k = seed;
  for (let i = 0; i < g.length; i++) { k = (k * 16807) % 2147483647; g[i] = (k - 1) / 2147483646; }
  return (u, v) => {   // u, v in [0, 1)
    const x = u * per, y = v * per, xi = Math.floor(x), yi = Math.floor(y), tx = x - xi, ty = y - yi;
    const a = (xi % per + per) % per, b = (yi % per + per) % per, a1 = (a + 1) % per, b1 = (b + 1) % per;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    return g[b * per + a] * (1 - sx) * (1 - sy) + g[b * per + a1] * sx * (1 - sy) + g[b1 * per + a] * (1 - sx) * sy + g[b1 * per + a1] * sx * sy;
  };
}
/** the cloud-sea surface H (metres above CLOUD_Y), tileable: swells + cumulus billows (abs: round tops, sharp crevices) + puffs */
function bakeCloudHeight(N) {
  const sw = tileNoise(3, 11), sw2 = tileNoise(6, 17), b1 = tileNoise(10, 23), b2 = tileNoise(21, 29), b3 = tileNoise(44, 31), d1 = tileNoise(90, 37);
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N;
    let h = (sw(u, v) - 0.5) * 2.6 + (sw2(u, v) - 0.5) * 1.2;
    const dome = (n) => Math.sqrt(Math.abs(n - 0.5) * 2);
    h += dome(b1(u, v)) * 2.8 - 1.6;
    h += dome(b2(u, v)) * 1.4 - 0.8;
    h += dome(b3(u, v)) * 0.6 - 0.35;
    h += (d1(u, v) - 0.5) * 0.25;
    const q = Math.max(0, Math.min(1, (h + 4) / 8)) * 255;
    const i = (y * N + x) * 4; data[i] = q; data[i + 1] = q; data[i + 2] = q; data[i + 3] = 255;
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}
/** distance (m, 0..10, /10 in the texture) from each point of a SIZE x SIZE area to the nearest pillar wall */
function bakePillarMask(pillars, origin, SIZE, N) {
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const wx = origin.x + (x / N - 0.5) * SIZE, wz = origin.y + (y / N - 0.5) * SIZE;
    let d = 10;
    for (const o of pillars) { const dd = Math.hypot(wx - o.x, wz - o.z) - o.r * 1.1; if (dd < d) d = dd; }
    const q = Math.max(0, Math.min(1, d / 10)) * 255, i = (y * N + x) * 4; data[i] = q; data[i + 1] = q; data[i + 2] = q; data[i + 3] = 255;
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.needsUpdate = true;
  return t;
}

/** a tileable 3-channel value-noise texture (three frequencies), for the mist */
function makeTileNoise(N) {
  const data = new Uint8Array(N * N * 4);
  const lattice = (P, s) => { const g = new Float32Array(P * P); let k = s; for (let i = 0; i < g.length; i++) { k = (k * 16807) % 2147483647; g[i] = (k - 1) / 2147483646; } return g; };
  const chans = [[8, 11], [16, 23], [32, 37]].map(([P, s]) => {
    const g = lattice(P, s), out = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let v = 0, amp = 0.55, sum = 0;
      for (let o = 0; o < 3; o++) {
        const f = P * (1 << o), fx = (x / N) * f, fy = (y / N) * f, xi = Math.floor(fx), yi = Math.floor(fy), tx = fx - xi, ty = fy - yi;
        const u = tx * tx * (3 - 2 * tx), w = ty * ty * (3 - 2 * ty), at = (a, b) => g[((b % f) % P) * P + ((a % f) % P)];
        const L = (a, b) => g[(((b + o * 7) % P) + P) % P * P + ((((a + o * 13) % P) + P) % P)];
        const n = L(xi % f, yi % f) * (1 - u) * (1 - w) + L((xi + 1) % f, yi % f) * u * (1 - w) + L(xi % f, (yi + 1) % f) * (1 - u) * w + L((xi + 1) % f, (yi + 1) % f) * u * w;
        void at; v += n * amp; sum += amp; amp *= 0.5;
      }
      out[y * N + x] = v / sum;
    }
    return out;
  });
  for (let i = 0; i < N * N; i++) { data[i * 4] = chans[0][i] * 255; data[i * 4 + 1] = chans[1][i] * 255; data[i * 4 + 2] = chans[2][i] * 255; data[i * 4 + 3] = 255; }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}

// Dev-only test of the OPENING scene: the phoenix stands with folded wings on a mountain peak, crouches, leaps, flies over the valley
// and lands on a ledge on the other side, all driven by the scroll (scroll back = rewind). The scenery is a placeholder (procedural
// mountains + a dusk sky shader), only to judge the choreography and the camera; the real habitat shader comes later.
//   /opening-lab.html          ?m=lite  lite model        ?u=0.3 start at a progress        ?ui=0 no text
import * as THREE from 'three';
import Lenis from 'lenis';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { createFenixFlight, breathAt, gustAt } from './beasts/fenix-flight.js';
import { createPath, createTimeline } from './beasts/flight-path.js';
import { applyEyes, blinkAt } from './beasts/fenix-eyes.js';
import { applyFenixLook } from './beasts/fenix-look.js';
import { createEmbers } from './beasts/fenix-embers.js';
import { createHeroPost, LAYER_SILHOUETTE, LAYER_OCCLUDER } from './hero-post.js';

const Q = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
// ?look=0: the raw model, no post (A/B);  ?aura=0 no silhouette flames;  ?bloom=0
const LOOK = Q.get('look') !== '0', SKY_GAIN = +(Q.get('sky') ?? 0.9);

// ───────────── renderer, light ─────────────
const renderer = new THREE.WebGLRenderer({ canvas: $('gl'), antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const HORIZON = new THREE.Color('#d9774a'), ZENITH = new THREE.Color('#1d1a33'), FOG = new THREE.Color('#6e3b40');
scene.fog = new THREE.FogExp2(FOG, 0.0075);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.35;
const SUN_DIR = new THREE.Vector3(-0.55, 0.22, -0.8).normalize();
const sun = new THREE.DirectionalLight(0xffc48a, 3.2); sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024); sun.shadow.camera.near = 0.5; sun.shadow.camera.far = 40; sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.02;
Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4 });
scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight(0xffb48a, 0x2a1820, 0.9));
const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 600);
let post = null, embers = null; const BUF = new THREE.Vector2(), camRight = new THREE.Vector3();
function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); post?.setSize(); }
addEventListener('resize', resize); resize();
if (LOOK) post = createHeroPost({ renderer, scene, camera, aura: Q.get('aura') !== '0', bloom: Q.get('bloom') !== '0', params: {
  samples: +(Q.get('msaa') ?? 4), scale: +(Q.get('scale') ?? 1), intensity: 0.8, height: 0.2, rim: 0, opaque: 0.4, steps: +(Q.get('steps') ?? 12), occluders: true, bloomStrength: +(Q.get('bs') ?? 0.5), bloomRadius: 0.55, bloomThreshold: +(Q.get('bt') ?? 1.8) } });

// ───────────── sky: a gradient dome with the setting sun ─────────────
{
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uH: { value: HORIZON }, uZ: { value: ZENITH }, uSun: { value: SUN_DIR } },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    defines: { LOOK: LOOK ? 1 : 0, SKY_GAIN: SKY_GAIN.toFixed(3) },
    fragmentShader: `uniform vec3 uH, uZ, uSun; varying vec3 vD;
      void main(){
        float h = clamp(vD.y, -0.2, 1.0);
        vec3 c = mix(uH, uZ, pow(max(h, 0.0), 0.55));
        c = mix(c, uH * 0.55, smoothstep(0.0, -0.2, h));                 // below the horizon: the haze of the valleys
        float s = max(dot(normalize(vD), uSun), 0.0);
        c += vec3(1.0, 0.62, 0.32) * (pow(s, 6.0) * 0.55 + pow(s, 80.0) * 1.2);
        float disc = smoothstep(0.9993, 0.9997, s);
        #if LOOK
        // with the post chain the sky is written in LINEAR light (ACES + sRGB come at the end): the gradient is decoded from the
        // display values it was tuned in; only the sun's disc stays HDR (it feeds the bloom)
        c = pow(min(c, vec3(1.0)), vec3(2.2)) * SKY_GAIN + vec3(1.0, 0.85, 0.6) * disc * 6.0;
        #else
        c += vec3(1.0, 0.9, 0.7) * disc * 3.0;
        #endif
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 48, 24), mat); sky.renderOrder = -1; scene.add(sky);
}

// ───────────── terrain: a heightfield known in JS (the feet stand on it) ─────────────
const sceneryDrifts = [];
const PEAK = { x: 0, z: 0, top: 13.0 }, LEDGE = { x: -12, z: -40, top: 7.0 };
const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
const vnoise = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; };
const ridged = (x, y) => { let s = 0, amp = 0.5, f = 1; for (let i = 0; i < 5; i++) { const n = 1 - Math.abs(vnoise(x * f, y * f) * 2 - 1); s += n * n * amp; amp *= 0.5; f *= 2.07; } return s; };
function mountain(x, z, m, r, sharp) { const d = Math.hypot(x - m.x, z - m.z) / r; return Math.exp(-Math.pow(d, sharp)); }
const smin = (a, b, k) => { const h = Math.max(0, Math.min(1, 0.5 + 0.5 * (b - a) / k)); return b + (a - b) * h - k * h * (1 - h); };   // smooth min (rounded summit)
function spire(x, z, m, r, top, seed) {
  const d = Math.hypot(x - m.x, z - m.z), p = Math.exp(-Math.pow(d / r, 1.05));
  const ang = Math.atan2(z - m.z, x - m.x);
  // flanks: ridges and gullies running down the mountain (angular noise), crags, fine rock grain; strongest mid-slope
  const gully = ridged(Math.cos(ang) * 2.2 + seed, Math.sin(ang) * 2.2 + d * 0.35);
  const crag = ridged(x * 0.33 + seed, z * 0.33 - seed);
  const mid = 4 * p * (1 - p);
  const body = top * 1.08 * p + 2.4 * mid * (gully - 0.35) + 1.4 * crag * p + 0.35 * vnoise(x * 1.7 + seed, z * 1.7) * p;
  return smin(body, top + 0.35 * vnoise(x * 2.5 + seed, z * 2.5) + 0.2 * vnoise(x * 6, z * 6 + seed), 0.5);
}
function heightAt(x, z) {
  let h = 1.6 * ridged(x * 0.035 + 3.1, z * 0.035 - 1.7) + 0.5 * vnoise(x * 0.25, z * 0.25);
  h = Math.max(h, spire(x, z, PEAK, 4.4, PEAK.top, 7.3));      // the perch: a rocky spire with a rough, roughly flat summit
  h = Math.max(h, spire(x, z, LEDGE, 6.0, LEDGE.top, 2.1));    // the landing crag across the valley
  // far ranges all around, for a horizon
  const ring = Math.hypot(x + 6, z + 20);
  h += Math.max(0, ring - 50) * 0.16 * (0.5 + ridged(x * 0.05, z * 0.05));      // lower than the perch: from up there she looks DOWN on the world
  return h;
}
// the base terrain (coarse) + two fine patches over the mountains (0.1 unit cells: no facets close to her). Inside a patch the base is
// pushed 4 cm down so the fine surface covers it.
const PATCHES = [{ x: PEAK.x, z: PEAK.z, size: 16, seg: 180 }, { x: LEDGE.x, z: LEDGE.z, size: 20, seg: 180 }];
const inPatch = (x, z) => PATCHES.some((q) => Math.abs(x - q.x) < q.size / 2 - 0.2 && Math.abs(z - q.z) < q.size / 2 - 0.2);
function terrainMesh(size, seg, cx, cz, lowerInPatches) {
  const geo = new THREE.PlaneGeometry(size, size, seg, seg); geo.rotateX(-Math.PI / 2); geo.translate(cx, 0, cz);
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 3), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), z = pos.getZ(i); pos.setY(i, heightAt(x, z) - (lowerInPatches && inPatch(x, z) ? 0.04 : 0)); }
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal, low = new THREE.Color('#1c1218'), rock = new THREE.Color('#3e2420'), lit = new THREE.Color('#7a3e2c'), top = new THREE.Color('#9a6448'), dark = new THREE.Color('#24151a');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), y = pos.getY(i), slope = 1 - nrm.getY(i);
    c.copy(low).lerp(rock, THREE.MathUtils.smoothstep(y, 0.5, 5)).lerp(lit, THREE.MathUtils.smoothstep(y, 5, 11) * 0.7).lerp(top, THREE.MathUtils.smoothstep(y, 9, 13.5) * 0.6);
    c.lerp(dark, THREE.MathUtils.smoothstep(slope, 0.35, 0.8) * 0.55);                                // steep rock faces darker
    c.multiplyScalar(0.72 + 0.45 * vnoise(x * 0.6, z * 0.6) + 0.18 * (vnoise(x * 3, y * 6) - 0.5));       // grain + horizontal strata
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }));
  mesh.receiveShadow = true; mesh.layers.enable(LAYER_OCCLUDER); scene.add(mesh); return mesh;
}
terrainMesh(180, 260, -6, -20, true);
for (const q of PATCHES) terrainMesh(q.size, q.seg, q.x, q.z, false);
// drifting embers in the air (cheap points), for scale and depth
{
  const N = 900, g = new THREE.BufferGeometry(), p = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { p[i*3] = (hash(i, 1) - 0.5) * 70 - 6; p[i*3+1] = 3 + hash(i, 2) * 16; p[i*3+2] = (hash(i, 3) - 0.5) * 70 - 20; }
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const m = new THREE.PointsMaterial({ color: 0xffa060, size: 0.06, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending });
  windDrift(m, { box: new THREE.Vector3(70, 16, 70), centre: new THREE.Vector3(-6, 11, -20), follow: false });
  scene.add(new THREE.Points(g, m));
}
// fine ash in a box that follows the bird: it streams past her with the gusts (the wind made visible in the close shots)
const motes = (() => {
  const N = 700, g = new THREE.BufferGeometry(), p = new Float32Array(N * 3), B = new THREE.Vector3(9, 4, 9);
  for (let i = 0; i < N; i++) { p[i*3] = (hash(i, 11) - 0.5) * B.x; p[i*3+1] = (hash(i, 12) - 0.5) * B.y; p[i*3+2] = (hash(i, 13) - 0.5) * B.z; }
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const m = new THREE.PointsMaterial({ color: 0xffc89a, size: 0.012, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
  const d = windDrift(m, { box: B, centre: new THREE.Vector3(), follow: true });
  const pts = new THREE.Points(g, m); pts.frustumCulled = false; scene.add(pts);
  return { update: (t, gust, centre) => d.update(t, gust, centre) };
})();
/** Points that drift downwind and wrap around a box (centred on the scenery, or on the bird with follow). The drift is integrated
 *  on the wall clock (a gust pushes them faster), so it is a feel, not part of the scroll-bound story. */
function windDrift(material, { box, centre, follow }) {
  const U = { uDrift: { value: new THREE.Vector3() }, uBox: { value: box }, uCentre: { value: centre.clone() } };
  material.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform vec3 uDrift, uBox, uCentre;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        // wrap the drifted point into the box around the centre (each point keeps its own place in the box)
        transformed = uCentre + mod(position + uDrift - uCentre + uBox * 0.5, uBox) - uBox * 0.5;
        transformed.y += sin(position.x * 1.7 + uDrift.x * 0.6) * 0.15;`)
      // a point right in front of the lens would be a big square: drop it, and fade the near ones in
      .replace('#include <fog_vertex>', `#include <fog_vertex>
        vNear = smoothstep(0.6, 1.6, -mvPosition.z);
        if (-mvPosition.z < 0.6) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);`)
      .replace('void main() {', 'varying float vNear;\nvoid main() {');
    sh.fragmentShader = sh.fragmentShader.replace('void main() {', 'varying float vNear;\nvoid main() {')
      .replace('#include <premultiplied_alpha_fragment>', `#include <premultiplied_alpha_fragment>
        { float r = length(gl_PointCoord - 0.5) * 2.0; if (r > 1.0) discard; gl_FragColor *= (1.0 - r * r) * vNear; }   // round, soft`);
  };
  let last = null;
  const api = {
    U,
    update(t, gust, c) {
      const dt = last == null ? 0 : Math.min(0.1, Math.max(0, t - last)); last = t;
      const v = 0.25 + 2.6 * gust;                                     // m/s along the wind
      U.uDrift.value.addScaledVector(WIND, v * dt);
      if (follow && c) U.uCentre.value.copy(c);
    },
  };
  sceneryDrifts.push(api);
  return api;
}

// ───────────── the flight: path + scroll timeline (all pure functions of the progress u) ─────────────
const Hp = PEAK.top, L = LEDGE.top;
const PATH = [
  [0, Hp + 0.5, 0],            // 0 perched (the bird's centre is ~0.5 above its feet)
  [0, Hp + 1.4, -2.6],         // 1 the leap: up and out
  [1.6, Hp + 2.7, -7],         // 2 climbing
  [5, Hp + 3.3, -14],          // 3 over the valley
  [6.2, Hp + 2.6, -22],        // 4 soaring, turning left
  [2.5, Hp + 0.8, -29],        // 5 gliding down
  [-5, Hp - 1.2, -34],         // 6
  [-10.5, L + 2.2, -37],       // 7 approach
  [-11.8, L + 0.95, -39.1],    // 8 flare
  [-12, L + 0.5, -40],         // 9 touchdown
];
const path = createPath(PATH);
// s = position along the path (0 perch .. 1 ledge). Flat at both ends: she stands still; PCHIP gives zero speed there, smooth in between.
const KEYS = [
  { u: 0.00, s: 0.000, beats: 0.0,  flap: 0.00, open: 0.00, sweep: 0.0, legs: +(Q.get('roost') ?? 1), tail: 0.40, fly: 0.00, stretch: 0.0, alert: 0.0, ground: 1.0, pitchBias: 0.00 },   // asleep on the peak, wings folded
  { u: 0.05, s: 0.000, beats: 0.0,  flap: 0.00, open: 0.00, sweep: 0.0, legs: +(Q.get('roost') ?? 1), tail: 0.40, fly: 0.00, stretch: 0.0, alert: 0.0, ground: 1.0, pitchBias: 0.00 },
  { u: 0.09, s: 0.000, beats: 0.0,  flap: 0.00, open: 0.16, sweep: 0.0, legs: 0.00, tail: 0.60, fly: 0.00, stretch: 0.0, alert: 0.5, ground: 1.0, pitchBias: 0.00 },   // awake: shakes her plumage out
  { u: 0.105, s: 0.000, beats: 0.0, flap: 0.00, open: 0.10, sweep: 0.0, legs: 0.00, tail: 0.55, fly: 0.00, stretch: 0.0, alert: 1.0, ground: 1.0, pitchBias: 0.00 },   // looks around
  { u: 0.12, s: 0.000, beats: 0.0,  flap: 0.00, open: 0.55, sweep: 0.0, legs: 0.00, tail: 0.70, fly: 0.25, stretch: 0.0, alert: 0.6, ground: 1.0, pitchBias: -0.28 },  // crouch: leans forward, wings half open
  { u: 0.155, s: 0.030, beats: 0.6, flap: 1.00, open: 1.00, sweep: 0.0, legs: 0.30, tail: 0.80, fly: 0.55, stretch: 0.2, alert: 0.5, ground: 0.0, pitchBias: 0.20 },  // the leap: first big stroke
  { u: 0.24, s: 0.130, beats: 5.5,  flap: 1.00, open: 1.00, sweep: 0.0, legs: 0.70, tail: 0.50, fly: 0.85, stretch: 0.4, alert: 0.5, ground: 0.0, pitchBias: 0.12 },  // climbing
  { u: 0.40, s: 0.400, beats: 11.0, flap: 0.20, open: 1.00, sweep: 0.0, legs: 0.90, tail: 0.75, fly: 1.00, stretch: 1.0, alert: 0.8, ground: 0.0, pitchBias: 0.00 },  // soaring over the valley
  { u: 0.56, s: 0.630, beats: 12.0, flap: 0.05, open: 1.00, sweep: 0.1, legs: 0.90, tail: 0.85, fly: 1.00, stretch: 1.0, alert: 0.9, ground: 0.0, pitchBias: 0.00 },  // gliding, turning
  { u: 0.70, s: 0.800, beats: 14.0, flap: 0.35, open: 1.00, sweep: 0.0, legs: 0.70, tail: 0.80, fly: 0.95, stretch: 0.7, alert: 0.7, ground: 0.0, pitchBias: 0.04 },  // descending
  { u: 0.81, s: 0.930, beats: 17.0, flap: 0.80, open: 1.00, sweep: 0.0, legs: -0.40, tail: 1.00, fly: 0.55, stretch: 0.2, alert: 0.7, ground: 0.0, pitchBias: 0.15 }, // approach: legs reach forward
  { u: 0.87, s: 0.990, beats: 20.0, flap: 1.00, open: 1.00, sweep: 0.0, legs: -1.00, tail: 1.00, fly: 0.25, stretch: 0.0, alert: 0.6, ground: 0.20, pitchBias: 0.55 }, // flare: braking strokes
  { u: 0.905, s: 1.000, beats: 21.2, flap: 0.35, open: 1.00, sweep: 0.0, legs: -0.60, tail: 0.80, fly: 0.10, stretch: 0.0, alert: 0.9, ground: 1.0, pitchBias: 0.25 }, // touchdown
  { u: 0.95, s: 1.000, beats: 21.6, flap: 0.10, open: 0.45, sweep: 0.2, legs: 0.00, tail: 0.55, fly: 0.00, stretch: 0.0, alert: 1.0, ground: 1.0, pitchBias: 0.00 },  // wings come in
  { u: 1.00, s: 1.000, beats: 21.8, flap: 0.00, open: 0.10, sweep: 0.0, legs: 0.00, tail: 0.50, fly: 0.00, stretch: 0.0, alert: 1.0, ground: 1.0, pitchBias: 0.00 },  // standing on the ledge
];
const timeline = createTimeline(KEYS);
// her life on the peak (u): asleep, the eyes open, the head rises, she shakes the feathers out; the wind on the plumage (strong on the
// ground, mostly hidden by the airflow of the flight)
const LIFE = createTimeline([
  { u: 0.000, sleep: 1, eyes: 1, shake: 0, wind: 1.0, hug: 1 },
  { u: 0.050, sleep: 1, eyes: 1, shake: 0, wind: 1.0, hug: 1 },
  { u: 0.060, sleep: 0.9, eyes: 0, shake: 0, wind: 1.0, hug: 0.6 },     // the eyes open first ...
  { u: 0.078, sleep: 0, eyes: 0, shake: 0, wind: 1.0, hug: 0.6 },       // ... then the head rises
  { u: 0.084, sleep: 0, eyes: 0, shake: 1, wind: 1.0, hug: 0.6 },       // the shake
  { u: 0.098, sleep: 0, eyes: 0, shake: 0, wind: 1.0, hug: 0.6 },
  { u: 0.160, sleep: 0, eyes: 0, shake: 0, wind: 0.6, hug: 0 },
  { u: 0.240, sleep: 0, eyes: 0, shake: 0, wind: 0.2, hug: 0 },
  { u: 0.800, sleep: 0, eyes: 0, shake: 0, wind: 0.2, hug: 0 },
  { u: 0.920, sleep: 0, eyes: 0, shake: 0, wind: 0.9, hug: 0 },
  { u: 1.000, sleep: 0, eyes: 0, shake: 0, wind: 1.0, hug: 0.6 },
]);
// the wind of the scene (world): a sunset breeze across the peak, from her right to her left as the opening camera sees her
const WIND = new THREE.Vector3(1, 0.04, 0.3).normalize();
const WIND_GAIN = +(Q.get('wind') ?? 1);                 // ?wind=0 no wind on the plumage (A/B)
const SECONDS = 40;                                        // the clock of the small life-motions over the whole scroll
// camera, in the bird's heading frame (f forward, r right, up), keyed on u; tf/tu = where it looks (ahead of / above the bird)
const CAM = createTimeline([
  { u: 0.00, cf: 2.4, cr: 0.0,  cu: 0.28, tf: 0.0, tu: -0.06, fov: 30 },    // FRONT, centred, a little from above: she sleeps on the peak (a slow push-in)
  { u: 0.05, cf: 2.05, cr: 0.0, cu: 0.24, tf: 0.0, tu: -0.04, fov: 30 },
  { u: 0.085, cf: 2.6, cr: 0.35, cu: -0.20, tf: 0.0, tu: 0.14, fov: 31 },   // she wakes (still almost frontal)
  { u: 0.11, cf: 2.1, cr: 1.8,  cu: -0.32, tf: 0.0, tu: 0.20, fov: 34 },    // the camera starts round to her side
  { u: 0.13, cf: 0.6, cr: 3.0,  cu: -0.10, tf: 0.6, tu: 0.20, fov: 36 },    // side, as she crouches
  { u: 0.20, cf: -1.0, cr: 3.2, cu: -0.10, tf: 1.2, tu: 0.30, fov: 40 },    // she leaps across the frame
  { u: 0.28, cf: -2.4, cr: 2.6, cu: -0.70, tf: 1.4, tu: 0.45, fov: 40 },    // from below and behind: she flies against the sky
  { u: 0.37, cf: -2.0, cr: 2.8, cu: -0.85, tf: 1.2, tu: 0.45, fov: 40 },
  { u: 0.45, cf: -3.8, cr: 3.2, cu: 1.10, tf: 2.2, tu: -0.50, fov: 44 },    // a brief look DOWN: the valley under her
  { u: 0.52, cf: -2.2, cr: 2.4, cu: -0.60, tf: 1.2, tu: 0.40, fov: 40 },    // back under her
  { u: 0.62, cf: -2.2, cr: -2.8, cu: -0.75, tf: 1.2, tu: 0.40, fov: 40 },   // swing to the other side, still against the sky
  { u: 0.74, cf: -0.8, cr: -3.0, cu: -0.55, tf: 1.0, tu: 0.35, fov: 39 },
  { u: 0.86, cf: 2.0, cr: -3.2, cu: -0.20, tf: 0.5, tu: 0.20, fov: 37 },    // landing seen from the front-side
  { u: 1.00, cf: 2.8, cr: -1.5, cu: -0.35, tf: 0.0, tu: 0.25, fov: 34 },
]);

// ───────────── the phoenix ─────────────
const variant = Q.get('m') === 'lite' ? 'lite' : 'web';
const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(`/models/fenix-flight-${variant}.glb`);
const model = gltf.scene;
let skinned = null;
model.traverse((o) => { if (o.isMesh || o.isSkinnedMesh) { o.frustumCulled = false; o.castShadow = true; if (o.isSkinnedMesh) skinned = o; if (o.material) { o.material.envMap = scene.environment; o.material.envMapIntensity = 0.45; o.material.metalness = 0.35; } } });
const holder = new THREE.Group(); holder.rotation.y = -Math.PI / 2; holder.scale.setScalar(1 / 1.7); holder.position.y = -0.85 / 1.7; holder.add(model);
const bird = new THREE.Group(); bird.add(holder); scene.add(bird);
const flight = createFenixFlight(model);
const eyes = applyEyes(skinned.material);
const look = LOOK ? applyFenixLook(skinned) : null;
if (LOOK) {
  skinned.material.metalness = 0.15; skinned.material.envMapIntensity = 0.35;
  model.traverse((o) => { if (o.isMesh || o.isSkinnedMesh) o.layers.enable(LAYER_SILHOUETTE); });
  embers = createEmbers({ mesh: skinned, count: +(Q.get('embers') ?? 320) }); scene.add(embers.points);
}
// how hot she burns along the scene (u): calm on the peak, a burst at the leap, full in flight, a flare when she brakes
const HEAT = createTimeline([
  { u: 0.00, h: 0.42 }, { u: 0.05, h: 0.42 }, { u: 0.08, h: 0.58 }, { u: 0.10, h: 0.68 }, { u: 0.13, h: 0.95 }, { u: 0.16, h: 1.45 }, { u: 0.24, h: 1.15 }, { u: 0.40, h: 1.0 },
  { u: 0.60, h: 0.95 }, { u: 0.80, h: 1.05 }, { u: 0.87, h: 1.35 }, { u: 0.93, h: 0.95 }, { u: 1.00, h: 0.6 },
]);
const EMBER_RATE = (h) => Math.min(1, Math.max(0.15, (h - 0.3) * 1.1));
let heatNow = 1;
const feet = ['Bone_002', 'Bone_009'].map((nm) => flight.bones[flight.byName.get(nm)]);
const SETTLE = +(Q.get('settle') ?? 0.2), FOOT_MARGIN = 0.012, V = new THREE.Vector3();

// ───────────── one frame of the scene as a function of u ─────────────
const qGround = new THREE.Quaternion(), qAir = new THREE.Quaternion(), fwdH = new THREE.Vector3(), Z = new THREE.Vector3(0, 0, -1);
const heading = (b) => { fwdH.set(b.fwd.x, 0, b.fwd.z); if (fwdH.lengthSq() < 1e-6) fwdH.set(0, 0, -1); return fwdH.normalize(); };
let plants = null;
function feetXZ() { bird.updateMatrixWorld(true); let x = 0, z = 0; for (const f of feet) { f.getWorldPosition(V); x += V.x / feet.length; z += V.z / feet.length; } return [x, z]; }
let life = { sleep: 0, eyes: 0, shake: 0, wind: 0 };
// The clock of her LIFE (breathing, wind, gaze, blinks, feather flutter) is the wall clock: she keeps breathing and the wind keeps
// blowing while the scroll rests (the opening is a still frame until the visitor scrolls). The STORY (pose, path, camera) is u.
let lifeT = performance.now() / 1000;
const windM = new THREE.Vector3(), qModel = new THREE.Quaternion();
function place(u, usePlants = true) {
  if (usePlants && !plants) plants = { start: (place(0, false), feetXZ()), end: (place(KEYS.find((k) => k.ground === 1 && k.u > 0.5).u, false), feetXZ()) };   // where the feet touch, once
  const k = timeline.at(u), s = Math.min(1, Math.max(0, k.s)), b = path.at(s);
  // orientation: in the air the path's (pitch + bank); on the ground level, facing where it is heading
  qGround.setFromUnitVectors(Z, heading(b)); qAir.copy(b.quat);
  bird.position.copy(b.pos); bird.quaternion.copy(qGround).slerp(qAir, 1 - k.ground);
  bird.rotateX(k.pitchBias);
  // the wind in the model's frame (the pose works there): through the inverse of the model's world rotation
  qModel.copy(bird.quaternion).multiply(holder.quaternion).multiply(model.quaternion).invert(); windM.copy(WIND).applyQuaternion(qModel);
  const lf = LIFE.at(u);
  life = lf;
  const P = {
    sleep: lf.sleep, shake: lf.shake, shakePh: u * 300, wind: lf.wind * WIND_GAIN, hug: lf.hug, windX: windM.x, windY: windM.y, windZ: windM.z,
    t: lifeT, phase: k.beats, flap: k.flap, open: k.open, sweep: k.sweep, legs: k.legs, tail: k.tail, fly: k.fly, stretch: k.stretch, alert: k.alert,
    bank: b.bank * (1 - k.ground), pitch: b.pitch * (1 - k.ground) + k.pitchBias, pitchRate: b.pitchRate * 0.08 * (1 - k.ground), yawRate: b.yawRate * 0.08 * (1 - k.ground),
    lookYaw: Math.max(-0.5, Math.min(0.5, b.yawRate * 0.04)) * (1 - k.ground), lookPitch: 0, load: Math.max(-1, Math.min(1, b.pitchRate * 0.1)) * (1 - k.ground),
  };
  flight.pose(P);
  eyes.set(Math.max(blinkAt(P.t), lf.eyes));
  heatNow = HEAT.at(u).h * (1 + 0.12 * k.flap * Math.max(0, Math.sin(k.beats * TAU)))    // each downstroke fans the fire
          * (1 + 0.10 * lf.sleep * breathAt(P.t));                                        // asleep, the embers glow with her breath
  if (k.ground > 0.001) {                                              // feet on the terrain
    bird.updateMatrixWorld(true);
    // the lowest foot (relative to the ground under it) touches; the other may be a little above
    let low = Infinity; for (const f of feet) { f.getWorldPosition(V); low = Math.min(low, V.y - heightAt(V.x, V.z)); }
    bird.position.y += k.ground * (FOOT_MARGIN - low);
    // asleep she SETTLES: the belly rests on the summit (measured: 0.13 above it with the legs folded; 0.2 hides the folded legs from the front camera), the folded feet go into the rock
    // under the breast feathers, so she reads as a roosting bird and not one standing on bent legs
    bird.position.y -= SETTLE * lf.sleep * k.ground;
    if (usePlants && k.ground > 0.5) {                                // planted feet: they stay where they touched down
      const pl = u < 0.5 ? plants.start : plants.end, w = THREE.MathUtils.smoothstep(k.ground, 0.5, 1.0), f = feetXZ();
      bird.position.x += w * (pl[0] - f[0]); bird.position.z += w * (pl[1] - f[1]);
    }
  }
  return { k, b, P };
}

// ───────────── camera ─────────────
const controls = new OrbitControls(camera, renderer.domElement); controls.enabled = false; controls.enableDamping = true;
let freeCam = false;
const camPos = new THREE.Vector3(), camTgt = new THREE.Vector3(), R = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
function placeCamera(u, b) {
  if (freeCam) { controls.target.copy(bird.position); controls.update(); return; }
  const c = CAM.at(u), f = heading(b); R.crossVectors(f, UP).normalize();
  camPos.copy(bird.position).addScaledVector(f, c.cf).addScaledVector(R, c.cr).addScaledVector(UP, c.cu);
  camPos.y = Math.max(camPos.y, heightAt(camPos.x, camPos.z) + 0.5);  // never inside the mountain
  camTgt.copy(bird.position).addScaledVector(f, c.tf).addScaledVector(UP, c.tu);
  camera.position.copy(camPos); camera.lookAt(camTgt);
  if (Math.abs(camera.fov - c.fov) > 0.01) { camera.fov = c.fov; camera.updateProjectionMatrix(); }
}
function shadowFollow() { sun.position.copy(bird.position).addScaledVector(SUN_DIR, 20); sun.target.position.copy(bird.position); sun.target.updateMatrixWorld(); }

// ───────────── scroll, UI, loop ─────────────
const lenis = new Lenis({ lerp: 0.08 });
let u = +(Q.get('u') ?? 0), autoplay = false, hold = false, last = performance.now();
const toggleUI = () => { for (const id of ['hud', 'hint', 'bar', 'panel']) { const el = $(id); el.style.display = el.style.display === 'none' ? '' : 'none'; } };
if (Q.get('ui') === '0') toggleUI();
// auto-play at an EXACT, constant rate: u = u0 + (now - t0) / duration (wall clock, not accumulated frame steps, so a dropped frame never
// changes the timing). ?play=1 starts it on load, ?dur=60 sets the duration, ?loop=1 repeats.
let duration = +(Q.get('dur') ?? 60), playStart = 0, playU0 = 0, looping = Q.get('loop') === '1';
$('dur').value = String(duration); $('loop').checked = looping;
const setPlay = (on) => { autoplay = on; $('play').classList.toggle('on', on); $('play').textContent = on ? 'pause (Space)' : 'play (Space)'; if (on) { if (u >= 1) u = 0; playU0 = u; playStart = performance.now(); } };
$('play').onclick = () => setPlay(!autoplay);
$('restart').onclick = () => { u = 0; lenis.scrollTo(0, { immediate: true }); setPlay(true); };
$('dur').onchange = (e) => { duration = +e.target.value; if (autoplay) { playU0 = u; playStart = performance.now(); } };
$('loop').onchange = (e) => { looping = e.target.checked; };
addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); setPlay(!autoplay); }
  if (e.code === 'KeyR') $('restart').click();
  if (e.code === 'KeyH') toggleUI();
  if (e.code === 'KeyC') { freeCam = !freeCam; controls.enabled = freeCam; if (freeCam) controls.target.copy(bird.position); }
});
addEventListener('wheel', () => { if (autoplay) setPlay(false); }, { passive: true });     // scrolling by hand takes over
if (Q.has('u')) requestAnimationFrame(() => lenis.scrollTo(u * lenis.limit, { immediate: true }));
if (Q.get('play') === '1') requestAnimationFrame(() => setPlay(true));
function draw(time) {
  if (!post) { renderer.render(scene, camera); return; }
  look.update({ time, heat: heatNow, camera, sunDir: SUN_DIR, blink: Math.max(blinkAt(lifeT), life.eyes),
    breath: breathAt(lifeT) * (0.35 + 0.65 * life.sleep), wind: life.wind * WIND_GAIN * (0.5 + 0.5 * gustAt(time, 0)) });
  const gw = gustAt(time, 0) * life.wind;
  embers.update(time, EMBER_RATE(heatNow), { x: WIND.x * (0.08 + 0.45 * gw), z: WIND.z * (0.08 + 0.45 * gw) });
  embers.setPixelScale(renderer.getDrawingBufferSize(BUF).y, camera.fov);
  // the flames: almost none while she rests (she smoulders), they catch when she leaps and settle again on the ledge
  post.aura.uniforms.uIntensity.value = 0.85 * Math.min(1.3, Math.max(0, (heatNow - 0.5) / 0.55));
  post.aura.uniforms.uHeight.value = 0.07 + 0.11 * Math.min(1.4, heatNow);           // calm licks when perched, tall in flight
  camRight.setFromMatrixColumn(camera.matrixWorld, 0);
  post.aura.uniforms.uLean.value = WIND.dot(camRight) * (0.25 + 0.45 * gw) * life.wind * WIND_GAIN;   // the licks lean downwind
  for (const d of sceneryDrifts) d.update(time, gw * Math.max(0.3, life.wind) * WIND_GAIN, bird.position);
  post.render(time);
}
// quality governor: start at the best tier and step down while frames run long (a frame over 18 ms with vsync = a missed one).
// Tiers: MSAA 4 -> 2 -> 0, then a lower render scale (dynamic resolution) and fewer aura steps. Measured on an Intel UHD 620 at
// 1280x720 (GPU ms, timer queries, interleaved): raw 6-11, full look no MSAA 10-14, MSAA 2 ~17, MSAA 4 ~21; with the browser's own
// compositing on the same GPU, frames start to miss above ~12 ms. ?msaa= pins the MSAA (no governor), ?scale= the render scale.
const TIERS = [{ msaa: 4, steps: 12, scale: 1 }, { msaa: 2, steps: 12, scale: 1 }, { msaa: 0, steps: 12, scale: 1 },
               { msaa: 0, steps: 10, scale: 0.85 }, { msaa: 0, steps: 8, scale: 0.72 }];
let tier = 0, govFrames = [], govSkip = 30, govClean = 0, govOn = LOOK && !Q.has('msaa');
function governor(dt) {
  if (!govOn || document.hidden) return;
  if (govSkip > 0) { govSkip--; return; }
  govFrames.push(dt);
  if (govFrames.length < 90) return;
  govFrames.sort((a, b) => a - b);
  const slow = govFrames.filter((d) => d > 18).length / govFrames.length;
  govFrames = [];
  if (slow > 0.1 && tier < TIERS.length - 1) {
    tier++; post.setSamples(TIERS[tier].msaa); post.aura.uniforms.uSteps.value = TIERS[tier].steps; post.setScale(TIERS[tier].scale); govSkip = 30;
    console.info('[opening] quality tier', tier, TIERS[tier]);
  } else if (slow > 0.1 || ++govClean >= 3) govOn = false;      // at the floor, or settled after three clean windows
}
function frame(now) {
  lifeT = now / 1000;
  governor(now - last);
  last = now;
  lenis.raf(now);
  if (!hold) {
    if (autoplay) {
      u = playU0 + (now - playStart) / (duration * 1000);
      if (u >= 1) { if (looping) { u = 0; playU0 = 0; playStart = now; } else { u = 1; setPlay(false); } }
      lenis.scrollTo(u * lenis.limit, { immediate: true });
    } else u = Math.min(1, Math.max(0, lenis.limit ? lenis.scroll / lenis.limit : 0));
    const r = place(u); placeCamera(u, r.b); shadowFollow();
    $('bar').style.width = (u * 100).toFixed(2) + '%';
    $('hud').textContent = `u ${u.toFixed(3)}   ${u < 0.13 ? 'perched' : u < 0.16 ? 'leap' : u < 0.81 ? 'flight' : u < 0.905 ? 'landing' : 'on the ledge'}${autoplay ? '   ' + ((u - playU0) * duration + (playU0 * duration)).toFixed(1) + ' / ' + duration + ' s' : ''}`;
  }
  draw(now / 1000);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// QA hooks
window.__op = { THREE, scene, camera, bird, flight, path, timeline, heightAt, PATH, skinned,
  setU(uu, time = performance.now() / 1000) { hold = true; u = uu; lifeT = time; const r = place(uu); placeCamera(uu, r.b); shadowFollow(); draw(time); return r; },
  render: (time = performance.now() / 1000) => draw(time), renderer, get post() { return post; }, get look() { return look; }, get embers() { return embers; },
  get tier() { return tier; }, ready: true };

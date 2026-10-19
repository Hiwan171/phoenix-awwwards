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
import { createFootGrip } from './beasts/fenix-grip.js';
import { createCloudSea, heightAt, surfaceAt, PEAK, LEDGE, SUN_DIR, CLOUD_Y } from './worlds/cloud-sea.js';
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
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.35;
const sun = new THREE.DirectionalLight(0xffc48a, 3.2); sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024); sun.shadow.camera.near = 0.5; sun.shadow.camera.far = 40; sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.02;
Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4 });
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight(0xffb48a, 0x2a1820, 0.9); scene.add(hemi);
const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 600);
let post = null, embers = null; const BUF = new THREE.Vector2(), camRight = new THREE.Vector3();
function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); post?.setSize(); }
addEventListener('resize', resize); resize();
if (LOOK) post = createHeroPost({ renderer, scene, camera, aura: Q.get('aura') !== '0', bloom: Q.get('bloom') !== '0', params: {
  samples: +(Q.get('msaa') ?? 4), scale: +(Q.get('scale') ?? 1), intensity: 0.8, height: 0.2, rim: 0, opaque: 0.4, steps: +(Q.get('steps') ?? 12), occluders: true, bloomStrength: +(Q.get('bs') ?? 0.5), bloomRadius: 0.55, bloomThreshold: +(Q.get('bt') ?? 1.8) } });

// ───────────── the world: worlds/cloud-sea.js (sky, pillars, the sea of clouds) ─────────────
// heightAt / surfaceAt / PEAK / LEDGE come from there: the two perch pillars are a heightfield her feet and tail touch exactly.
const sceneryDrifts = [];
const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
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
  [0, Hp + 0.5, 0.3],          // 0 perched (the bird's centre is ~0.5 above its feet; 0.3 back from the apex puts her FEET on the summit, not on its
                               //   steep front slope where one foot hung 12-28 cm above the rock)
  [0, Hp + 0.3, -2.6],         // 1 the leap: OUT and a little down (big birds drop off a perch to gain speed; climbing at once pitched
                               //   her nose-up and swung the rear through the summit)
  [1.6, Hp + 2.7, -7],         // 2 climbing
  [5, Hp + 3.3, -14],          // 3 over the valley
  [6.2, Hp + 2.6, -22],        // 4 soaring, turning left
  [2.5, CLOUD_Y + 4.0, -29],   // 5 gliding down to the cloud sea
  [-5, CLOUD_Y + 3.3, -34],    // 6 skimming the cloud tops (her fire lights them under her; the crests reach ~+2.5)
  [-10.5, L + 2.2, -37],       // 7 approach
  [-11.8, L + 0.95, -39.1],    // 8 flare
  [-12, L + 0.5, -40],         // 9 touchdown
];
const path = createPath(PATH);
const world = createCloudSea({ scene, avoid: PATH, quality: Q.get('lite') === '1' ? 0.5 : 1 });
for (const o of world.occluders) o.layers.enable(LAYER_OCCLUDER);
sun.color.copy(world.sunColor); sun.intensity = 3.4;
hemi.color.copy(world.skyLight); hemi.groundColor.copy(world.groundLight); hemi.intensity = 1.1;   // ground = the sunset bounce off the cloud sea
// s = position along the path (0 perch .. 1 ledge). Flat at both ends: she stands still; PCHIP gives zero speed there, smooth in between.
const KEYS = [
  { u: 0.00, s: 0.000, beats: 0.0,  flap: 0.00, open: 0.00, sweep: 0.0, legs: 0.00, tail: 0.40, fly: 0.00, stretch: 0.0, alert: 0.0, ground: 1.0, pitchBias: 0.00 },   // asleep on the peak, wings folded
  { u: 0.05, s: 0.000, beats: 0.0,  flap: 0.00, open: 0.00, sweep: 0.0, legs: 0.00, tail: 0.40, fly: 0.00, stretch: 0.0, alert: 0.0, ground: 1.0, pitchBias: 0.00 },
  { u: 0.09, s: 0.000, beats: 0.0,  flap: 0.00, open: 0.16, sweep: 0.0, legs: 0.00, tail: 0.60, fly: 0.00, stretch: 0.0, alert: 0.5, ground: 1.0, pitchBias: 0.00 },   // awake: shakes her plumage out
  { u: 0.105, s: 0.000, beats: 0.0, flap: 0.00, open: 0.10, sweep: 0.0, legs: 0.00, tail: 0.55, fly: 0.00, stretch: 0.0, alert: 1.0, ground: 1.0, pitchBias: 0.00 },   // looks around
  { u: 0.12, s: 0.000, beats: 0.0,  flap: 0.00, open: 0.55, sweep: 0.0, legs: 0.00, tail: 0.70, fly: 0.25, stretch: 0.0, alert: 0.6, ground: 1.0, pitchBias: -0.28 },  // crouch: leans forward, wings half open
  { u: 0.155, s: 0.030, beats: 0.6, flap: 1.00, open: 1.00, sweep: 0.0, legs: 0.30, tail: 0.80, fly: 0.55, stretch: 0.2, alert: 0.5, ground: 0.0, pitchBias: -0.15 },  // the leap: first big stroke, the body level or a touch nose-down (the tail stays up)
  { u: 0.24, s: 0.130, beats: 5.5,  flap: 1.00, open: 1.00, sweep: 0.0, legs: 0.70, tail: 0.50, fly: 0.85, stretch: 0.4, alert: 0.5, ground: 0.0, pitchBias: 0.12 },  // climbing
  { u: 0.40, s: 0.400, beats: 11.0, flap: 0.20, open: 1.00, sweep: 0.0, legs: 0.90, tail: 0.75, fly: 1.00, stretch: 1.0, alert: 0.8, ground: 0.0, pitchBias: 0.00 },  // soaring over the valley
  { u: 0.56, s: 0.630, beats: 12.0, flap: 0.05, open: 1.00, sweep: 0.1, legs: 0.90, tail: 0.85, fly: 1.00, stretch: 1.0, alert: 0.9, ground: 0.0, pitchBias: 0.00 },  // gliding, turning
  { u: 0.70, s: 0.800, beats: 14.0, flap: 0.35, open: 1.00, sweep: 0.0, legs: 0.70, tail: 0.80, fly: 0.95, stretch: 0.7, alert: 0.7, ground: 0.0, pitchBias: 0.04 },  // descending
  { u: 0.81, s: 0.930, beats: 17.0, flap: 0.80, open: 1.00, sweep: 0.0, legs: -0.40, tail: 1.00, fly: 0.55, stretch: 0.2, alert: 0.7, ground: 0.0, pitchBias: 0.15 }, // approach: legs reach forward
  { u: 0.87, s: 0.990, beats: 20.0, flap: 1.00, open: 1.00, sweep: 0.0, legs: -1.00, tail: 1.00, fly: 0.25, stretch: 0.0, alert: 0.6, ground: 0.20, pitchBias: 0.35 }, // flare: braking strokes (more nose-up put the tail into the ledge)
  { u: 0.905, s: 1.000, beats: 21.2, flap: 0.35, open: 1.00, sweep: 0.0, legs: -0.60, tail: 0.80, fly: 0.10, stretch: 0.0, alert: 0.9, ground: 1.0, pitchBias: 0.05 }, // touchdown, nearly level (the tail clears the ledge)
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
  { u: 0.00, cf: +(Q.get('cf') ?? 9.0), cr: +(Q.get('cr') ?? 3.5), cu: +(Q.get('cu') ?? -2.2), tf: 0.0, tu: +(Q.get('tu') ?? -0.6), fov: 30 },    // FRONT, centred, from a little below and further out: the whole peak, she sleeps on it against the sky (a slow push-in)
  { u: 0.05, cf: +(Q.get('cf') ?? 9.0) * 0.8, cr: +(Q.get('cr') ?? 3.5) * 0.8, cu: +(Q.get('cu') ?? -2.2) * 0.8, tf: 0.0, tu: +(Q.get('tu') ?? -0.6) * 0.7, fov: 30 },
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
const FOOT_MARGIN = 0.007, V = new THREE.Vector3();
// the crouch of the sleeping bird: hip, knee, ankle, foot, toes (rad); the angles sum to zero so the toes keep their orientation
// flat on the rock. Solved by a search over the four free joints: the body comes down 9 cm with the feet where they stood
flight.CROUCH.splice(0, 5, 0.6, -0.6, -0.4, 0, 0.4);
// CONTACT is measured on the mesh, not on the toe bones (the claws reach below them): the skinned vertices of the feet and
// toes (dominant joint = ankle, foot or toes of either leg), a fixed sample of them
// Fast CPU skinning of a fixed set of vertices (three's getVertexPosition rebuilds bone x inverse for every influence of every vertex:
// 1500 foot vertices x 3 calls took 32 ms a frame). Each influence is stored once in its bone's space (boneInverse * bindMatrix *
// position); per frame:  world = sum w * boneWorld * q  (attached bind mode: matrixWorld * bindMatrixInverse = identity).
function skinSet(indices) {
  const g = skinned.geometry, pos = g.attributes.position, si = g.attributes.skinIndex, sw = g.attributes.skinWeight, sk = skinned.skeleton;
  skinned.updateMatrixWorld(true);
  const bone = [], w = [], q = [], start = [0], p = new THREE.Vector3(), m = new THREE.Matrix4();
  for (const i of indices) {
    for (let k = 0; k < 4; k++) {
      const ww = sw.getComponent(i, k); if (ww <= 0) continue;
      const b = si.getComponent(i, k);
      p.fromBufferAttribute(pos, i).applyMatrix4(skinned.bindMatrix).applyMatrix4(sk.boneInverses[b]);
      bone.push(b); w.push(ww); q.push(p.x, p.y, p.z);
    }
    start.push(bone.length);
  }
  const bones = sk.bones;
  /** calls fn(x, y, z) with the world position of every vertex of the set */
  return (fn) => {
    for (let v = 0; v < indices.length; v++) {
      let x = 0, y = 0, z = 0;
      for (let k = start[v]; k < start[v + 1]; k++) {
        const e = bones[bone[k]].matrixWorld.elements, qx = q[k * 3], qy = q[k * 3 + 1], qz = q[k * 3 + 2], ww = w[k];
        x += ww * (e[0] * qx + e[4] * qy + e[8] * qz + e[12]); y += ww * (e[1] * qx + e[5] * qy + e[9] * qz + e[13]); z += ww * (e[2] * qx + e[6] * qy + e[10] * qz + e[14]);
      }
      fn(x, y, z);
    }
  };
}
const contactVerts = (() => {
  const g = skinned.geometry, si = g.attributes.skinIndex, sw = g.attributes.skinWeight, names = skinned.skeleton.bones.map((b) => b.name);
  const footJ = new Set(['Bone_004', 'Bone_003', 'Bone_002', 'Bone_011', 'Bone_010', 'Bone_009'].map((n) => names.indexOf(n)));
  const out = [];
  for (let i = 0; i < si.count; i++) { let b = 0, w = -1; for (let k = 0; k < 4; k++) { const ww = sw.getComponent(i, k); if (ww > w) { w = ww; b = si.getComponent(i, k); } } if (footJ.has(b)) out.push(i); }
  const step = Math.max(1, Math.floor(out.length / 1500));
  return out.filter((_, i) => i % step === 0);
})();
// THE TAIL never goes into the rock either. On the peak and on the ledge the long plumes hang down behind her over the rock (measured:
// 6 cm into it asleep, 26 cm at the touchdown, 55 cm sweeping past the peak at the leap). The lift needed is solved ONCE at load for every u (a bisection on
// P.tailLift against the skinned tail vertices, wind off) and read back as a smooth curve, plus a margin for the wind's sway.
const tailVerts = (() => {
  const g = skinned.geometry, si = g.attributes.skinIndex, sw = g.attributes.skinWeight, names = skinned.skeleton.bones.map((b) => b.name);
  const isTail = names.map((nm) => /^F_tail/.test(nm) || (/^Bone_0(1[4-9]|2\d|3[01])$/.test(nm)));
  const out = [];
  for (let i = 0; i < si.count; i++) { let b = 0, w = -1; for (let k = 0; k < 4; k++) { const ww = sw.getComponent(i, k); if (ww > w) { w = ww; b = si.getComponent(i, k); } } if (isTail[b]) out.push(i); }
  const step = Math.max(1, Math.floor(out.length / 1500));
  return out.filter((_, i) => i % step === 0);
})();
const tailSkin = skinSet(tailVerts);
function tailClearance() {
  bird.updateMatrixWorld(true);
  let low = Infinity;
  tailSkin((x, y, z) => { const c = y - surfaceAt(x, z); if (c < low) low = c; });
  return low;
}
const TAIL_MARGIN = 0.08, TAIL_DU = 0.005, TAIL_MAX = 1.0, TAIL_MAX_GROUND = 1.8;
let tailLiftTable = null, bodyLiftTable = null, liftSolve = null;
const readTable = (tb, u) => { if (!tb) return 0; const x = Math.min(1, Math.max(0, u)) / TAIL_DU, i = Math.min(tb.length - 2, Math.floor(x)), f = x - i; return tb[i] * (1 - f) + tb[i + 1] * f; };
function tailLiftAt(u) { return liftSolve !== null ? liftSolve : readTable(tailLiftTable, u); }
function bodyLiftAt(u) { return liftSolve !== null ? 0 : readTable(bodyLiftTable, u); }
function solveTailLift() {
  const n = Math.round(1 / TAIL_DU) + 1, raw = new Float32Array(n), rawY = new Float32Array(n), keepT = lifeT;
  lifeT = 10;
  for (let i = 0; i < n; i++) {
    const u = i * TAIL_DU;
    liftSolve = 0; place(u, true, true);                            // every u: at the leap and the touchdown the tail sweeps past the rock too
    if (tailClearance() >= TAIL_MARGIN) continue;
    // the tail rises up to TAIL_MAX (beyond that it would stand up unnaturally); what is still missing lifts the whole body
    // (at the leap the rear swings down through the peak as she pitches up: the tail ROOTS were in the rock)
    const onGround = timeline.at(u).ground > 0.001, cap = onGround ? TAIL_MAX_GROUND : TAIL_MAX;
    liftSolve = cap; place(u, true, true);
    const cMax = tailClearance();
    if (cMax < TAIL_MARGIN) { raw[i] = cap; if (!onGround) rawY[i] = TAIL_MARGIN - cMax; continue; }   // the body never rises off its feet
    let lo = 0, hi = cap;
    for (let it = 0; it < 7; it++) { const mid = (lo + hi) / 2; liftSolve = mid; place(u, true, true); if (tailClearance() >= TAIL_MARGIN) hi = mid; else lo = mid; }
    raw[i] = hi;
  }
  liftSolve = null; lifeT = keepT;
  // smooth: a running max over +-3 samples (never less than needed), then a light blur (no jerk as u moves)
  const smooth = (r) => { const mx = r.map((_, i) => { let m = 0; for (let k = -3; k <= 3; k++) m = Math.max(m, r[Math.min(n - 1, Math.max(0, i + k))]); return m; });
    return mx.map((_, i) => { let s = 0, w = 0; for (let k = -2; k <= 2; k++) { const ww = 3 - Math.abs(k); s += ww * mx[Math.min(n - 1, Math.max(0, i + k))]; w += ww; } return Math.max(r[i], s / w); }); };
  tailLiftTable = smooth(raw); bodyLiftTable = smooth(rawY);
}
// ───────────── FOOT PLACEMENT: each foot on its own ground ─────────────
// The summit is not flat: with two legs of the same length one foot stood on the rock and the other hung 11-28 cm above it (it
// looked like she was floating). Each leg is solved on its own: hip, knee and ankle rotate (the foot joint gives the sum back, so
// the foot keeps its orientation) to bring that foot's SOLE down to the rock, the toes joint follows the slope (heel and claw tips
// both touch), and the toes do not slide fore/aft. Like the tail, solved ONCE at load per u on the ground and read as a curve.
const LEG_FOOT = [['Bone_004', 'Bone_003', 'Bone_002'], ['Bone_011', 'Bone_010', 'Bone_009']], LEG_ANKLE = ['Bone_003', 'Bone_010'], LEG_TOES = ['Bone_002', 'Bone_009'];
const legSkins = LEG_FOOT.map((nmz) => {
  const g = skinned.geometry, si = g.attributes.skinIndex, sw = g.attributes.skinWeight, names = skinned.skeleton.bones.map((b) => b.name);
  const set = new Set(nmz.map((n) => names.indexOf(n))), out = [];
  for (let i = 0; i < si.count; i++) { let b = 0, w = -1; for (let k = 0; k < 4; k++) { const ww = sw.getComponent(i, k); if (ww > w) { w = ww; b = si.getComponent(i, k); } } if (set.has(b)) out.push(i); }
  return skinSet(out.filter((_, i) => i % 2 === 0));
});
const V2 = new THREE.Vector3(), FWD = new THREE.Vector3();
/** sole of leg li: lowest clearance near the heel (< 40 % of the foot's reach from the foot joint) and near the claw tips (> 60 %),
 *  and where the toes are along her heading */
function soleOf(li) {
  bird.updateMatrixWorld(true);
  const a = flight.bones[flight.byName.get(LEG_ANKLE[li])].getWorldPosition(V2), ax = a.x, az = a.z, pts = [];
  let dMax = 1e-6;
  legSkins[li]((x, y, z) => { const d = Math.hypot(x - ax, z - az); pts.push(d, y - surfaceAt(x, z)); if (d > dMax) dMax = d; });
  let heel = 9, tip = 9;
  for (let i = 0; i < pts.length; i += 2) { const f = pts[i] / dMax, c = pts[i + 1]; if (f < 0.4 && c < heel) heel = c; if (f > 0.6 && c < tip) tip = c; }
  FWD.set(0, 0, -1).applyQuaternion(bird.quaternion); FWD.y = 0; FWD.normalize();
  const t = flight.bones[flight.byName.get(LEG_TOES[li])].getWorldPosition(V2);
  return { heel, tip, fwd: (t.x - bird.position.x) * FWD.x + (t.z - bird.position.z) * FWD.z };
}
const LEG_DU = 0.01, SOLE_MARGIN = 0.006, LEG_ITERS = +(Q.get('legit') ?? 4), LEG_LIM = +(Q.get('leglim') ?? 0.9);
let legAdjTable = null, legSolve = null;
const legAdjOut = new Float64Array(10);
function legAdjAt(u) {
  if (legSolve !== null) return legSolve;
  if (!legAdjTable) return null;
  const x = Math.min(1, Math.max(0, u)) / LEG_DU, i = Math.min(legAdjTable.length - 2, Math.floor(x)), f = x - i;
  for (let k = 0; k < 10; k++) legAdjOut[k] = legAdjTable[i][k] * (1 - f) + legAdjTable[i + 1][k] * f;
  return legAdjOut;
}
// the free parameters of a leg: (hip +d, foot -d), (knee +d, foot -d), (ankle +d, foot -d), (toes +d)
const LEG_BASIS = [[1, 0, 0, -1, 0], [0, 1, 0, -1, 0], [0, 0, 1, -1, 0], [0, 0, 0, 0, 1]];
function solveLegsAt(u) {
  const adj = new Float64Array(10); legSolve = adj;
  place(u, true, true);
  const fwd0 = [soleOf(0).fwd, soleOf(1).fwd];
  const resid = (li) => { place(u, true, true); const s0 = soleOf(li); return [s0.heel - SOLE_MARGIN, s0.tip - SOLE_MARGIN, (s0.fwd - fwd0[li]) * 2]; };
  for (let it = 0; it < LEG_ITERS; it++) {
    for (let li = 0; li < 2; li++) {
      const r0 = resid(li);
      if (Math.abs(r0[0]) < 0.002 && Math.abs(r0[1]) < 0.002) continue;
      // Jacobian by finite differences over the 4 parameters, damped least squares  (J^T J + l I) dp = -J^T r
      const J = LEG_BASIS.map((bv) => { const d = 0.04; for (let j = 0; j < 5; j++) adj[li * 5 + j] += bv[j] * d; const r1 = resid(li); for (let j = 0; j < 5; j++) adj[li * 5 + j] -= bv[j] * d; return r1.map((x, k) => (x - r0[k]) / d); });
      const n = 4, A = Array.from({ length: n }, (_, a) => Array.from({ length: n }, (_, b) => J[a].reduce((sum, x, k) => sum + x * J[b][k], 0) + (a === b ? 0.02 : 0)));
      const g = J.map((col) => -col.reduce((sum, x, k) => sum + x * r0[k], 0));
      // solve A x = g (Gauss)
      for (let c = 0; c < n; c++) { let pv = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[pv][c])) pv = r; [A[c], A[pv]] = [A[pv], A[c]]; [g[c], g[pv]] = [g[pv], g[c]];
        for (let r = c + 1; r < n; r++) { const m = A[r][c] / A[c][c]; for (let k = c; k < n; k++) A[r][k] -= m * A[c][k]; g[r] -= m * g[c]; } }
      const x = new Array(n).fill(0); for (let c = n - 1; c >= 0; c--) { let v = g[c]; for (let k = c + 1; k < n; k++) v -= A[c][k] * x[k]; x[c] = v / A[c][c]; }
      const big = Math.max(...x.map(Math.abs)), sc = big > 0.35 ? 0.35 / big : 1;
      x.forEach((dp, k) => { for (let j = 0; j < 5; j++) adj[li * 5 + j] += LEG_BASIS[k][j] * dp * sc; });
      for (let j = 0; j < 5; j++) adj[li * 5 + j] = Math.max(-LEG_LIM, Math.min(LEG_LIM, adj[li * 5 + j]));   // a leg, not a contortionist
    }
  }
  legSolve = null;
  return Array.from(adj);
}
function solveLegs() {
  const n = Math.round(1 / LEG_DU) + 1, keepT = lifeT; lifeT = 10;
  const tab = Array.from({ length: n }, () => new Array(10).fill(0)), gnd = [];
  for (let i = 0; i < n; i++) { const u = i * LEG_DU, g = timeline.at(u).ground; gnd.push(g); if (g > 0.999) tab[i] = solveLegsAt(u); }
  // partly on the ground (taking off / touching down): the nearest standing solution, faded by the ground weight
  for (let i = 0; i < n; i++) if (gnd[i] <= 0.999 && gnd[i] > 0.001) { let j = i, best = -1; for (let k = 1; k < n && best < 0; k++) { if (i - k >= 0 && gnd[i - k] > 0.999) best = i - k; else if (i + k < n && gnd[i + k] > 0.999) best = i + k; } if (best >= 0) tab[i] = tab[best].map((v) => v * gnd[i]); }
  legAdjTable = tab; lifeT = keepT;
}
/** the lowest point of the feet above the terrain (world units) */
const footSkin = skinSet(contactVerts);
function footClearance() {
  bird.updateMatrixWorld(true);                                     // the BONES' world matrices (getVertexPosition reads them), not just the mesh's
  let low = Infinity;
  footSkin((x, y, z) => { const c = y - surfaceAt(x, z); if (c < low) low = c; });
  return low;
}

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
function place(u, usePlants = true, noWind = false) {
  if (usePlants && !plants) {                                       // where the feet touch, once; and the height she leaps FROM
    const leapU = KEYS.filter((k) => k.ground === 1 && k.u < 0.5).pop().u;
    plants = { start: (place(0, false), feetXZ()), end: (place(KEYS.find((k) => k.ground === 1 && k.u > 0.5).u, false), feetXZ()) };
    place(leapU, false); plants.leapY = bird.position.y; plants.leapU = leapU;
  }
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
    ground: k.ground, legAdj: legAdjAt(u), sleep: lf.sleep, crouch: lf.sleep, shake: lf.shake, tailLift: tailLiftAt(u), shakePh: u * 300, wind: noWind ? 0 : lf.wind * WIND_GAIN, hug: lf.hug, windX: windM.x, windY: windM.y, windZ: windM.z,
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
    // the lowest point of the feet (mesh) touches the rock: never inside it
    // (and whatever the ground weight, a foot never goes INTO the rock: at the leap the weight fades while the feet are still on it)
    if (plants?.leapY !== undefined && u > plants.leapU && u < 0.5 && k.ground < 0.999) {
      // the LEAP: the weight of the ground eases her from the height she leaps from to the flight path. Pulling her to the rock under
      // her feet would drag her down as she passes the edge of the summit (the rear swung into the rock); the push-up below keeps the
      // feet out of it
      bird.position.y += k.ground * (plants.leapY - bird.position.y);
      const c = footClearance(); if (c < FOOT_MARGIN) bird.position.y += FOOT_MARGIN - c;
    } else { const c = footClearance(); bird.position.y += Math.max(k.ground * (FOOT_MARGIN - c), FOOT_MARGIN - c); }
    if (usePlants && k.ground > 0.5) {                                // planted feet: they stay where they touched down
      const pl = u < 0.5 ? plants.start : plants.end, w = THREE.MathUtils.smoothstep(k.ground, 0.5, 1.0), f = feetXZ();
      bird.position.x += w * (pl[0] - f[0]); bird.position.z += w * (pl[1] - f[1]);
      { const c = footClearance(); bird.position.y += Math.max(k.ground * (FOOT_MARGIN - c), FOOT_MARGIN - c); }   // moved sideways: the rock under the feet changed, touch again
    }
  }
  bird.position.y += bodyLiftAt(u);                                 // the leap clears the peak (solved with the tail lift)
  if (usePlants && !noWind) { bird.updateMatrixWorld(true); grip?.update(k.ground); }
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
  camPos.y = Math.max(camPos.y, CLOUD_Y + 4.2);                     // never inside (or under) the cloud sea
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
  world.update({ time, camera, bird: bird.position, heat: heatNow });
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
if (Q.get('far') !== '0') await world.bakeFar(renderer, (f) => { const b = document.getElementById('bar'); if (b) b.style.width = (f * 100).toFixed(1) + '%'; });
const solveT0 = performance.now();
solveLegs();                                               // once: each foot on its own ground (before the tail: it moves the body)
// the claws close on the rock where it falls away under them (after skinning, see fenix-grip.js); ?grip=0 off
const grip = Q.get('grip') === '0' ? null : createFootGrip({ mesh: skinned, feet: LEG_FOOT, joints: LEG_ANKLE, surfaceAt });
solveTailLift();                                           // once, now that the scene and the feet are known
const solveMs = performance.now() - solveT0;                // (to bake into data for the site: they depend on u only)
requestAnimationFrame(frame);

// QA hooks
window.__op = { THREE, scene, camera, bird, flight, path, timeline, heightAt, surfaceAt, PATH, skinned, world,
  setU(uu, time = performance.now() / 1000) { hold = true; u = uu; lifeT = time; const r = place(uu); placeCamera(uu, r.b); shadowFollow(); draw(time); return r; },
  render: (time = performance.now() / 1000) => draw(time), renderer, get post() { return post; }, get look() { return look; }, get embers() { return embers; },
  get tier() { return tier; }, solveMs, tailClearance, footClearance, soleOf, get legAdjTable() { return legAdjTable; }, setLiftSolve(v) { liftSolve = v; }, place, ready: true };

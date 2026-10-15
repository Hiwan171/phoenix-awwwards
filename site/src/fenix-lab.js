// Dev-only lab for the phoenix rig (not part of the production build: vite builds index.html only).
//   /fenix-lab.html            web variant        /fenix-lab.html?m=lite    lite variant
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { createFenix, FENIX_DEFAULTS } from './beasts/fenix.js';

const Q = new URLSearchParams(location.search);
const variant = Q.get('m') === 'lite' ? 'lite' : 'web';
const $ = (id) => document.getElementById(id);

const renderer = new THREE.WebGLRenderer({ canvas: $('gl'), antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.95;
const scene = new THREE.Scene();
const g = document.createElement('canvas'); g.width = 4; g.height = 256;
{
  const x = g.getContext('2d'), grad = x.createLinearGradient(0, 0, 0, 256);
  [[0, '#2c3340'], [0.45, '#6d727c'], [0.62, '#d79a45'], [0.70, '#6c4524'], [1, '#0a0807']].forEach(([s, c]) => grad.addColorStop(s, c));
  x.fillStyle = grad; x.fillRect(0, 0, 4, 256);
}
const bg = new THREE.CanvasTexture(g); bg.colorSpace = THREE.SRGBColorSpace; scene.background = bg;
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.4;
const key = new THREE.DirectionalLight(0xffe1bd, 3.0); key.position.set(-2.4, 2.6, -1.6); scene.add(key);
const rim = new THREE.DirectionalLight(0xffb866, 2.0); rim.position.set(1.2, 0.8, 4.5); scene.add(rim);
scene.add(new THREE.HemisphereLight(0xdfe6ee, 0x3a2418, 0.5));
const floor = new THREE.GridHelper(4, 40, 0x6b5a45, 0x2d2822); floor.position.y = -0.5; scene.add(floor);

const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 50);
camera.position.set(1.6, 0.7, -2.7);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.0, 0.05); controls.enableDamping = true; controls.dampingFactor = 0.08;
function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(`/models/fenix-${variant}.glb`);
gltf.scene.traverse((o) => { if (o.isMesh || o.isSkinnedMesh) o.frustumCulled = false; });
scene.add(gltf.scene);
const phx = createFenix(gltf.scene);
const P = phx.params;

const bind = (id, out, fn, fmt = (v) => v.toFixed(2)) => {
  const el = $(id), o = $(out);
  const apply = () => { const v = +el.value; o.textContent = fmt(v); fn(v); };
  el.addEventListener('input', apply); apply();
};
let manual = { open: 0.75, flap: 0 };
bind('open', 'o-open', (v) => { manual.open = v; });
bind('flap', 'o-flap', (v) => { manual.flap = v; });
bind('sweep', 'o-sweep', (v) => { P.sweep = v; });
bind('fan', 'o-fan', (v) => { P.fanGain = v; });
bind('hy', 'o-hy', (v) => { P.lookYaw = v; });
bind('hp', 'o-hp', (v) => { P.lookPitch = v; });
bind('leg', 'o-leg', (v) => { P.legTuck = v; });
bind('pw', 'o-pw', (v) => { P.plumeWave = v; });
bind('wd', 'o-wd', (v) => { P.wind = [v, v * 0.15, 0]; });
$('reset').addEventListener('click', () => {
  Object.assign(P, FENIX_DEFAULTS);
  for (const [id, v] of [['open', 0.75], ['flap', 0], ['sweep', 0], ['fan', 1], ['hy', 0], ['hp', 0], ['leg', 0], ['pw', 0.08], ['wd', 0]]) { $(id).value = v; $(id).dispatchEvent(new Event('input')); }
  $('demo').checked = false;
});

let last = performance.now(), acc = 0, frames = 0, ctrlMs = 0, fps = 0, tDemo = 0;
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if ($('demo').checked) {                                  // a slow, elegant breathing of the wings for the eye
    tDemo += dt;
    P.open = 0.85 + 0.35 * Math.sin(tDemo * 0.9); P.flap = 0.35 * Math.sin(tDemo * 0.9 - 0.6);
  } else { P.open = manual.open; P.flap = manual.flap; }
  if ($('auto').checked) { const t0 = performance.now(); phx.update(dt); ctrlMs += performance.now() - t0; }
  controls.update();
  renderer.render(scene, camera);
  frames++; acc += dt;
  if (acc >= 0.5) { fps = frames / acc; $('stat').textContent = `${variant} · ${fps.toFixed(0)} fps · rig ${(ctrlMs / frames).toFixed(2)} ms · ${phx.wings.length} wings (${phx.wings.map((w) => w.columns.length).join('+')} feather columns) + ${phx.plumes.length} plumes + ${phx.crest.length} crest strands`; acc = 0; frames = 0; ctrlMs = 0; }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
window.__lab = { phx, scene, camera, renderer, THREE };

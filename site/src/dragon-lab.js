// Dev-only lab for the dragon rig (not part of the production build: vite builds index.html only).
//   /dragon-lab.html            web variant        /dragon-lab.html?m=lite    lite variant
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { createDragon, DRAGON_DEFAULTS } from './beasts/dragon.js';

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
camera.position.set(1.7, 0.55, -2.6);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.0, -0.05); controls.enableDamping = true; controls.dampingFactor = 0.08;
function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(`/models/dragon-${variant}.glb`);
gltf.scene.traverse((o) => { if (o.isMesh || o.isSkinnedMesh) o.frustumCulled = false; });
scene.add(gltf.scene);
const dragon = createDragon(gltf.scene);
const P = dragon.params;

// ── controls
const bind = (id, out, fn, fmt = (v) => v.toFixed(2)) => {
  const el = $(id), o = $(out);
  const apply = () => { const v = +el.value; o.textContent = fmt(v); fn(v); };
  el.addEventListener('input', apply); apply();
};
bind('amp', 'o-amp', (v) => { P.amp = v; });
bind('wl', 'o-wl', (v) => { P.waveLength = v; });
bind('fq', 'o-fq', (v) => { P.frequency = v; });
bind('hy', 'o-hy', (v) => { P.headYaw = v; });
bind('hp', 'o-hp', (v) => { P.headPitch = v; });
bind('wd', 'o-wd', (v) => { P.wind = [v, v * 0.15, 0]; });
bind('ob', 'o-ob', (v) => { P.orbHold = v; });
$('legs').addEventListener('change', (e) => { P.legMode = e.target.value; if (P.legMode === 'orb' && P.orbHold === 0) { $('ob').value = 1; $('ob').dispatchEvent(new Event('input')); } });
$('strands').addEventListener('change', (e) => { P.strands = e.target.checked; });
$('orbshow').addEventListener('change', (e) => { P.showOrb = e.target.checked; if (!P.showOrb && dragon.orbMarker) dragon.orbMarker.visible = false; });
$('reset').addEventListener('click', () => {
  Object.assign(P, DRAGON_DEFAULTS);
  for (const [id, v] of [['amp', 1.2], ['wl', 1.55], ['fq', 0.55], ['hy', 0], ['hp', 0], ['wd', 0], ['ob', 0]]) { $(id).value = v; $(id).dispatchEvent(new Event('input')); }
  $('legs').value = 'passive';
});
P.amp = 1.2;

// ── loop
let last = performance.now(), acc = 0, frames = 0, ctrlMs = 0, fps = 0;
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if ($('auto').checked) {
    const t0 = performance.now(); dragon.update(dt); ctrlMs += performance.now() - t0;
  }
  controls.update();
  renderer.render(scene, camera);
  frames++; acc += dt;
  if (acc >= 0.5) { fps = frames / acc; $('stat').textContent = `${variant} · ${fps.toFixed(0)} fps · rig ${(ctrlMs / frames).toFixed(2)} ms · ${dragon.ik.n} spine + ${dragon.legs.length} legs + ${dragon.whiskers.length} whiskers + ${dragon.manes.length} locks`; acc = 0; frames = 0; ctrlMs = 0; }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
window.__lab = { dragon, scene, camera, renderer, THREE };

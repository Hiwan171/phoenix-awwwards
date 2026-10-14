// Sky test: realistic sky + sun + clouds behind the phoenix (approved fire preset), driven by an altitude slider.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { makeUniforms, SHELL_VERT, SHELL_FRAG } from './shaders.js';
import { createSky, skyState, SKY } from './sky.js';
import { createToySky } from './toy-sky.js';
import toySource from './toy/sky.glsl?raw';

const Q = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
addEventListener('error', (e) => { $('err').textContent += e.message + '\n'; });

const params = {
  a: Q.has('a') ? +Q.get('a') : 0.52,        // opens at sunrise; the 'hero' preset (a = 0) is the night void
  az: Q.has('az') ? +Q.get('az') : 0.14,
  quality: Q.get('q') ?? 'high',
  auto: false,
};

// ───────── renderer / scene ─────────
const renderer = new THREE.WebGLRenderer({ canvas: $('gl'), antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.05, 40);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.35, 0.5, 1.6);
composer.addPass(bloom);
if (Q.get('bloom') === '0') bloom.enabled = false;
composer.addPass(new OutputPass());

// ───────── sky ─────────
let sky = null;
function buildSky() {
  if (sky) { scene.remove(sky.mesh); sky.mesh.material.dispose(); }
  sky = createSky({ quality: params.quality });
  scene.add(sky.mesh);
}
buildSky();
if (Q.get('nosky') === '1') sky.mesh.visible = false;

// ?toy=1 -> replace the procedural sky with the Shadertoy shader in src/toy/sky.glsl
// (?res=0.5 render scale, ?gamma=0 if the shader already outputs linear colour)
let toy = null;
if (Q.get('toy') === '1') {
  sky.mesh.visible = false;
  toy = createToySky({ source: toySource, scale: +(Q.get('res') ?? 0.5), gamma: Q.get('gamma') !== '0', renderer });
  scene.add(toy.mesh);
  toy.resize(innerWidth, innerHeight, renderer.getPixelRatio());
  document.getElementById('ui').style.opacity = '0.9';
}

// ───────── lights (driven by the sky) ─────────
const sunLight = new THREE.DirectionalLight(0xffffff, 1);          // sun, from behind the phoenix: rim
const fill = new THREE.DirectionalLight(0xffffff, 1);              // sky bounce from the camera side
fill.position.set(-1.2, 0.8, -3);
const hemi = new THREE.HemisphereLight(0xffffff, 0x3a1a0a, 0.5);
const fireA = new THREE.PointLight(0xff5a1a, 0.5, 3, 2); fireA.position.set(0.25, -0.35, -0.65);
scene.add(sunLight, fill, hemi, fireA);

// ───────── phoenix + approved flames (3 shells) ─────────
const U = makeUniforms();
U.uReveal.value = 1; U.uIgnite.value = 1;
let skinned, skeleton, mixer, shells = [];
const gltf = await new Promise((res, rej) => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).load('/models/phoenix-web.glb', res, undefined, rej));
scene.add(gltf.scene);
gltf.scene.traverse((o) => { if (o.isSkinnedMesh && !skinned) skinned = o; });
skeleton = skinned.skeleton; skinned.frustumCulled = false;
// golden rim light: separates the silhouette from any background (strongest when the sun sits behind her)
const rimU = { uRim: { value: Q.get('toy') === '1' ? +(Q.get('rim') ?? 0.85) : 0 }, uRimCol: { value: new THREE.Color(1.0, 0.74, 0.36) } };
skinned.material.onBeforeCompile = (sh) => {
  Object.assign(sh.uniforms, rimU);
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', `#include <common>
uniform float uRim; uniform vec3 uRimCol;`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      { float rm = pow(1.0 - saturate(dot(normalize(vNormal), normalize(vViewPosition))), 2.6);
        totalEmissiveRadiance += uRimCol * rm * uRim * (0.35 + 0.65 * smoothstep(0.1, 0.5, dot(diffuseColor.rgb, vec3(0.30, 0.59, 0.11)) + 0.15)); }`);
};
skinned.material.customProgramCacheKey = () => 'phoenix-rim';
for (let i = 0; i < 3; i++) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...U, uShell: { value: (i + 1) / 4 }, uMap: { value: skinned.material.map } },
    vertexShader: SHELL_VERT, fragmentShader: SHELL_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const m = new THREE.SkinnedMesh(skinned.geometry, mat);
  m.bind(skeleton, skinned.bindMatrix); m.frustumCulled = false; m.renderOrder = 10 + i;
  skinned.parent.add(m); shells.push(m);
}
if (Q.get('nophoenix') === '1') { gltf.scene.visible = false; shells.forEach((m) => { m.visible = false; }); }
mixer = new THREE.AnimationMixer(gltf.scene);
const clip = Q.get('clip') ?? 'Hover';
mixer.clipAction(gltf.animations.find((c) => c.name === clip) ?? gltf.animations[0]).play();

// ───────── UI ─────────
const bind = (id, vid, fn, fmt = 2) => $(id).oninput = (e) => { const v = +e.target.value; $(vid).textContent = v.toFixed(fmt); fn(v); };
$('alt').value = params.a;
$('alt').oninput = (e) => { params.a = +e.target.value; params.auto = false; $('auto').classList.remove('on'); };
document.querySelectorAll('#presets button').forEach((b) => b.onclick = () => { params.a = +b.dataset.a; $('alt').value = params.a; params.auto = false; $('auto').classList.remove('on'); });
$('auto').onclick = () => { params.auto = !params.auto; $('auto').classList.toggle('on', params.auto); if (params.auto && params.a > 0.98) params.a = 0; };
bind('cover', 'vCover', (v) => { sky.uniforms.uCover.value = v; });
bind('wind', 'vWind', (v) => { sky.uniforms.uWind.value = v; }, 0);
bind('az', 'vAz', (v) => { params.az = v; });
bind('fire', 'vFire', (v) => { U.uFire.value = v; });
$('c-stars').onchange = (e) => { sky.uniforms.uStars.value = e.target.checked ? 1 : 0; };
$('c-clouds').onchange = (e) => { sky.uniforms.uClouds.value = e.target.checked ? 1 : 0; };
$('c-cirrus').onchange = (e) => { sky.uniforms.uCirrus.value = e.target.checked ? 1 : 0; };
$('c-fire').onchange = (e) => { shells.forEach((s) => { s.visible = e.target.checked; }); };
$('c-bloom').onchange = (e) => { bloom.enabled = e.target.checked; };
$('quality').value = params.quality;
$('quality').onchange = (e) => { params.quality = e.target.value; buildSky(); };
for (const k of (Q.get('off') ?? '').split(',').filter(Boolean)) { const el = document.getElementById('c-' + k); if (el) { el.checked = false; el.onchange({ target: el }); } }
if (Q.has('cover')) { sky.uniforms.uCover.value = +Q.get('cover'); }

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight, false); composer.setSize(innerWidth, innerHeight);
  toy?.resize(innerWidth, innerHeight, renderer.getPixelRatio());
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
});
camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();

const pointer = { x: 0, y: 0 };
addEventListener('pointermove', (e) => { pointer.x = (e.clientX / innerWidth) * 2 - 1; pointer.y = (e.clientY / innerHeight) * 2 - 1; }, { passive: true });

// ───────── loop ─────────
const clock = new THREE.Clock();
let time = Q.has('t') ? +Q.get('t') : 0, fpsAcc = 0, fpsN = 0;
const frozen = Q.has('t');
const tint = (rgb, max = 1) => { const m = Math.max(...rgb, 1e-4); return new THREE.Color(rgb[0] / m * max, rgb[1] / m * max, rgb[2] / m * max); };

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (!frozen) time += dt;
  if (params.auto) { params.a = Math.min(1, params.a + dt / 30); $('alt').value = params.a; if (params.a >= 1) { params.auto = false; $('auto').classList.remove('on'); } }

  const st = skyState(params.a, { sunAz: params.az });
  U.uTime.value = time;

  // camera: same framing as the hero (phoenix right of centre), tiny parallax
  camera.position.set(Math.sin(pointer.x * 0.05) * 2.5, 0.1 + pointer.y * 0.03, -Math.cos(pointer.x * 0.05) * 2.5);
  camera.lookAt(0.26, -0.03, 0);
  sky.update(st, camera, time);
  toy?.render(time, dt, { x: (pointer.x * 0.5 + 0.5) * innerWidth * 0.5, y: (1 - (pointer.y * 0.5 + 0.5)) * innerHeight * 0.5 });

  // lights follow the sky
  const sunUp = Math.min(1, Math.max(0, (st.elev + 3) / 11));
  sunLight.position.set(st.sunDir[0] * 6, st.sunDir[1] * 6 + 0.5, st.sunDir[2] * 6);
  sunLight.color.copy(tint(st.eye)); sunLight.intensity = 3.2 * sunUp;
  fill.color.copy(tint(st.amb)); fill.intensity = 0.25 + 1.6 * st.day + 0.9 * st.dawn;
  hemi.color.copy(tint(st.amb)); hemi.intensity = 0.15 + 0.7 * st.day;
  scene.environmentIntensity = 0.18 + 0.5 * st.day;
  renderer.toneMappingExposure = 0.95 - 0.3 * st.day;
  fireA.intensity = (0.5 + Math.sin(time * 11) * 0.1) * (1 - 0.7 * st.day);

  mixer.update(frozen ? 0 : dt);
  if (frozen && !renderer.__seek) { mixer.setTime(time); renderer.__seek = true; }

  $('mist').style.opacity = String(Math.min(0.92, st.mist * 0.95));
  $('vAlt').textContent = `${Math.round(st.camH)} m`;
  $('hud-alt').textContent = `altitude ${Math.round(st.camH)} m`;
  $('hud-sun').textContent = `sol ${st.elev.toFixed(1)}°`;

  // bloom must only catch the fire at night and the sun by day, never the whole bright sky
  bloom.threshold = 0.9 + 3.4 * Math.min(1, Math.max(0, (st.elev + 4) / 10));
  composer.render();
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) { $('hud-fps').textContent = `${Math.round(fpsN / fpsAcc)} fps`; fpsAcc = 0; fpsN = 0; }
  window.__sky = { ready: true, st };
});

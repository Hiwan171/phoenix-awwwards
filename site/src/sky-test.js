// Sky test: realistic sky + sun + clouds behind the phoenix (approved fire preset), driven by an altitude slider.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { makeUniforms, SHELL_VERT, SHELL_FRAG, GRADE_GLSL, PLUMAGE_GLSL } from './shaders.js';
import { bakePlumage } from './plumage.js';
import { patchPhoenixMaterial } from './phoenix-material.js';
import { RIG_FORM, LOOKS } from './looks.js';
import { createFlameAura } from './flame-aura.js';
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

// ───────── looks (toy sky only): colour grade of the sky + lighting rig of the phoenix ─────────
// Why they exist: the sky tint goes through pow(2.6)+tonemap (so it is hugely amplified) and the phoenix used to be
// lit by the sky's own orange. A look decouples both: a muted sky, and a phoenix lit by neutral-warm light so her
// albedo (red + gold) is what reads, not the sunset.
// default for the toy sky: 'golden' (orange only near the sun, slate overhead). ?look=now restores the previous grade
const look = LOOKS[Q.get('look') ?? (Q.get('toy') === '1' ? 'golden' : 'now')] ?? LOOKS.now;
if (Q.has('sat')) look.sat = +Q.get('sat');

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
  toy = createToySky({ source: toySource, scale: +(Q.get('res') ?? 0.5), gamma: Q.get('gamma') !== '0', renderer,
                      defines: look.defines, sat: look.sat });
  scene.add(toy.mesh);
  toy.resize(innerWidth, innerHeight, renderer.getPixelRatio());
  document.getElementById('ui').style.opacity = '0.9';
  if (Q.has('skyDim')) toy.bgUniforms.uDim.value = +Q.get('skyDim');   // ?skyDim=0.2: a night-like backdrop to judge the flames
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
// albedo grade: ON by default in the toy sky (?pg=0 = the raw texture). Tune: ?pgHue=deg ?pgSat= ?pgVal= (reds) ?pgAmber=
const gradeOn = Q.get('toy') === '1' && Q.get('pg') !== '0' && !(Q.get('model') ?? 'phoenix-v2-web.glb').includes('v2');
if (gradeOn) {
  U.uGradeOn.value = 1;
  if (Q.has('pgHue')) U.uHueShift.value = +Q.get('pgHue');
  if (Q.has('pgSat')) U.uSatRed.value = +Q.get('pgSat');
  if (Q.has('pgVal')) U.uValRed.value = +Q.get('pgVal');
  if (Q.has('pgAmber')) U.uValAmber.value = +Q.get('pgAmber');
}
let skinned, skeleton, mixer, shells = [];
// ?model=phoenix-web.glb = the first (Tripo) phoenix. Default: the sculpted v2 (rig built by tools/build-rig-v2.mjs).
const MODEL = Q.get('model') ?? 'phoenix-v2-web.glb';
const isV2 = MODEL.includes('v2');
const gltf = await new Promise((res, rej) => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).load(`/models/${MODEL}`, res, undefined, rej));
scene.add(gltf.scene);
gltf.scene.traverse((o) => { if (o.isSkinnedMesh && !skinned) skinned = o; });
skeleton = skinned.skeleton; skinned.frustumCulled = false;
// plumage (experimental): the phoenix is PAINTED (palette by anatomy + position along the feather), the GLB texture only
// gives the feather-scale pattern. OFF by default: ?pl=1 turns it on. ?trans= ?glow= tune; ?dbg=1..4 shows
// cavity / t / thin / convex.
const plumeOn = Q.get('toy') === '1' && (isV2 ? Q.get('pl') !== '0' : Q.get('pl') === '1');
U.uSunV = { value: new THREE.Vector3(0, 0, 1) };
if (plumeOn) {
  const t0 = performance.now();
  const info = await bakePlumage(skinned, { tau: +(Q.get('tau') ?? 0.04),
    ...(Q.has('eyeL') ? { eyeHalfLen: +Q.get('eyeL') } : {}), ...(Q.has('eyeH') ? { eyeHalfH: +Q.get('eyeH') } : {}),   // ?eyeL= half-length, ?eyeH= half-height, ?eyeT= tilt (deg)
    ...(Q.has('eyeT') ? { eyeTilt: +Q.get('eyeT') } : {}) });
  console.log(`plumage baked in ${Math.round(performance.now() - t0)} ms, cavity mean ${info.cavMean.toFixed(3)}`, JSON.stringify(info));
  U.uPlumeOn.value = 1;
  if (Q.has('trans')) U.uTrans.value = +Q.get('trans');
  if (Q.has('glow')) U.uGlow.value = +Q.get('glow');
  if (Q.has('det')) U.uDetail.value = +Q.get('det');
  if (Q.has('eye')) U.uEye.value = +Q.get('eye');
  if (Q.has('rough')) U.uRough.value = +Q.get('rough');
  if (Q.has('cav')) U.uCavity.value = +Q.get('cav');
  if (Q.has('dbg')) U.uDbg.value = +Q.get('dbg');
  if (!isV2) skinned.material.normalScale.set(1.4, -1.4);          // old flame texture: more feather relief from the normal map
}
// golden rim light: separates the silhouette from any background (strongest when the sun sits behind her)
const rimBase = look.rig ? look.rig.rim : 0.85;
const rimU = { uRim: { value: Q.get('toy') === '1' ? +(Q.get('rim') ?? rimBase) : 0 },
               uRimCol: { value: new THREE.Color(...(look.rig ? look.rig.rimCol : [1.0, 0.74, 0.36])) } };
patchPhoenixMaterial(skinned.material, U, { rim: rimU });
for (let i = 0; i < 3; i++) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...U, uShell: { value: (i + 1) / 4 }, uMap: { value: skinned.material.map } },
    vertexShader: SHELL_VERT, fragmentShader: SHELL_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const m = new THREE.SkinnedMesh(skinned.geometry, mat);
  m.bind(skeleton, skinned.bindMatrix); m.frustumCulled = false; m.renderOrder = 10 + i;
  skinned.parent.add(m); shells.push(m);
}
if (isV2 && !Q.has('fireI')) U.uFire.value = 0.5;
if (isV2 && Q.has('fireI')) U.uFire.value = +Q.get('fireI');
if (isV2 && Q.get('fire') === '0') { shells.forEach((m) => { m.visible = false; }); $('c-fire').checked = false; }   // ?fire=0 hides the flames
if (Q.get('nophoenix') === '1') { gltf.scene.visible = false; shells.forEach((m) => { m.visible = false; }); }
// flame aura (screen-space flames off the silhouette, the Noomo-finale look). ON by default for v2; ?aura=0 off.
// Tune: ?auraI= intensity, ?auraH= flame height (screen fraction), ?auraW= warp, ?auraRim= edge rim, ?auraD= density, ?auraN= steps
let aura = null;
if (Q.get('toy') === '1' && Q.get('aura') !== '0') {
  aura = createFlameAura({ renderer, scene, camera, composer, objects: [skinned], params: {
    intensity: +(Q.get('auraI') ?? 1.0), height: +(Q.get('auraH') ?? 0.36), warp: +(Q.get('auraW') ?? 1.0),
    rim: +(Q.get('auraRim') ?? 0.5), density: +(Q.get('auraD') ?? 1.0), steps: +(Q.get('auraN') ?? 20), debug: +(Q.get('auraDbg') ?? 0) } });
}
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
  renderer.setSize(innerWidth, innerHeight, false); composer.setSize(innerWidth, innerHeight); aura?.setSize(innerWidth, innerHeight);
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
  if (Q.has('camR')) {   // QA close-ups: ?camR=0.6&lx=-0.055&ly=0.26&lz=-0.1&camAz=20 (degrees, 0 = in front of the bird)
    const R = +Q.get('camR'), tx = +(Q.get('lx') ?? 0), ty = +(Q.get('ly') ?? 0), tz = +(Q.get('lz') ?? 0), az = (+(Q.get('camAz') ?? 0) * Math.PI) / 180;
    camera.position.set(tx + Math.sin(az) * R, ty + 0.02, tz - Math.cos(az) * R);
    camera.lookAt(tx, ty, tz);
  } else {
    camera.position.set(Math.sin(pointer.x * 0.05) * 2.5, 0.1 + pointer.y * 0.03, -Math.cos(pointer.x * 0.05) * 2.5);
    camera.lookAt(0.26, -0.03, 0);
  }
  sky.update(st, camera, time);
  toy?.render(time, dt, { x: (pointer.x * 0.5 + 0.5) * innerWidth * 0.5, y: (1 - (pointer.y * 0.5 + 0.5)) * innerHeight * 0.5 });

  // lights follow the sky
  const sunUp = Math.min(1, Math.max(0, (st.elev + 3) / 11));
  sunLight.position.set(st.sunDir[0] * 6, st.sunDir[1] * 6 + 0.5, st.sunDir[2] * 6);
  camera.updateMatrixWorld(); camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  U.uSunV.value.copy(sunLight.position).normalize().transformDirection(camera.matrixWorldInverse);
  sunLight.color.copy(tint(st.eye)); sunLight.intensity = 3.2 * sunUp;
  fill.color.copy(tint(st.amb)); fill.intensity = 0.25 + 1.6 * st.day + 0.9 * st.dawn;
  hemi.color.copy(tint(st.amb)); hemi.intensity = 0.15 + 0.7 * st.day;
  scene.environmentIntensity = 0.18 + 0.5 * st.day;
  renderer.toneMappingExposure = 0.95 - 0.3 * st.day;
  fireA.intensity = (0.5 + Math.sin(time * 11) * 0.1) * (1 - 0.7 * st.day);
  if (toy && look.rig) {                                 // decouple the phoenix's light from the sky's orange
    const g = look.rig;
    const lit = +(Q.get('lit') ?? (gradeOn ? 1.2 : 1));                    // ?lit=1.3 = brighter phoenix, ?lit=0.8 = moodier
    sunLight.color.set(g.key); sunLight.intensity = g.keyI * lit;
    fill.color.set(g.fill); fill.intensity = g.fillI * lit; if (g.fillPos) fill.position.set(...g.fillPos);
    hemi.color.set(g.hemiSky); hemi.groundColor.set(g.hemiGround); hemi.intensity = g.hemiI;
    scene.environmentIntensity = g.env; renderer.toneMappingExposure = g.exposure;
  }

  mixer.update(frozen ? 0 : dt);
  if (frozen && !renderer.__seek) { mixer.setTime(time); renderer.__seek = true; }

  $('mist').style.opacity = String(Math.min(0.92, st.mist * 0.95));
  $('vAlt').textContent = `${Math.round(st.camH)} m`;
  $('hud-alt').textContent = `altitude ${Math.round(st.camH)} m`;
  $('hud-sun').textContent = `sol ${st.elev.toFixed(1)}°`;

  // bloom must only catch the fire at night and the sun by day, never the whole bright sky
  bloom.threshold = 0.9 + 3.4 * Math.min(1, Math.max(0, (st.elev + 4) / 10));
  aura?.update(time);
  composer.render();
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) { $('hud-fps').textContent = `${Math.round(fpsN / fpsAcc)} fps`; fpsAcc = 0; fpsN = 0; }
  window.__sky = { ready: true, st, skinned, skeleton, look, lights: { sunLight, fill, hemi, fireA }, aura,
  bench: (n = 60) => { const gl = renderer.getContext(); gl.finish(); const t0 = performance.now();
    for (let i = 0; i < n; i++) { aura?.update(time); composer.render(); } gl.finish(); return (performance.now() - t0) / n; } };
});

// Dev-only lab: the phoenix flies a demo path over an empty scenery, driven by the SCROLL (scroll back = rewind), or posed by hand.
//   /fenix-flight-lab.html            ?m=lite for the lite model        ?u=0.4 starts at a progress
// Nothing here is stateful: pose = f(progress). Lenis only smooths the scroll like the real page will.
import * as THREE from 'three';
import Lenis from 'lenis';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { createFenixFlight, FOLD, FLIGHT_DEFAULTS } from './beasts/fenix-flight.js';
import { createDemoFlight } from './beasts/flight-demo.js';
import { chaseCamera } from './beasts/flight-path.js';

const Q = new URLSearchParams(location.search);
const variant = Q.get('m') === 'lite' ? 'lite' : 'web';
const $ = (id) => document.getElementById(id);

const renderer = new THREE.WebGLRenderer({ canvas: $('gl'), antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.95;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#0a0807');
scene.fog = new THREE.FogExp2(0x0a0807, 0.016);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.45;
const key = new THREE.DirectionalLight(0xffe1bd, 3.0); key.position.set(-6, 9, 5); scene.add(key);
const rim = new THREE.DirectionalLight(0xffb866, 1.6); rim.position.set(4, 3, -8); scene.add(rim);
scene.add(new THREE.HemisphereLight(0xdfe6ee, 0x3a2418, 0.55));

const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 400);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.08; controls.enabled = false;
function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

// ── the empty scenery: a ground grid and some reference gates so the eye has something to fly past ──
const demo = createDemoFlight();
const ground = new THREE.GridHelper(260, 260, 0x4b3f33, 0x241f1b); scene.add(ground);
{
  // the path itself: a thin line and a marker every 5 % of the progress (the bird flies through none of them: nothing blocks the view)
  const pts = []; for (let i = 0; i <= 300; i++) pts.push(demo.path.at(i / 300).pos.clone());
  scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x6b5a45 })));
  const dot = new THREE.SphereGeometry(0.07, 8, 6), dotMat = new THREE.MeshBasicMaterial({ color: 0xc98a3c });
  for (let i = 0; i <= 20; i++) { const m = new THREE.Mesh(dot, dotMat); m.position.copy(demo.path.at(i / 20).pos); scene.add(m); }
  const post = new THREE.CylinderGeometry(0.04, 0.04, 6, 6), postMat = new THREE.MeshBasicMaterial({ color: 0x3a3029 });
  for (let i = 0; i < 70; i++) {
    const b = demo.path.at(i / 70), side = i % 2 ? 1 : -1, right = new THREE.Vector3().crossVectors(b.fwd, new THREE.Vector3(0, 1, 0)).normalize();
    const m = new THREE.Mesh(post, postMat); m.position.copy(b.pos).addScaledVector(right, side * 9); m.position.y = 3; scene.add(m);
  }
}

// ── the phoenix ──
const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(`/models/fenix-flight-${variant}.glb`);
const model = gltf.scene;
let skinned = null;
model.traverse((o) => {
  if (o.isMesh || o.isSkinnedMesh) { o.frustumCulled = false; if (o.isSkinnedMesh) skinned = o; if (o.material) { o.material.envMap = scene.environment; o.material.envMapIntensity = 0.5; o.material.metalness = 0.4; } }
});
const holder = new THREE.Group();                       // orients and scales the Meshy model (1.7 tall, faces -x) to height 1, facing -z
holder.rotation.y = -Math.PI / 2; holder.scale.setScalar(1 / 1.7); holder.position.y = -0.85 / 1.7;
holder.add(model);
const bird = new THREE.Group(); bird.add(holder); scene.add(bird);
const flight = createFenixFlight(model);
console.log('flight rig:', flight.bones.length, 'bones,', flight.feathers.size, 'feather chains; path', demo.path.length.toFixed(1), 'units');

// ── state: either the timeline (scroll) or hand-set parameters ──
const manual = { ...FLIGHT_DEFAULTS };
let mode = 'scroll', u = +(Q.get('u') ?? 0), autoplay = false, camMode = 'chase', hold = false;     // hold: QA scripts freeze the frame loop
const lenis = new Lenis({ lerp: 0.09 });
const cam = { pos: new THREE.Vector3(), target: new THREE.Vector3() };

function paramsAt(uu) {
  const k = demo.timeline.at(uu), b = demo.path.at(uu);
  return {
    t: uu * demo.seconds, phase: k.beats, flap: k.flap, open: k.open, sweep: k.sweep, legs: k.legs, tail: k.tail, fly: k.fly, stretch: k.stretch,
    bank: b.bank, pitch: b.pitch + k.pitchBias, pitchRate: b.pitchRate * 0.08, yawRate: b.yawRate * 0.08, lookYaw: -b.yawRate * 0.012, lookPitch: 0,
  };
}
function applyU(uu) {
  const P = paramsAt(uu), b = demo.path.at(uu);
  bird.position.copy(b.pos); bird.quaternion.copy(b.quat);
  bird.rotateX(P.pitch - b.pitch);                       // the timeline's body pitch on top of the path's own (nose up to brake, to pull up)
  flight.pose(P);
  return { P, b };
}
function applyManual() {
  bird.position.set(0, 0, 0); bird.quaternion.identity();
  bird.rotation.set(0, 0, 0); bird.rotateX(manual.pitch); bird.rotateZ(-manual.bank);
  flight.pose({ ...manual, t: performance.now() / 1000 });
}

// ── cameras: all of them follow the bird; "free" lets you drag to turn around her while she flies (the wheel keeps scrolling the
// flight), "orbit" circles her by itself (a function of the progress, so scrolling back un-turns it), the rest are fixed views ──
const camCfg = { dist: 3.6, turns: 2.0 };
const V = { up: new THREE.Vector3(0, 1, 0), right: new THREE.Vector3(), tmp: new THREE.Vector3(), last: new THREE.Vector3(), freeInit: false };
controls.enableZoom = false; controls.enablePan = false;               // the wheel scrolls the flight; distance is the slider
function placeCamera(b) {
  camera.up.copy(V.up);
  if (mode === 'manual') { controls.enabled = true; controls.target.copy(bird.position); return; }
  const R = camCfg.dist, k = R / 3.6;
  V.right.crossVectors(b.fwd, V.up).normalize();
  if (camMode === 'free') {
    controls.enabled = true;
    if (!V.freeInit) { V.freeInit = true; camera.position.copy(b.pos).addScaledVector(V.right, R * 0.8).addScaledVector(b.fwd, -R * 0.5).addScaledVector(V.up, R * 0.3); V.last.copy(b.pos); }
    camera.position.add(V.tmp.copy(b.pos).sub(V.last));                 // follow the bird...
    V.last.copy(b.pos); controls.target.copy(b.pos); controls.update(); // ...and keep whatever angle the user dragged to
    V.tmp.copy(camera.position).sub(b.pos).setLength(R); camera.position.copy(b.pos).add(V.tmp);   // distance from the slider
    return;
  }
  V.freeInit = false; controls.enabled = false;
  if (camMode === 'chase') chaseCamera(demo.path, u, { back: 2.4 * k, up: 1.0 * k, side: 2.6 * k }, cam);
  else {
    cam.target.copy(b.pos);
    if (camMode === 'side') cam.pos.copy(b.pos).addScaledVector(V.right, R).addScaledVector(V.up, R * 0.12);
    else if (camMode === 'front') cam.pos.copy(b.pos).addScaledVector(b.fwd, R).addScaledVector(V.up, R * 0.15);
    else if (camMode === 'back') cam.pos.copy(b.pos).addScaledVector(b.fwd, -R).addScaledVector(V.up, R * 0.2);
    else if (camMode === 'top') { cam.pos.copy(b.pos).addScaledVector(V.up, R); camera.up.copy(b.fwd); }
    else if (camMode === 'below') { cam.pos.copy(b.pos).addScaledVector(V.up, -R * 0.8).addScaledVector(b.fwd, -R * 0.3); camera.up.copy(b.fwd); }
    else if (camMode === 'orbit') {                                        // around her, in HER frame: all sides over the flight
      const az = u * camCfg.turns * Math.PI * 2, el = 0.22 + 0.28 * Math.sin(u * Math.PI * 2 * camCfg.turns * 0.5);
      cam.pos.copy(b.pos).addScaledVector(V.right, Math.sin(az) * Math.cos(el) * R).addScaledVector(b.fwd, Math.cos(az) * Math.cos(el) * R).addScaledVector(V.up, Math.sin(el) * R);
    } else { cam.pos.copy(b.pos).add(V.tmp.set(9, 9, 12).multiplyScalar(k)); }                  // wide
  }
  camera.position.copy(cam.pos); camera.lookAt(cam.target);
}

// ── UI ──
const setMode = (m) => {
  mode = m; $('m-scroll').classList.toggle('on', m === 'scroll'); $('m-manual').classList.toggle('on', m === 'manual');
  $('manual').hidden = m !== 'manual'; $('spacer').style.display = m === 'manual' ? 'none' : '';
  if (m === 'manual') { camera.position.set(2.6, 0.9, 3.4); controls.target.set(0, 0, 0); controls.enabled = true; }
};
$('m-scroll').onclick = () => setMode('scroll'); $('m-manual').onclick = () => setMode('manual');
$('cam').onchange = (e) => { camMode = e.target.value; V.freeInit = false; };
const bindR = (id, fn) => { const el = $(id), o = $('o-' + id); const f = () => { o.textContent = (+el.value).toFixed(1); fn(+el.value); }; el.oninput = f; f(); };
bindR('dist', (v) => { camCfg.dist = v; }); bindR('turns', (v) => { camCfg.turns = v; });
let playSeconds = 60; $('dur').onchange = (e) => { playSeconds = +e.target.value; };
const toggleUI = () => { for (const id of ['panel', 'hud', 'hint']) { const el = $(id); el.style.display = el.style.display === 'none' ? '' : 'none'; } };
$('hideui').onclick = toggleUI;
if (Q.get('ui') === '0') toggleUI();
$('play').onclick = () => { autoplay = !autoplay; $('play').classList.toggle('on', autoplay); };
$('u').oninput = (e) => { u = +e.target.value; autoplay = false; $('play').classList.remove('on'); scrollTo(0, u * (document.documentElement.scrollHeight - innerHeight)); lenis.scrollTo(u * lenis.limit, { immediate: true }); };
document.querySelectorAll('input[data-p]').forEach((el) => {
  const out = el.parentElement.querySelector('output'), fmt = () => { out.textContent = (+el.value).toFixed(2); };
  el.oninput = () => { manual[el.dataset.p] = +el.value; fmt(); }; manual[el.dataset.p] = +el.value; fmt();
});
document.querySelectorAll('input[data-f]').forEach((el) => {
  const out = el.parentElement.querySelector('output'), fmt = () => { out.textContent = (+el.value).toFixed(2); };
  el.oninput = () => { flight.fold[el.dataset.f] = +el.value; fmt(); }; fmt();
});
addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); $('play').click(); }
  if (e.code === 'KeyH') toggleUI();
  const cams = ['chase', 'side', 'front', 'back', 'top', 'below', 'orbit', 'free', 'wide'];
  if (/^Digit[1-9]$/.test(e.code)) { camMode = cams[+e.code.slice(5) - 1]; $('cam').value = camMode; V.freeInit = false; }
});

function hud(P, b) {
  $('hud').textContent = `u ${u.toFixed(3)}  pos ${b.pos.x.toFixed(1)}, ${b.pos.y.toFixed(1)}, ${b.pos.z.toFixed(1)}
open ${P.open.toFixed(2)}  flap ${P.flap.toFixed(2)}  legs ${P.legs.toFixed(2)}
bank ${(b.bank * 57.3).toFixed(0)}°  pitch ${(b.pitch * 57.3).toFixed(0)}°`;
}

// ── frame ──
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  lenis.raf(now);
  if (hold) { renderer.render(scene, camera); requestAnimationFrame(frame); return; }
  if (mode === 'scroll') {
    if (autoplay) { u = Math.min(1, u + dt / playSeconds); if (u >= 1) autoplay = false; lenis.scrollTo(u * lenis.limit, { immediate: true }); }
    else u = Math.min(1, Math.max(0, lenis.limit ? lenis.scroll / lenis.limit : 0));
    $('u').value = u; $('o-u').textContent = u.toFixed(3);
    const { P, b } = applyU(u); placeCamera(b); hud(P, b);
  } else { applyManual(); placeCamera(null); controls.update(); $('hud').textContent = ''; }
  if (controls.enabled) controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
setMode('scroll');
if (Q.has('u')) lenis.scrollTo(u * lenis.limit, { immediate: true });
requestAnimationFrame(frame);

// QA hooks (headless scripts)
window.__lab = {
  THREE, scene, camera, bird, flight, demo, skinned, manual,
  setU(uu) { hold = true; mode = 'scroll'; autoplay = false; u = uu; const r = applyU(uu); placeCamera(r.b); hud(r.P, r.b); renderer.render(scene, camera); return r; },
  setManual(p, cam) { hold = true; setMode('manual'); Object.assign(manual, p); applyManual(); if (cam) { camera.position.set(...cam.pos); controls.target.set(...(cam.target ?? [0, 0, 0])); camera.lookAt(controls.target); controls.enabled = false; } renderer.render(scene, camera); },
  setCamMode(m) { camMode = m; V.freeInit = false; },
  setDist(d) { camCfg.dist = d; },
  render() { renderer.render(scene, camera); },
  ready: true,
};

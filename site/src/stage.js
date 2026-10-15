// WebGL stage of the hero: the Shadertoy dusk sky, one fused post chain (bloom + ACES), a quality governor.
//
// The first phoenix was taken OUT on 15/10/2026. The opening scene will hold a NEW phoenix, made in the look of the dragon
// (model/dragon: a baked PBR texture used as it comes, no procedural colour), and the dragon and the other beasts come in
// later scenes. So the procedural-plumage phoenix (rig pipeline, flame shells, wing flight) went away and only the sky stays.
// What is left is the stage they will be placed on: renderer, sky, the approved light rig, the post chain, the governor, the
// QA hooks. (HANDOFF.md says how to get the old phoenix back from git.)
//
// To put a creature on it:  stage.scene.add(mesh)  after load(). Give it layer 1 (LAYER_SILHOUETTE) to feed the flame aura
// and switch the aura on with  stage.post.aura.enabled = true  (hero-post.js documents the passes).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { createHeroPost } from './hero-post.js';
import { createToySky } from './toy-sky.js';
import toySource from './toy/sky.glsl?raw';
import { LOOKS } from './looks.js';

const LOOK = LOOKS.golden;                 // the approved sky grade + lighting rig (see looks.js)
const RIG = LOOK.rig;
const SUN_POS = new THREE.Vector3(-0.84, 0.8, 5.93);   // behind the subject, slightly left (where the sky's sun sits)
const AURA_I = 0.6;                        // flame aura strength; on the bright sky the flames COVER it instead of adding
const AURA_RIM = 0.8;
const YAW_WIDE = -0.54;                    // sky yaw that puts the sun behind the subject on wide screens (the approved one)
const YAW_PORTRAIT = -0.95;               // ... and on portrait: the sun leaves the text area, the horizon glow wraps the subject

// Quality tiers, cheapest-to-hide first. Tier 0 is the approved look, untouched; the governor (below) only leaves it when the
// real frame time says the machine cannot hold ~60 fps, and walks back up when there is headroom.
//   scale     internal resolution (the canvas is upscaled by the browser; the DOM text stays sharp)
//   skyEvery  the sky shader (slow clouds, static camera) re-renders every N frames
//   steps     samples of the flame-aura walk;  mips  bloom mip levels
const TIERS = [
  { scale: 1.00, skyEvery: 1, steps: 20, mips: 5 },
  { scale: 1.00, skyEvery: 2, steps: 20, mips: 5 },
  { scale: 0.90, skyEvery: 2, steps: 16, mips: 5 },
  { scale: 0.80, skyEvery: 2, steps: 14, mips: 4 },
  { scale: 0.70, skyEvery: 3, steps: 12, mips: 4 },
  { scale: 0.60, skyEvery: 3, steps: 10, mips: 3 },
];

export function createStage({ canvas, lite, reduced }) {
  const Q = new URLSearchParams(location.search);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  const basePR = Math.min(devicePixelRatio, lite ? 1.5 : 1.75);
  renderer.setPixelRatio(basePR);
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = RIG.exposure;

  const scene = new THREE.Scene();
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = RIG.env;
  const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.05, 40);

  // ───────── sky: the Shadertoy shader into a half-res target, drawn as the scene background ─────────
  const sky = createToySky({ source: toySource, scale: lite ? 0.4 : 0.5, gamma: true, renderer, defines: { ...LOOK.defines, CAM_YAW: 'uYaw', CAM_PITCH: 'uPitch' }, sat: LOOK.sat });   // yaw is a uniform: the sun follows the subject as the aspect changes
  // ?sky=0 (the default while the phoenix is being studied): no sky shader, a neutral flat background (?bg=rrggbb to change it);
  // ?sky=1 brings the dusk sky back. The sky is not even rendered when it is off.
  const SKY = Q.get('sky') === '1';
  if (SKY) scene.add(sky.mesh); else scene.background = new THREE.Color('#' + (Q.get('bg') ?? '000000'));
  sky.resize(innerWidth, innerHeight, renderer.getPixelRatio());

  // ───────── lights (for the creatures to come): key from front-left-above carves the body, the sun behind is only a rim ─────────
  const sun = new THREE.DirectionalLight(RIG.key, RIG.keyI); sun.position.copy(SUN_POS);
  const fill = new THREE.DirectionalLight(RIG.fill, RIG.fillI); fill.position.set(...RIG.fillPos);
  const hemi = new THREE.HemisphereLight(RIG.hemiSky, RIG.hemiGround, RIG.hemiI);
  scene.add(sun, fill, hemi, fill.target);

  // ───────── post (hero-post.js): scene at full res, aura + bloom at half res, ONE full-res pass to the canvas.
  // Always on (the sky is tuned for ACES in the final pass); bloom only on full quality; the aura waits for a creature.
  const post = createHeroPost({ renderer, scene, camera, aura: false, bloom: !lite, params: {
    intensity: AURA_I, rim: AURA_RIM, height: 0.36, opaque: 1.0,
    bloomStrength: 0.35, bloomRadius: 0.5, bloomThreshold: 3.2 } });   // threshold: only the sun (and fire, later) bloom

  let loaded = false;

  /** Nothing to download any more: compile every program against the real targets and draw one warm-up frame, so the first
   *  frame the user sees is the finished sky (main.js starts the ticker only after this resolves; there is no cover). */
  async function load(onProgress) {
    if (Q.has('q')) setTier(+Q.get('q'));                       // QA: pin a quality tier
    await post.compile();
    post.render(0);
    onProgress?.(1);
    loaded = true;
  }

  // ───────── quality governor ─────────
  // Measures the real interval between frames (rAF, vsync included) over 0.5 s windows. Two bad windows in a row step one
  // tier down; ten good ones step one up, and a step up that goes bad inside its probe window backs off exponentially, so it
  // never oscillates. ?q=N pins a tier, ?gov=0 pins tier 0; QA runs (?qa) are pinned too, they must be deterministic.
  const gov = { tier: 0, pinned: Q.has('q') || Q.get('gov') === '0' || (Q.has('qa') && Q.get('gov') !== '1'),
    skyEvery: 1, sum: 0, n: 0, winStart: 0, last: 0, bad: 0, good: 0, warmUntil: 0, nextUp: 0, backoff: 8000, probeUntil: 0 };
  let curScale = 1;
  function setTier(i) {
    const t = TIERS[(gov.tier = Math.max(0, Math.min(TIERS.length - 1, i)))];
    gov.skyEvery = t.skyEvery;
    post.aura.uniforms.uSteps.value = t.steps;
    post.bloom.mips = t.mips;
    if (t.scale !== curScale) { curScale = t.scale; renderer.setPixelRatio(basePR * t.scale); resize(); }
  }
  function govern(now) {
    if (gov.pinned || !loaded) return;
    if (gov.last) { const d = now - gov.last; if (d < 400) { gov.sum += d; gov.n++; } }     // hitches / hidden tabs are not "slow"
    gov.last = now;
    if (!gov.winStart) { gov.winStart = now; gov.warmUntil = now + 2500; return; }
    if (now - gov.winStart < 500) return;
    const avg = gov.n ? gov.sum / gov.n : 0;
    gov.sum = 0; gov.n = 0; gov.winStart = now;
    if (!avg || now < gov.warmUntil) return;
    if (avg > 21) { gov.bad++; gov.good = 0; } else if (avg < 17.8) { gov.good++; gov.bad = 0; } else { gov.bad = 0; gov.good = Math.max(0, gov.good - 1); }
    if (gov.bad >= 2 && gov.tier < TIERS.length - 1) {
      if (now < gov.probeUntil) { gov.backoff = Math.min(gov.backoff * 2, 120000); gov.nextUp = now + gov.backoff; }   // the step up failed
      setTier(gov.tier + 1); gov.bad = 0; gov.warmUntil = now + 1500;
    } else if (gov.good >= 10 && gov.tier > 0 && now > gov.nextUp) {
      setTier(gov.tier - 1); gov.good = 0; gov.warmUntil = now + 1500; gov.probeUntil = now + 5000;
    }
  }

  // ───────── per-frame ─────────
  const camTarget = new THREE.Vector3();
  let time = 0, skyAge = 1e9;

  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    sky.resize(w, h, renderer.getPixelRatio());
    post.setSize();
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();

  /** S: view state (camera framing + QA overrides). pointer: -1..1. */
  function frame(dt, S, pointer) {
    if (S.t != null) time = S.t;                            // QA: a frozen clock makes screenshots deterministic (diffable)
    else if (!reduced) time += dt;
    // the sun must sit behind the subject: wide screens keep the approved yaw, portrait screens swing it to the centre
    const tl = THREE.MathUtils.smoothstep(camera.aspect, 0.9, 1.5);
    const yaw = S.skyYaw ?? (YAW_PORTRAIT + (YAW_WIDE - YAW_PORTRAIT) * tl), pitch = S.skyPitch ?? 0;
    const skyDue = yaw !== sky.uniforms.uYaw.value || pitch !== sky.uniforms.uPitch.value || skyAge >= gov.skyEvery;
    sky.uniforms.uYaw.value = yaw;
    sky.uniforms.uPitch.value = pitch;
    if (!SKY) { /* flat background: nothing to render */ }
    else if (skyDue) { sky.render(time, dt); skyAge = 1; } else skyAge++;      // slow clouds + a still camera: skip frames when asked
    govern(performance.now());

    // camera: framed so the subject sits right of the copy on wide screens, low and farther on portrait screens
    const wide = camera.aspect > 1.1;
    const r = (S.camR ?? 2.8) + (wide ? 0 : (S.camPushP ?? 1.45)), ang = (S.orbit ?? 0) + pointer.x * 0.05;
    camTarget.set(wide ? (S.camX ?? 0.42) : 0, (S.camY ?? 0.1) * 0.4 + (wide ? (S.camLook ?? 0.03) : (S.camLookP ?? 0.42)), 0);
    camera.position.set(Math.sin(ang) * r + camTarget.x, (S.camY ?? 0.1) + pointer.y * 0.03, -Math.cos(ang) * r);
    camera.lookAt(camTarget);
    if (S.cam) { camera.position.copy(S.cam.pos); camera.lookAt(S.cam.target); }          // free camera (flight tests)
    camera.updateMatrixWorld();

    if (loaded) {
      post.aura.uniforms.uIntensity.value = (S.auraI ?? AURA_I) * api.fireGain;      // a creature's beat modulates it (fireGain)
      post.aura.compUniforms.uRim.value = S.auraRim ?? AURA_RIM;
      post.aura.compUniforms.uOpaque.value = S.auraOpaque ?? 1;
    }
    post.render(time);                                      // after the camera moved: the aura mask must match this frame
  }

  const quality = { get tier() { return gov.tier; }, setTier, TIERS, gov };
  const api = { renderer, scene, camera, frame, resize, load, post, quality, bloom: post.bloom, sky, sun, fill, hemi,
                fireGain: 1,
                get aura() { return post.aura; }, get loaded() { return loaded; } };
  return api;
}

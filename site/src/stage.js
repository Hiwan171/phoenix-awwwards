// WebGL stage of the hero: the Shadertoy dusk sky, the phoenix (rigged + painted), flame shells, the flame aura, post.
// createStage() is synchronous and cheap (renderer, sky, lights): the sky exists at once. stage.load() streams in the
// rigged GLB, bakes the plumage and compiles every program, so the first visible frame is already the final look.
// (The old ember/ash/dissolve intro was archived in site/_archive/intro-ember: the opening is being redesigned.)
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { makeUniforms, SHELL_VERT, SHELL_FRAG } from './shaders.js';
import { patchPhoenixMaterial } from './phoenix-material.js';
import { bakePlumage } from './plumage.js';
import { createFlameAura } from './flame-aura.js';
import { createToySky } from './toy-sky.js';
import toySource from './toy/sky.glsl?raw';
import { LOOKS } from './looks.js';

const LOOK = LOOKS.golden;                 // the approved sky grade + phoenix lighting rig (see looks.js)
const RIG = LOOK.rig;
const SUN_POS = new THREE.Vector3(-0.84, 0.8, 5.93);   // behind her, slightly left (where the sky's sun sits)
const AURA_I = 0.6;                        // flame aura strength; on the bright sky the flames COVER it instead of adding
const AURA_RIM = 0.8;
const YAW_WIDE = -0.54;                    // sky yaw that puts the sun behind her on wide screens (the approved one)
const YAW_PORTRAIT = -0.95;               // ... and on portrait: the sun leaves the text area, the horizon glow wraps her

export function createStage({ canvas, lite, reduced }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, lite ? 1.5 : 1.75));
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = RIG.exposure;

  const scene = new THREE.Scene();
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = RIG.env;
  const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.05, 40);

  // ───────── sky: the Shadertoy shader into a half-res target, drawn as the scene background ─────────
  const sky = createToySky({ source: toySource, scale: lite ? 0.4 : 0.5, gamma: true, renderer, defines: { ...LOOK.defines, CAM_YAW: 'uYaw', CAM_PITCH: 'uPitch' }, sat: LOOK.sat });   // yaw is a uniform: the sun follows the phoenix as the aspect changes
  scene.add(sky.mesh);
  sky.resize(innerWidth, innerHeight, renderer.getPixelRatio());

  // ───────── lights: key from front-left-above carves the body, the sun behind is only a rim ─────────
  const sun = new THREE.DirectionalLight(RIG.key, RIG.keyI); sun.position.copy(SUN_POS);
  const fill = new THREE.DirectionalLight(RIG.fill, RIG.fillI); fill.position.set(...RIG.fillPos);
  const hemi = new THREE.HemisphereLight(RIG.hemiSky, RIG.hemiGround, RIG.hemiI);
  scene.add(sun, fill, hemi, fill.target);
  const fillLocal = new THREE.Vector3(...RIG.fillPos).applyQuaternion(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI).invert());   // fill offset in the camera's own frame (default camera looks +z)

  const U = makeUniforms();
  U.uSunV = { value: SUN_POS.clone().normalize() };          // direction TOWARD the back light, in VIEW space (updated per frame)
  U.uFire.value = 0.5;                                       // flames of the shells (the 1.5 preset belonged to the first phoenix)
  U.uReveal.value = 1; U.uIgnite.value = 1;                  // no dissolve-in any more: always fully there, always lit
  const SUN_DIR = SUN_POS.clone().normalize();

  // ───────── post: composer always (the sky is tuned for ACES in the OutputPass); bloom + aura only on full quality ─────────
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  let bloom = null;
  if (!lite) {
    bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.35, 0.5, 3.2);   // threshold: only the sun and fire bloom
    composer.addPass(bloom);
  }
  composer.addPass(new OutputPass());

  // ───────── rigged GLB: filled in by load() ─────────
  let loaded = false;
  let skinned = null, skeleton = null, mixer = null, clips = null, neck = [], root = null, bones = {};
  let aura = null;
  const shells = [];
  const look = { x: 0, y: 0 };

  async function load(onProgress) {
    const gltf = await new Promise((res, rej) =>
      new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).load(
        lite ? '/models/phoenix-v2-lite.glb' : '/models/phoenix-v2-web.glb',
        res,
        (e) => onProgress?.(e.lengthComputable ? e.loaded / e.total : -1),
        rej));
    scene.add(gltf.scene);
    root = gltf.scene;
    gltf.scene.traverse((o) => { if (o.isSkinnedMesh && !skinned) skinned = o; });
    skeleton = skinned.skeleton;
    for (const b of skeleton.bones) bones[b.name] = b;
    skinned.frustumCulled = false;

    // paint her: per-vertex anatomy / feather / eye data (yields between steps), then the shared material patch
    await bakePlumage(skinned);
    U.uPlumeOn.value = 1;
    const rimU = { uRim: { value: RIG.rim }, uRimCol: { value: new THREE.Color(...RIG.rimCol) } };
    patchPhoenixMaterial(skinned.material, U, { rim: rimU });

    // flame shells: thin flames leaving the upward-facing skin and the silhouette
    const SHELLS = lite ? 2 : 3;
    for (let i = 0; i < SHELLS; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { ...U, uShell: { value: (i + 1) / (SHELLS + 1) }, uMap: { value: skinned.material.map } },
        vertexShader: SHELL_VERT, fragmentShader: SHELL_FRAG,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const m = new THREE.SkinnedMesh(skinned.geometry, mat);
      m.bind(skeleton, skinned.bindMatrix);
      m.frustumCulled = false;
      m.renderOrder = 10 + i;
      skinned.parent.add(m);
      shells.push(m);
    }

    // flame aura (screen-space tongues off her silhouette): full-quality devices only
    if (!lite) {
      aura = createFlameAura({ renderer, scene, camera, composer, objects: [skinned], params: { intensity: AURA_I, rim: AURA_RIM, height: 0.36, opaque: 1.0 } });
    }

    // animation (rig)
    mixer = new THREE.AnimationMixer(gltf.scene);
    clips = Object.fromEntries(gltf.animations.map((c) => [c.name, mixer.clipAction(c)]));
    clips.Idle.play().setEffectiveWeight(0);
    clips.Hover.play().setEffectiveWeight(1);
    const bone = (n) => skeleton.bones.find((b) => b.name === n);
    neck = [bone('Neck1'), bone('Neck2'), bone('Head')];

    // compile every program now, behind the loader, not on the first visible frame
    try { await renderer.compileAsync(scene, camera); } catch { /* the first draw compiles instead */ }
    loaded = true;
  }

  // ───────── per-frame ─────────
  const camTarget = new THREE.Vector3();
  const qTmp = new THREE.Quaternion(), eTmp = new THREE.Euler();
  let time = 0;

  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    sky.resize(w, h, renderer.getPixelRatio());
    aura?.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();

  /** S: view state (camera framing + QA overrides). pointer: -1..1. */
  function frame(dt, S, pointer) {
    if (!reduced) time += dt;
    U.uTime.value = time;
    // the sun must sit behind her: wide screens keep the approved yaw, portrait screens swing it to the centre
    const asp = camera.aspect;
    const tl = THREE.MathUtils.smoothstep(asp, 0.9, 1.5);
    sky.uniforms.uYaw.value = S.skyYaw ?? (YAW_PORTRAIT + (YAW_WIDE - YAW_PORTRAIT) * tl);
    sky.uniforms.uPitch.value = S.skyPitch ?? 0;
    sky.render(time, dt);

    if (loaded) {
      clips.Hover.setEffectiveWeight(S.hover ?? 1);
      clips.Idle.setEffectiveWeight(1 - (S.hover ?? 1));
      mixer.update(reduced ? 0 : dt);
      if (S.bird) { root.position.copy(S.bird.pos); root.quaternion.copy(S.bird.quat); }   // the flight controller drives the whole body
      S.pose?.(bones, dt);                                                                  // ... and the wings/neck, AFTER the clips

      // she looks toward the cursor (uses the rig: Neck1/Neck2/Head)
      const k = 1 - Math.pow(0.0015, dt);
      look.x += (pointer.x * 0.35 - look.x) * k;
      look.y += (pointer.y * 0.18 - look.y) * k;
      const share = [0.25, 0.35, 0.4];
      neck.forEach((b, i) => {
        if (!b) return;
        eTmp.set(-look.y * share[i], -look.x * share[i], 0);
        b.quaternion.multiply(qTmp.setFromEuler(eTmp));
      });
    }

    // camera: framed so the phoenix sits right of the copy on wide screens, low and farther on portrait screens
    const wide = camera.aspect > 1.1;
    const r = (S.camR ?? 2.8) + (wide ? 0 : (S.camPushP ?? 1.45)), ang = (S.orbit ?? 0) + pointer.x * 0.05;
    camTarget.set(wide ? (S.camX ?? 0.42) : 0, (S.camY ?? 0.1) * 0.4 + (wide ? (S.camLook ?? 0.03) : (S.camLookP ?? 0.42)), 0);
    camera.position.set(Math.sin(ang) * r + camTarget.x, (S.camY ?? 0.1) + pointer.y * 0.03, -Math.cos(ang) * r);
    camera.lookAt(camTarget);
    if (S.cam) { camera.position.copy(S.cam.pos); camera.lookAt(S.cam.target); }          // flight test: free camera
    camera.updateMatrixWorld();
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    U.uSunV.value.copy(SUN_DIR).transformDirection(camera.matrixWorldInverse);
    if (S.bird) {                                           // key light: same direction relative to the CAMERA, centred on her
      fill.position.copy(fillLocal).applyQuaternion(camera.quaternion).add(S.bird.pos);
      fill.target.position.copy(S.bird.pos); fill.target.updateMatrixWorld();
    }

    if (aura && loaded) {
      aura.uniforms.uIntensity.value = S.auraI ?? AURA_I;
      aura.compUniforms.uRim.value = S.auraRim ?? AURA_RIM;
      aura.compUniforms.uOpaque.value = S.auraOpaque ?? 1;
      aura.update(time);                                    // after the camera moved: the mask must match this frame
    }
    composer.render();
  }

  return { renderer, scene, camera, frame, resize, load, U, bloom, sky, sun, fill, hemi, get aura() { return aura; }, get loaded() { return loaded; },
           get root() { return root; }, get bones() { return bones; }, get clips() { return clips; } };
}

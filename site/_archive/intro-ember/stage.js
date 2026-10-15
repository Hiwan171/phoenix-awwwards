// WebGL stage: phoenix (skinned, rigged), ash particles, flame shells, camera, post.
// createStage() is synchronous and cheap: the void, the ember and the ash cloud exist immediately, so the
// loader can be drawn *in* the scene. stage.load() then streams in the rigged GLB.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { makeUniforms, SHELL_VERT, SHELL_FRAG, ASH_VERT, ASH_FRAG, EMBER_VERT, EMBER_FRAG } from './shaders.js';
import { patchPhoenixMaterial } from './phoenix-material.js';
import { bakePlumage } from './plumage.js';
import { createFlameAura } from './flame-aura.js';

const VOID = 0x070504;

// sRGB palette stops of the plumage ramp (same as PLUMAGE_GLSL.plumeRamp): used to tint the ash so it "remembers" her colour
const RAMP = [[43, 12, 8], [122, 20, 9], [184, 42, 12], [229, 82, 15], [245, 138, 22], [252, 185, 44], [255, 224, 102], [255, 244, 192]];
function rampLinear(u, out, o) {
  const x = Math.min(1, Math.max(0, u)) * 7, i = Math.min(6, x | 0), f = x - i;
  for (let c = 0; c < 3; c++) out[o + c] = Math.pow((RAMP[i][c] + (RAMP[i + 1][c] - RAMP[i][c]) * f) / 255, 2.2);
}

const AURA_I = 0.46;                                          // flame aura strength at full ignition
const AURA_RIM = 1.05;                                        // bright contour on her own silhouette

export function createStage({ canvas, lite, reduced }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  const dprCap = lite ? 1.5 : 1.75;
  renderer.setPixelRatio(Math.min(devicePixelRatio, dprCap));
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(VOID);
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.3;                       // painted plumage + a near-black void: keep the ambient low so shadows stay deep
  // key (front-left-above, neutral warm) models the body, the orange rim from behind carves the silhouette
  const key = new THREE.DirectionalLight(0xffe9cf, 3.0); key.position.set(-2.6, 1.6, -1.2);
  const rim = new THREE.DirectionalLight(0xff6a30, 1.6); rim.position.set(1.2, 0.6, 2.8);
  scene.add(key, rim);

  const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.05, 40);
  const U = makeUniforms();

  // post: only bloom (approved 0.46); skipped on lite devices
  let composer = null, bloom = null;
  if (!lite) {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.46, 0.4, 0.9);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
  }

  // ───────── ash: scattered cloud now, glued to the phoenix surface once the GLB has arrived ─────────
  const ashCount = lite ? 16000 : 42000;
  const aTarget = new Float32Array(ashCount * 3), aColor = new Float32Array(ashCount * 3), aRand = new Float32Array(ashCount * 4);
  for (let i = 0; i < ashCount; i++) {
    aColor.set([0.8, 0.25, 0.08], i * 3);
    aRand.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
  }
  const ashGeo = new THREE.BufferGeometry();
  ashGeo.setAttribute('position', new THREE.BufferAttribute(aTarget.slice(), 3));   // draw count only; the shader reads aTarget
  ashGeo.setAttribute('aTarget', new THREE.BufferAttribute(aTarget, 3));
  ashGeo.setAttribute('aColor', new THREE.BufferAttribute(aColor, 3));
  ashGeo.setAttribute('aRand', new THREE.BufferAttribute(aRand, 4));
  const ashU = {
    uTime: U.uTime, uForm: { value: 0 }, uFade: { value: 1 }, uSize: { value: 0.0038 },
    uScale: { value: 1 }, uBreath: { value: reduced ? 0 : 1 }, uBirth: { value: 0 },
  };
  const ash = new THREE.Points(ashGeo, new THREE.ShaderMaterial({
    uniforms: ashU, vertexShader: ASH_VERT, fragmentShader: ASH_FRAG,
    transparent: true, depthWrite: false, blending: THREE.NormalBlending,
  }));
  ash.frustumCulled = false;
  ash.renderOrder = 5;
  scene.add(ash);

  // ───────── the ember: the seed of the whole scene, at the origin where she will take form ─────────
  const emberU = { uTime: U.uTime, uScale: ashU.uScale, uSize: { value: 0.13 }, uFlare: { value: 0 }, uAlpha: { value: 1 } };
  const emberGeo = new THREE.BufferGeometry();
  emberGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
  const ember = new THREE.Points(emberGeo, new THREE.ShaderMaterial({
    uniforms: emberU, vertexShader: EMBER_VERT, fragmentShader: EMBER_FRAG,
    transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  ember.frustumCulled = false;
  ember.renderOrder = 6;
  scene.add(ember);

  // ───────── rigged GLB: filled in by load() ─────────
  let loaded = false;
  let skinned = null, skeleton = null, mixer = null, clips = null, neck = [];
  const shells = [];
  let aura = null;
  const look = { x: 0, y: 0 };
  U.uSunV = { value: new THREE.Vector3(0, 0.15, 1).normalize() };   // direction TOWARD the back light, world space (made view-space per frame)
  U.uFire.value = 0.55;                                      // the first phoenix's preset (1.5) was tuned for a flame texture; the plumage is already coloured
  const BACK_LIGHT = new THREE.Vector3(0, 0.15, 1).normalize();

  async function load(onProgress) {
    const gltf = await new Promise((res, rej) =>
      new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).load(
        lite ? '/models/phoenix-v2-lite.glb' : '/models/phoenix-v2-web.glb',
        res,
        (e) => onProgress?.(e.lengthComputable ? e.loaded / e.total : -1),
        rej));
    scene.add(gltf.scene);
    gltf.scene.traverse((o) => { if (o.isSkinnedMesh && !skinned) skinned = o; });
    skeleton = skinned.skeleton;
    skinned.frustumCulled = false;
    skinned.visible = false;                                  // hidden until the reveal starts
    // paint her: per-vertex anatomy/feather/eye data, then the shared material patch (+ the dissolve-in for the intro)
    await bakePlumage(skinned);
    U.uPlumeOn.value = 1;
    patchPhoenixMaterial(skinned.material, U, { reveal: true });

    scene.updateMatrixWorld(true);
    skeleton.update();

    // sample the rest-pose surface: the ash "remembers" the phoenix (position AND her plumage colour)
    const geo = skinned.geometry;
    const nV = geo.attributes.position.count;
    const aW0 = geo.attributes.aW0, aW1 = geo.attributes.aW1;
    const v = new THREE.Vector3();
    for (let i = 0; i < ashCount; i++) {
      const idx = (Math.random() * nV) | 0;
      skinned.getVertexPosition(idx, v);
      v.applyMatrix4(skinned.matrixWorld);
      aTarget.set([v.x, v.y, v.z], i * 3);
      const t = aW1.getW(idx), crest = aW0.getW(idx), head = aW0.getY(idx);
      rampLinear(0.30 + 0.34 * t + 0.20 * crest + 0.10 * head + (Math.random() - 0.5) * 0.08, aColor, i * 3);
    }
    ashGeo.attributes.aTarget.needsUpdate = true;
    ashGeo.attributes.aColor.needsUpdate = true;

    // flame shells (approved preset: 3 layers)
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
      m.visible = false;
      skinned.parent.add(m);
      shells.push(m);
    }

    // flame aura (screen-space tongues off her silhouette): full-quality devices only, rises with the ignition
    if (composer) {
      aura = createFlameAura({ renderer, scene, camera, composer, objects: [skinned], params: { intensity: 0, rim: 0, height: 0.36 } });
      aura.enabled = false;
    }

    // animation (rig): Idle blends in once she has materialised
    mixer = new THREE.AnimationMixer(gltf.scene);
    clips = Object.fromEntries(gltf.animations.map((c) => [c.name, mixer.clipAction(c)]));
    clips.Idle.play().setEffectiveWeight(0);
    clips.Hover.play().setEffectiveWeight(0);
    const bone = (n) => skeleton.bones.find((b) => b.name === n);
    neck = [bone('Neck1'), bone('Neck2'), bone('Head')];

    // compile the skinned + shell programs now, while the ember is still on screen, not on the frame the fire catches
    try { await renderer.compileAsync(scene, camera); } catch { /* first draw will compile instead */ }
    loaded = true;
  }

  // ───────── per-frame ─────────
  const camTarget = new THREE.Vector3();
  const qTmp = new THREE.Quaternion(), eTmp = new THREE.Euler();
  let time = 0;

  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    composer?.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();

  /** S: intro-driven state. pointer: -1..1. */
  function frame(dt, S, pointer) {
    if (!reduced) time += dt;
    U.uTime.value = time;
    ashU.uForm.value = S.form;
    ashU.uFade.value = S.ashFade;
    ashU.uBirth.value = S.birth;
    ashU.uScale.value = renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    emberU.uAlpha.value = S.ember;
    emberU.uFlare.value = S.flare;
    ember.visible = S.ember > 0.004;
    ash.visible = S.ashFade > 0.01 && S.birth > 0.002;

    if (loaded) {
      U.uReveal.value = S.reveal;
      U.uIgnite.value = S.ignite;
      U.uSunV.value.copy(BACK_LIGHT).transformDirection(camera.matrixWorldInverse);
      if (aura) {
        const g = THREE.MathUtils.smoothstep(S.ignite, 0.05, 1.0);
        aura.enabled = g > 0.003;
        aura.uniforms.uIntensity.value = g * (S.auraI ?? AURA_I);
        aura.compUniforms.uRim.value = g * (S.auraRim ?? AURA_RIM);
      }
      skinned.visible = S.reveal > 0.002;
      const lit = S.ignite > 0.01;
      shells.forEach((s) => { s.visible = lit; });

      clips.Idle.setEffectiveWeight(S.idle * (1 - S.hover));
      clips.Hover.setEffectiveWeight(S.idle * S.hover);
      mixer.update(reduced ? 0 : dt);

      // she looks toward the cursor, easing in with the materialisation (uses the rig: Neck1/Neck2/Head)
      const k = 1 - Math.pow(0.0015, dt);
      look.x += (pointer.x * 0.35 * S.idle - look.x) * k;
      look.y += (pointer.y * 0.18 * S.idle - look.y) * k;
      const share = [0.25, 0.35, 0.4];
      neck.forEach((b, i) => {
        if (!b) return;
        eTmp.set(-look.y * share[i], -look.x * share[i], 0);
        b.quaternion.multiply(qTmp.setFromEuler(eTmp));
      });
    }
    if (bloom) bloom.strength = 0.46 + S.bloom;

    // camera: slow push-in + orbit, offset so the phoenix sits right of the copy on wide screens
    const wide = camera.aspect > 1.1;
    const r = S.camR + S.dolly + S.punch + (wide ? 0 : (S.camPushP ?? 1.45)), ang = S.orbit + pointer.x * 0.05;
    // portrait: farther and framed in the lower half, so the title (top) never sits on her wings
    camTarget.set(wide ? (S.camX ?? 0.42) : 0, S.camY * 0.4 + (wide ? (S.camLook ?? 0.03) : (S.camLookP ?? 0.42)), 0);
    camera.position.set(Math.sin(ang) * r + camTarget.x, S.camY + pointer.y * 0.03, -Math.cos(ang) * r);
    camera.lookAt(camTarget);

    if (aura && loaded) { camera.updateMatrixWorld(); aura.update(time); }   // after the camera moved: the mask must match this frame
        if (composer) composer.render(); else renderer.render(scene, camera);
  }

  return { renderer, scene, camera, frame, resize, load, U, ashU, bloom, key, rim, get aura() { return aura; }, get loaded() { return loaded; } };
}

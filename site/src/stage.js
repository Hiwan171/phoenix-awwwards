// WebGL stage: phoenix (skinned, rigged), ash particles, flame shells, camera, post.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { makeUniforms, patchReveal, SHELL_VERT, SHELL_FRAG, ASH_VERT, ASH_FRAG } from './shaders.js';

const VOID = 0x070504;

export async function createStage({ canvas, lite, reduced, onProgress }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  const dprCap = lite ? 1.5 : 1.75;
  renderer.setPixelRatio(Math.min(devicePixelRatio, dprCap));
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(VOID);
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.7;
  // key + rim: give the plumage form so the texture detail reads (the fire never has to do the lighting)
  const key = new THREE.DirectionalLight(0xffe0bd, 2.0); key.position.set(-1.6, 2.2, -2.4);
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

  // ───────── load the rigged GLB ─────────
  const gltf = await new Promise((res, rej) =>
    new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).load(
      lite ? '/models/phoenix-lite.glb' : '/models/phoenix-web.glb',
      res,
      (e) => e.total && onProgress?.(e.loaded / e.total),
      rej));
  scene.add(gltf.scene);
  let skinned = null;
  gltf.scene.traverse((o) => { if (o.isSkinnedMesh && !skinned) skinned = o; });
  const skeleton = skinned.skeleton;
  skinned.frustumCulled = false;
  patchReveal(skinned.material, U);
  skinned.visible = false;                                  // hidden until the reveal starts

  scene.updateMatrixWorld(true);
  skeleton.update();

  // ───────── ash: sample the rest-pose surface (+ colour from the base texture) ─────────
  const ashCount = lite ? 16000 : 42000;
  const geo = skinned.geometry;
  const nV = geo.attributes.position.count, uvA = geo.attributes.uv;
  const img = skinned.material.map?.image;
  let px = null, W = 1, H = 1;
  if (img) {
    W = H = 512;
    const cv = new OffscreenCanvas(W, H), cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(img, 0, 0, W, H);
    px = cx.getImageData(0, 0, W, H).data;
  }
  const aTarget = new Float32Array(ashCount * 3), aColor = new Float32Array(ashCount * 3), aRand = new Float32Array(ashCount * 4);
  const v = new THREE.Vector3(), srgb2lin = (c) => Math.pow(c / 255, 2.2);
  for (let i = 0; i < ashCount; i++) {
    const idx = (Math.random() * nV) | 0;
    skinned.getVertexPosition(idx, v);
    v.applyMatrix4(skinned.matrixWorld);
    aTarget.set([v.x, v.y, v.z], i * 3);
    if (px) {
      const x = Math.min(W - 1, Math.max(0, (uvA.getX(idx) * W) | 0)), y = Math.min(H - 1, Math.max(0, (uvA.getY(idx) * H) | 0));
      const o = (y * W + x) * 4;
      aColor.set([srgb2lin(px[o]), srgb2lin(px[o + 1]), srgb2lin(px[o + 2])], i * 3);
    } else aColor.set([0.8, 0.25, 0.08], i * 3);
    aRand.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
  }
  const ashGeo = new THREE.BufferGeometry();
  ashGeo.setAttribute('position', new THREE.BufferAttribute(aTarget.slice(), 3));
  ashGeo.setAttribute('aTarget', new THREE.BufferAttribute(aTarget, 3));
  ashGeo.setAttribute('aColor', new THREE.BufferAttribute(aColor, 3));
  ashGeo.setAttribute('aRand', new THREE.BufferAttribute(aRand, 4));
  const ashU = {
    uTime: U.uTime, uForm: { value: 0 }, uFade: { value: 1 }, uSize: { value: 0.0038 },
    uScale: { value: 1 }, uBreath: { value: reduced ? 0 : 1 },
  };
  const ash = new THREE.Points(ashGeo, new THREE.ShaderMaterial({
    uniforms: ashU, vertexShader: ASH_VERT, fragmentShader: ASH_FRAG,
    transparent: true, depthWrite: false, blending: THREE.NormalBlending,
  }));
  ash.frustumCulled = false;
  ash.renderOrder = 5;
  scene.add(ash);

  // ───────── flame shells (approved preset: 3 layers) ─────────
  const shells = [];
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

  // ───────── animation (rig): Idle blends in once she has materialised ─────────
  const mixer = new THREE.AnimationMixer(gltf.scene);
  const clips = Object.fromEntries(gltf.animations.map((c) => [c.name, mixer.clipAction(c)]));
  clips.Idle.play().setEffectiveWeight(0);
  clips.Hover.play().setEffectiveWeight(0);
  const bone = (n) => skeleton.bones.find((b) => b.name === n);
  const neck = [bone('Neck1'), bone('Neck2'), bone('Head')];
  const look = { x: 0, y: 0 };

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

  /** S: scroll-driven state. pointer: -1..1. */
  function frame(dt, S, pointer) {
    if (!reduced) time += dt;
    U.uTime.value = time;
    U.uReveal.value = S.reveal;
    U.uIgnite.value = S.ignite;
    ashU.uForm.value = S.form;
    ashU.uFade.value = S.ashFade;
    ashU.uScale.value = renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));

    skinned.visible = S.reveal > 0.002;
    const lit = S.ignite > 0.01;
    shells.forEach((s) => { s.visible = lit; });
    ash.visible = S.ashFade > 0.01;

    clips.Idle.setEffectiveWeight(S.idle * (1 - S.hover));
    clips.Hover.setEffectiveWeight(S.idle * S.hover);
    if (bloom) bloom.strength = 0.46 + S.bloom;
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

    // camera: slow push-in + orbit, offset so the phoenix sits right of the copy on wide screens
    const wide = camera.aspect > 1.1;
    const r = S.camR + S.dolly + S.punch, ang = S.orbit + pointer.x * 0.05;
    camTarget.set(wide ? 0.26 : 0, S.camY * 0.4 + (wide ? -0.03 : -0.1), 0);
    camera.position.set(Math.sin(ang) * r + camTarget.x, S.camY + pointer.y * 0.03, -Math.cos(ang) * r);
    camera.lookAt(camTarget);

    if (composer) composer.render(); else renderer.render(scene, camera);
  }

  return { renderer, scene, camera, frame, resize, U, ashU };
}

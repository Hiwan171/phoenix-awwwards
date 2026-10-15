// The phoenix of the hero: loads the rigged GLB, puts her in the stage, centred, and hovers her in the air.
//   ?fenix=0  leaves the page as the bare sky (QA)      ?m=lite / ?m=web  forces a model variant
//   ?rig=old  the first (code-built) rig with its hover controller;  default: the Meshy rig (fenix-meshy-*.glb, 694 bones, one
//             chain per feather) playing its baked "Hover" clip   (tools/meshy-test: rig-feathers.mjs, make-fenix-motion.mjs)
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { createFenix } from './beasts/fenix.js';
import { createHover } from './beasts/fenix-hover.js';
import { buildTip, buildTipMeshy, createFireUniforms, fireMaterial, fireMask } from './beasts/fenix-fire.js';

const TAU = Math.PI * 2;
const ENV = 0.5;                       // ambient for her material only (the lab, where she was approved, used 0.4)
const AURA_H = 0.30;                   // base height of the flame tongues (stage default 0.36)
const METAL = 0.4;                     // multiplier on the baked metalness channel (the raw factor is 1: mirror patches on bright skies)
const MESHY_SCALE = 1 / 1.7;           // the Meshy model is 1.7 tall, faces -x, y in [0, 1.7]: height 1, facing -z, centred
const WING_PERIOD = 1.25;              // s: one beat of the baked clip (phase 0 = wings at the top)

export async function addPhoenix(stage, { lite, reduced }) {
  const Q = new URLSearchParams(location.search);
  if (Q.get('fenix') === '0') return null;
  const old = Q.get('rig') === 'old';
  const variant = Q.get('m') ?? (lite ? 'lite' : 'web');
  const file = old ? `fenix-${variant}.glb` : `fenix-meshy-${variant}.glb`;
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(`${import.meta.env.BASE_URL}models/${file}`);
  const model = gltf.scene;
  model.traverse((o) => {
    if (o.isMesh || o.isSkinnedMesh) {
      o.frustumCulled = false;                                    // a skinned mesh's static bounds are the rest pose
      const m = o.material;                                       // scene.environmentIntensity is very low on this stage (the sky
      if (m) {
        m.envMap = stage.scene.environment; m.envMapIntensity = +(Q.get('env') ?? ENV);
        m.metalness = +(Q.get('metal') ?? METAL);      // factor on the metallicRoughness map
      }   // and the key light carry the look): the baked PBR
                                                                  // needs its own ambient to read its metal channel
    }
  });
  // `root` is what the inspection controls turn; the Meshy model sits in a holder that orients and scales it
  const root = new THREE.Group();
  if (old) root.add(model);
  else {
    const holder = new THREE.Group();
    holder.rotation.y = -Math.PI / 2; holder.scale.setScalar(MESHY_SCALE); holder.position.y = -0.85 * MESHY_SCALE;
    holder.add(model); root.add(holder);
  }
  stage.scene.add(root);

  // ───────── fire: embers eat the feather tips (?fire=1), flames + hot rim rise off the silhouette (?aura=1) ─────────
  // OFF by default while the rig is being inspected (the raw model is what is under review): ?fire=1 / ?aura=1 switch them on
  const FIRE = Q.get('fire') === '1', AURA = Q.get('aura') === '1';
  const U = createFireUniforms({ burn: +(Q.get('burn') ?? 0.55), heat: 1 });
  if (FIRE) {
    model.traverse((o) => {
      if (!o.isSkinnedMesh) return;
      (old ? buildTip : buildTipMeshy)(o); fireMaterial(o.material, U);
    });
    stage.post.setMaskMaterial(fireMask(U));
  }
  if (AURA) {
    model.traverse((o) => { if (o.isMesh || o.isSkinnedMesh) o.layers.enable(1); });     // layer 1 = the flame silhouette
    stage.post.aura.enabled = true;
    stage.post.aura.uniforms.uHeight.value = AURA_H;
  }

  // ───────── motion ─────────
  let fenix = null, hover = null, mixer = null, clipTime = 0;
  if (old) {
    fenix = createFenix(model);
    hover = createHover(fenix, { intensity: reduced ? 0.25 : 1 });
  } else {
    mixer = new THREE.AnimationMixer(model);
    const clip = gltf.animations.find((c) => c.name === 'Hover') ?? gltf.animations[0];
    if (clip) mixer.clipAction(clip).play();
  }
  // compile her programs now (skinned PBR) so the first frame she is on screen does not hitch
  if (stage.renderer.compileAsync) await stage.renderer.compileAsync(stage.scene, stage.camera);
  if (FIRE || AURA) await stage.post.compile();         // the dissolve mask + the aura programs, so the first frame does not hitch

  return {
    root, model, fenix, hover, mixer, variant, rig: old ? 'old' : 'meshy',
    /** call every frame BEFORE stage.frame(); `clock` (seconds) freezes / scrubs the beat (QA) */
    speed: +(Q.get('speed') ?? 1),                 // 1 = real time, 0.25 = slow motion, 0 = paused (the beat and every spring)
    update(dt, clock = null) {
      const d = dt * this.speed;
      let phase;
      if (old) {
        hover.update(d, clock); fenix.update(d); phase = hover.state.phase;
      } else {
        const strength = reduced ? 0.25 : 1;                              // reduced motion: slower, not still
        if (clock !== null) { clipTime = clock; mixer.setTime(clock * strength); }
        else { clipTime += d; mixer.update(d * strength); }
        phase = (((clock ?? clipTime) * strength) % WING_PERIOD) / WING_PERIOD;
      }
      // the fire follows the beat: it flares on the downstroke (the thrust) and settles on the upstroke, a touch late
      const burst = Math.max(0, Math.sin(TAU * (phase - 0.05)));
      const power = 0.40 + 0.60 * Math.pow(burst, 1.2);
      const t = clock ?? (old ? hover.state.t : clipTime);
      U.uTime.value = t;
      U.uHeat.value = 0.55 + 0.9 * power;
      U.uBurn.value = (+(Q.get('burn') ?? 0.55)) * (0.85 + 0.30 * power);
      stage.fireGain = 0.65 + 0.55 * power;
      stage.post.aura.uniforms.uHeight.value = AURA_H * (0.8 + 0.5 * power);
      this.power = power;
    },
    power: 0, fire: U,
  };
}

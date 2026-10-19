// Hero post-processing, fused. Replaces EffectComposer + RenderPass + UnrealBloomPass + OutputPass and the full-resolution
// aura composite of flame-aura.js (the lab, sky.html, still uses that one).
//
// Why: measured on an Intel UHD at 1080p with EXT_disjoint_timer_query, the old chain was the scene pass followed by four
// more full-resolution HDR passes (aura composite 2.9 ms, bloom blend 1.4, output 1.7 ...). Everything that is soft now runs
// at HALF resolution and there is exactly ONE full-res pass after the scene:
//
//   sceneRT   full   sky + body + flame shells (hardware depth test)         renderer.render(scene)   layer 0
//   maskRT    half   the bird as a white silhouette                          renderer.render(scene)   layer 1
//   flameRT   half   the flame field, every pixel walking down the mask      (FLAME_FRAG, unchanged)
//   auraRT    half   flames + hot rim (premultiplied) and "how much the flame covers the sky"
//   bright    half   luminosity high-pass of (scene + aura)  ->  UnrealBloomPass mips, maths unchanged
//   canvas    full   ACES( mix(S, S * .25, cover) + fire + bloom ),  S = scene
//
// Every formula below is the old one moved to where it is cheapest; the old-vs-new difference is checked with pixel diffs
// (see HANDOFF, Performance).
import * as THREE from 'three';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { QUAD_VERT, FLAME_FRAG, makeNoiseTexture } from './flame-aura.js';

export const LAYER_SILHOUETTE = 1;      // the bird alone: the aura mask
export const LAYER_OCCLUDER = 2;        // scenery in front of the bird (a mountain): drawn into the mask's DEPTH only, so the parts of
                                        // the bird it hides neither burn nor get a rim (enable this layer on terrain meshes)

// half-res: soften the flame field and add the hot rim on the silhouette. Output: rgb = fire to ADD, a = cover amount.
const AURA_FINAL_FRAG = /* glsl */`
uniform sampler2D tMask, tFlame;
uniform float uRim, uOpaque;                          // uOpaque: 0 = additive (dark bg), 1 = flames cover the sky (bright bg)
uniform vec2 uTexel;                                  // 1 / this target's size
varying vec2 vUv;
void main() {
  float m0 = texture2D(tMask, vUv).r;
  // 5-tap soft sample of the flame: hides the per-pixel jitter grain of the walk
  vec2 o = uTexel * 0.9;
  vec4 fl4 = texture2D(tFlame, vUv) * 0.36
          + (texture2D(tFlame, vUv + vec2(o.x, o.y)) + texture2D(tFlame, vUv + vec2(-o.x, o.y))
           + texture2D(tFlame, vUv + vec2(o.x, -o.y)) + texture2D(tFlame, vUv + vec2(-o.x, -o.y))) * 0.16;
  vec3 fire = fl4.rgb * (1.0 - m0);
  // bright sky: lay the flame OVER it (additive orange on a golden sky is invisible), keeping a little additive glow
  float cover = fl4.a * (1.0 - m0) * uOpaque;
  fire = mix(fire, fire * 1.15, uOpaque);
  // thin hot rim on the phoenix's own edge: coverage minus a small blur of it
  float blur = 0.0;
  for (int j = 0; j < 8; j++) {
    float a = float(j) * 0.7853982;
    blur += texture2D(tMask, vUv + vec2(cos(a), sin(a)) * uTexel * 1.4).r;
  }
  float edge = clamp(m0 - blur / 8.0, 0.0, 1.0);
  fire += vec3(1.0, 0.42, 0.06) * edge * uRim * 1.3;
  fire += vec3(1.0, 0.70, 0.28) * pow(edge, 2.0) * uRim * 0.5;
  if (!(fire.r >= 0.0 && fire.g >= 0.0 && fire.b >= 0.0)) fire = vec3(0.0);   // NaN guard: one bad pixel blanks the frame through the bloom
  gl_FragColor = vec4(min(fire, vec3(8.0)), cover);
}`;

// half-res: what the bloom sees = the final composite, thresholded (LuminosityHighPassShader maths)
const BRIGHT_FRAG = /* glsl */`
uniform sampler2D tScene, tAura;
uniform float uThreshold, uSmooth, uAuraOn;
varying vec2 vUv;
void main() {
  vec3 C = texture2D(tScene, vUv).rgb;
  if (uAuraOn > 0.5) { vec4 au = texture2D(tAura, vUv); C = mix(C, C * 0.25, au.a) + au.rgb; }
  float a = smoothstep(uThreshold, uThreshold + uSmooth, luminance(C));
  gl_FragColor = vec4(C * a, a);
}`;

// full-res, the only one after the scene: composition + tone mapping + colour space (OutputShader, composition in front)
const FINAL_VERT = /* glsl */`
precision highp float;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
attribute vec3 position;
attribute vec2 uv;
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const FINAL_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tScene, tAura, tBloom;
uniform float uAuraOn, uBloomOn;
#include <tonemapping_pars_fragment>
#include <colorspace_pars_fragment>
varying vec2 vUv;
void main() {
  vec3 C = texture2D(tScene, vUv).rgb;
  if (uAuraOn > 0.5) { vec4 au = texture2D(tAura, vUv); C = mix(C, C * 0.25, au.a) + au.rgb; }
  // UnrealBloomPass blended its texture with SRC_ALPHA, ONE: the composite's alpha is strength * sum(mip factors) ~ 1.05
  if (uBloomOn > 0.5) { vec4 b = texture2D(tBloom, vUv); C += b.rgb * b.a; }
  gl_FragColor = vec4(C, 1.0);

  #ifdef LINEAR_TONE_MAPPING
    gl_FragColor.rgb = LinearToneMapping( gl_FragColor.rgb );
  #elif defined( REINHARD_TONE_MAPPING )
    gl_FragColor.rgb = ReinhardToneMapping( gl_FragColor.rgb );
  #elif defined( CINEON_TONE_MAPPING )
    gl_FragColor.rgb = CineonToneMapping( gl_FragColor.rgb );
  #elif defined( ACES_FILMIC_TONE_MAPPING )
    gl_FragColor.rgb = ACESFilmicToneMapping( gl_FragColor.rgb );
  #elif defined( AGX_TONE_MAPPING )
    gl_FragColor.rgb = AgXToneMapping( gl_FragColor.rgb );
  #elif defined( NEUTRAL_TONE_MAPPING )
    gl_FragColor.rgb = NeutralToneMapping( gl_FragColor.rgb );
  #endif
  #ifdef SRGB_TRANSFER
    gl_FragColor = sRGBTransferOETF( gl_FragColor );
  #endif
}`;

const TONE_DEFINE = {
  [THREE.LinearToneMapping]: 'LINEAR_TONE_MAPPING', [THREE.ReinhardToneMapping]: 'REINHARD_TONE_MAPPING',
  [THREE.CineonToneMapping]: 'CINEON_TONE_MAPPING', [THREE.ACESFilmicToneMapping]: 'ACES_FILMIC_TONE_MAPPING',
  [THREE.AgXToneMapping]: 'AGX_TONE_MAPPING', [THREE.NeutralToneMapping]: 'NEUTRAL_TONE_MAPPING',
};

/**
 * @param aura   run the flame aura (silhouette flames + hot rim)
 * @param bloom  run the bloom
 * @param params { intensity, rim, height, opaque, steps, density, warp, bloomStrength, bloomRadius, bloomThreshold, samples, occluders }
 */
export function createHeroPost({ renderer, scene, camera, aura = true, bloom = true, params = {} }) {
  const HALF = (n) => Math.max(2, Math.round(n / 2));
  const quad = new FullScreenQuad(null);
  const size = new THREE.Vector2();

  // ───────── targets (sizes are set by setSize) ─────────
  const sceneRT = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: false, samples: params.samples ?? 0 });   // samples: MSAA of the scene (the canvas' antialias does not reach a target)
  const maskRT = new THREE.WebGLRenderTarget(2, 2, { type: THREE.UnsignedByteType, depthBuffer: true });
  const flameRT = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, depthBuffer: false });
  const auraRT = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, depthBuffer: false });

  // ───────── aura: mask -> flame field -> finalize (all half-res) ─────────
  const noise = makeNoiseTexture();
  let maskMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });   // a creature may swap it (setMaskMaterial)
  const occluderMat = new THREE.MeshBasicMaterial({ colorWrite: false });
  const occluders = !!params.occluders;
  const flameUniforms = {
    tMask: { value: maskRT.texture }, tNoise: { value: noise },
    uTime: { value: 0 }, uIntensity: { value: params.intensity ?? 1.0 }, uHeight: { value: params.height ?? 0.36 },
    uWarp: { value: params.warp ?? 1.0 }, uAspect: { value: innerWidth / innerHeight },
    uSteps: { value: params.steps ?? 20 }, uDensity: { value: params.density ?? 1.0 }, uDebug: { value: 0 }, uLean: { value: params.lean ?? 0 },
  };
  const flameMat = new THREE.ShaderMaterial({ uniforms: flameUniforms, vertexShader: QUAD_VERT, fragmentShader: FLAME_FRAG, depthTest: false, depthWrite: false });
  const finalizeUniforms = {
    tMask: { value: maskRT.texture }, tFlame: { value: flameRT.texture },
    uRim: { value: params.rim ?? 0.5 }, uOpaque: { value: params.opaque ?? 0 }, uTexel: { value: new THREE.Vector2(0.5, 0.5) },
  };
  const finalizeMat = new THREE.ShaderMaterial({ uniforms: finalizeUniforms, vertexShader: QUAD_VERT, fragmentShader: AURA_FINAL_FRAG, depthTest: false, depthWrite: false });

  // ───────── bloom: UnrealBloomPass's own targets / materials, fed by our bright pass ─────────
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(2, 2), params.bloomStrength ?? 0.35, params.bloomRadius ?? 0.5, params.bloomThreshold ?? 3.2);
  const brightUniforms = {
    tScene: { value: sceneRT.texture }, tAura: { value: auraRT.texture },
    uThreshold: { value: bloomPass.threshold }, uSmooth: { value: 0.01 }, uAuraOn: { value: aura ? 1 : 0 },
  };
  const brightMat = new THREE.ShaderMaterial({ uniforms: brightUniforms, vertexShader: QUAD_VERT, fragmentShader: BRIGHT_FRAG, depthTest: false, depthWrite: false });

  // ───────── final ─────────
  const finalUniforms = {
    tScene: { value: sceneRT.texture }, tAura: { value: auraRT.texture }, tBloom: { value: null },
    uAuraOn: { value: aura ? 1 : 0 }, uBloomOn: { value: bloom ? 1 : 0 }, toneMappingExposure: { value: 1 },
  };
  const finalMat = new THREE.RawShaderMaterial({ name: 'HeroFinal', uniforms: finalUniforms, vertexShader: FINAL_VERT, fragmentShader: FINAL_FRAG, depthTest: false, depthWrite: false });
  let finalKey = '';

  const api = {
    aura: {
      enabled: aura,
      uniforms: flameUniforms,           // uIntensity, uHeight, uWarp, uSteps, uDensity ...
      compUniforms: finalizeUniforms,    // uRim, uOpaque (same names the legacy aura exposed)
    },
    bloom: { enabled: bloom, pass: bloomPass, mips: bloomPass.nMips },   // mips < 5: the widest glows drop out (quality tiers)
    sceneRT, maskRT, flameRT, auraRT,
    /** the silhouette material (default: plain white). A creature that dissolves / burns passes one with the same discard. */
    setMaskMaterial(m) { maskMat = m; },
    /** MSAA of the scene target (0 / 2 / 4); the target is rebuilt on its next use */
    setSamples(n) { if (sceneRT.samples !== n) { sceneRT.samples = n; sceneRT.dispose(); } },
    get samples() { return sceneRT.samples; },
    /** render scale 0.5..1 of the canvas resolution (the final pass upsamples) */
    setScale(sc) { if (sc !== renderScale) { renderScale = sc; setSize(); } },
    get scale() { return renderScale; },
  };

  // ───────── sizes ─────────
  let renderScale = params.scale ?? 1;                 // dynamic resolution: the scene (and everything after it) at a fraction of the canvas
  function setSize() {
    renderer.getDrawingBufferSize(size);
    const W = Math.max(2, Math.round(size.x * renderScale)), H = Math.max(2, Math.round(size.y * renderScale));
    sceneRT.setSize(W, H);
    const hw = HALF(W), hh = HALF(H);
    for (const rt of [maskRT, flameRT, auraRT]) rt.setSize(hw, hh);
    bloomPass.setSize(W, H);
    finalizeUniforms.uTexel.value.set(1 / hw, 1 / hh);
    flameUniforms.uAspect.value = innerWidth / innerHeight;
  }
  setSize();

  // ───────── frame ─────────
  const prevClear = new THREE.Color();
  const pass = (material, target) => { quad.material = material; renderer.setRenderTarget(target); quad.render(renderer); };
  const clear = (target, alpha) => { renderer.setRenderTarget(target); renderer.setClearColor(0x000000, alpha); renderer.clear(true, true, false); };

  /** Everything after the scene objects were updated for this frame. `time` drives the flame field. */
  function render(time) {
    const prevTarget = renderer.getRenderTarget(), prevAuto = renderer.autoClear, prevAlpha = renderer.getClearAlpha();
    const prevMask = camera.layers.mask, prevOverride = scene.overrideMaterial;
    renderer.getClearColor(prevClear);
    renderer.autoClear = false;

    // 1. scene: sky + body + flame shells
    camera.layers.mask = 1;
    clear(sceneRT, 0);
    renderer.render(scene, camera);

    // 2-4. aura: silhouette -> flame field -> soft flames + rim
    if (api.aura.enabled) {
      flameUniforms.uTime.value = time;
      const prevBg = scene.background;
      scene.overrideMaterial = maskMat; scene.background = null;
      camera.layers.set(LAYER_SILHOUETTE);
      clear(maskRT, 1);
      if (occluders) {                                   // depth of the scenery first, then the bird behind it is hidden
        scene.overrideMaterial = occluderMat; camera.layers.set(LAYER_OCCLUDER);
        renderer.render(scene, camera);
        scene.overrideMaterial = maskMat; camera.layers.set(LAYER_SILHOUETTE);
      }
      renderer.render(scene, camera);
      scene.overrideMaterial = prevOverride; scene.background = prevBg;
      pass(flameMat, flameRT);
      pass(finalizeMat, auraRT);
    }
    camera.layers.mask = prevMask;
    renderer.setClearColor(prevClear, prevAlpha);

    // 5. bloom
    let bloomTex = null;
    if (api.bloom.enabled) {
      brightUniforms.uThreshold.value = bloomPass.threshold;
      brightUniforms.uAuraOn.value = api.aura.enabled ? 1 : 0;
      pass(brightMat, bloomPass.renderTargetBright);
      let input = bloomPass.renderTargetBright;
      const mips = Math.max(1, Math.min(bloomPass.nMips, api.bloom.mips | 0));
      for (let i = 0; i < mips; i++) {
        const m = bloomPass.separableBlurMaterials[i];
        m.uniforms.colorTexture.value = input.texture;
        m.uniforms.direction.value = UnrealBloomPass.BlurDirectionX;
        pass(m, bloomPass.renderTargetsHorizontal[i]);
        m.uniforms.colorTexture.value = bloomPass.renderTargetsHorizontal[i].texture;
        m.uniforms.direction.value = UnrealBloomPass.BlurDirectionY;
        pass(m, bloomPass.renderTargetsVertical[i]);
        input = bloomPass.renderTargetsVertical[i];
      }
      const cm = bloomPass.compositeMaterial;
      cm.uniforms.bloomStrength.value = bloomPass.strength;
      cm.uniforms.bloomRadius.value = bloomPass.radius;
      for (let i = 0; i < bloomPass.nMips; i++) bloomPass.bloomTintColors[i].setScalar(i < mips ? 1 : 0);   // skipped mips hold stale data
      pass(cm, bloomPass.renderTargetsHorizontal[0]);
      bloomTex = bloomPass.renderTargetsHorizontal[0].texture;
    }

    // 6. the only full-resolution pass after the scene
    finalUniforms.tBloom.value = bloomTex;
    finalUniforms.uBloomOn.value = bloomTex ? 1 : 0;
    finalUniforms.uAuraOn.value = api.aura.enabled ? 1 : 0;
    finalUniforms.toneMappingExposure.value = renderer.toneMappingExposure;
    const key = `${renderer.toneMapping}|${renderer.outputColorSpace}`;
    if (key !== finalKey) {                              // same define logic as OutputPass
      finalKey = key;
      finalMat.defines = {};
      if (THREE.ColorManagement.getTransfer(renderer.outputColorSpace) === THREE.SRGBTransfer) finalMat.defines.SRGB_TRANSFER = '';
      const d = TONE_DEFINE[renderer.toneMapping]; if (d) finalMat.defines[d] = '';
      finalMat.needsUpdate = true;
    }
    pass(finalMat, null);

    renderer.autoClear = prevAuto;
    renderer.setRenderTarget(prevTarget);
  }

  /** Programs depend on the target they render into (colour space / tone mapping), so compile against the real ones. */
  async function compile() {
    const prev = renderer.getRenderTarget();
    const warm = new THREE.Scene();
    const geo = new THREE.PlaneGeometry(2, 2);
    for (const m of [flameMat, finalizeMat, brightMat, ...bloomPass.separableBlurMaterials, bloomPass.compositeMaterial, finalMat, maskMat]) {
      const mesh = new THREE.Mesh(geo, m); mesh.frustumCulled = false; warm.add(mesh);
    }
    try {
      renderer.setRenderTarget(sceneRT);
      await renderer.compileAsync(scene, camera);
      renderer.setRenderTarget(flameRT);
      await renderer.compileAsync(warm, camera);
    } catch { /* the first draw compiles instead */ }
    renderer.setRenderTarget(prev);
    geo.dispose();
  }

  return Object.assign(api, { render, setSize, compile });
}

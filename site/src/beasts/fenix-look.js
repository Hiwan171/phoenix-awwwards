// The phoenix's look: from Meshy's raw baked colour (a dusty brick red) to a bird made of fire. One material patch, chained with
// the eyelids (fenix-eyes.js), in five layers:
//
//   1. GRADE        the base colour is re-coloured by its own luminance through a fire palette (ember-black -> crimson -> scarlet
//                   -> orange -> gold), keeping the texture's detail; feather tips are pushed hotter; the greenish legs go bronze-gold
//   2. EMBERS       the dark crevices between feathers glow from inside (lava in the cracks), strongest on the plumes and wings
//   3. FLOW         bands of heat run along every feather chain toward its tip (aTip), broken by a noise glued to the rest pose
//   4. LIGHT        a hot Fresnel rim, and the sun shining THROUGH the feathers when she flies against it (thin-sheet translucency)
//   5. EYES         two small gold coals in the eye ellipses (closed by the blink)
//
// Optional: a burn dissolve on the outermost feather tips with an incandescent edge (uBurn, 0 = off).
// Everything that moves runs on uTime (wall clock: she smoulders even when the scroll stops) and uHeat (the scene's intensity).
//
//   const look = applyFenixLook(skinnedMesh)                              after applyEyes (or before: it chains either way)
//   per frame:  look.update({ time, heat, camera, sunDir, blink })
import * as THREE from 'three';
import { buildTipMeshy } from './fenix-fire.js';
import { EYES } from './fenix-eyes.js';

export const LOOK_DEFAULTS = {
  grade: 1.0,        // 0 = raw texture, 1 = full fire palette
  albedo: 0.5,       // brightness of the graded base colour (the glow comes from the emission, not from a bright albedo)
  embers: 1.0,       // glow in the crevices
  flow: 1.0,         // heat bands running to the tips
  tips: 1.0,         // hot feather tips
  rim: 0.9,          // Fresnel rim
  trans: 1.0,        // sunlight through the feathers
  eyes: 1.0,         // eye glow
  burn: 0.0,         // tip dissolve (0 = off)
};

const GLSL_COMMON = /* glsl */`
varying float vLkTip; varying vec3 vLkRest;
uniform float uLkAlbedo, uLkTime, uLkHeat, uLkGrade, uLkEmbers, uLkFlow, uLkTips, uLkRim, uLkTrans, uLkEyes, uLkBurn, uLkBlink;
uniform vec3 uLkSunView, uLkSunCol;
uniform vec4 uLkEye0, uLkEye1;
float lkHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float lkNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(lkHash(i), lkHash(i + vec3(1,0,0)), f.x), mix(lkHash(i + vec3(0,1,0)), lkHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(lkHash(i + vec3(0,0,1)), lkHash(i + vec3(1,0,1)), f.x), mix(lkHash(i + vec3(0,1,1)), lkHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float lkFbm(vec3 p) { return 0.55 * lkNoise(p) + 0.30 * lkNoise(p * 2.07 + 3.1) + 0.15 * lkNoise(p * 4.3 + 7.7); }
// the fire palette, linear HDR: x 0 ember-black .. 1 crimson .. 2 scarlet .. 3 orange .. 4 gold .. 5 white-hot
vec3 lkFire(float x) {
  vec3 c = vec3(0.020, 0.002, 0.003);
  c = mix(c, vec3(0.200, 0.010, 0.012), smoothstep(0.0, 1.0, x));
  c = mix(c, vec3(0.620, 0.050, 0.012), smoothstep(1.0, 2.0, x));
  c = mix(c, vec3(1.000, 0.250, 0.030), smoothstep(2.0, 3.0, x));
  c = mix(c, vec3(1.000, 0.560, 0.120), smoothstep(3.0, 4.0, x));
  c = mix(c, vec3(1.000, 0.880, 0.560), smoothstep(4.0, 5.0, x));
  return c;
}
float lkLum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float lkEye(vec2 uv, vec4 e) { vec2 d = (uv - e.xy) / e.zw; return 1.0 - smoothstep(0.55, 1.05, length(d)); }`;

const GLSL_BURN = /* glsl */`
  float lkEdge = 0.0;
  if (uLkBurn > 0.0 && vLkTip > 0.6) {
    float bn = lkFbm(vLkRest * 9.0 + vec3(0.0, uLkTime * 0.9, 0.0));
    float thr = pow(smoothstep(0.6, 1.0, vLkTip), 1.6) * uLkBurn;
    if (bn < thr) discard;
    lkEdge = 1.0 - smoothstep(thr, thr + 0.08, bn);
  }`;

const GLSL_GRADE = /* glsl */`
  float lkTipW = smoothstep(0.25, 1.0, vLkTip);
  float lkL = lkLum(diffuseColor.rgb);
  {
    vec3 raw = diffuseColor.rgb;
    // the texture's luminance (linear) spans ~0.02 (crevices) .. ~0.25 (light scales); map it onto the palette, tips run hotter
    float x = 0.5 + 2.1 * pow(clamp(lkL / 0.16, 0.0, 2.0), 0.75) + 0.5 * lkTipW;
    vec3 fire = lkFire(x) * uLkAlbedo;                             // an albedo: the palette's hue, not its HDR brightness
    // keep a little of the texture's own hue variation (the painted scale edges) and all of its detail (via x)
    vec3 graded = mix(fire, fire * (raw / max(lkL, 1e-3)) * 0.35 + fire * 0.65, 0.35);
    // greenish parts (legs, talons, the rare grey-green scale): bronze-gold, not red
    float green = smoothstep(0.0, 0.05, raw.g - raw.r * 0.85);
    vec3 bronze = vec3(0.55, 0.28, 0.06) * (0.4 + 2.2 * lkL / 0.16);
    graded = mix(graded, bronze, green);
    // the eyes stay as painted
    float eye = max(lkEye(vMapUv, uLkEye0), lkEye(vMapUv, uLkEye1));
    diffuseColor.rgb = mix(raw, graded, uLkGrade * (1.0 - eye));
  }`;

const GLSL_EMISSIVE = /* glsl */`
  {
    vec3 V = normalize(vViewPosition);                             // surface -> camera (view space)
    vec3 N = normal;
    float heat = uLkHeat;
    float n = lkFbm(vLkRest * 5.0 + vec3(0.0, -uLkTime * 0.7, uLkTime * 0.2));
    // 2. embers in the crevices: only the darkest texels (the texture's linear luminance: 5 % < 0.020, median 0.065)
    float cav = 1.0 - smoothstep(0.014, 0.034, lkL);
    vec3 em = lkFire(2.3 + 1.2 * n) * cav * (0.3 + 0.7 * lkTipW) * 0.9 * uLkEmbers;
    // 3. heat bands running out along each feather chain (vLkTip grows toward the tip), broken by the glued noise
    float band = sin(vLkTip * 13.0 - uLkTime * 4.2 + n * 7.0) * 0.5 + 0.5;
    band = smoothstep(0.78, 1.0, band) * smoothstep(0.15, 0.6, vLkTip);
    em += lkFire(2.5 + 0.8 * n) * band * 0.45 * uLkFlow;
    // hot tips: only the last stretch of the long feathers, flickering with the noise
    float tip = smoothstep(0.82, 1.0, vLkTip) * smoothstep(0.35, 0.75, n);
    em += lkFire(2.8 + 1.2 * n) * tip * 0.6 * uLkTips;
    // 4. Fresnel rim (the air around her is hot)
    float fr = pow(1.0 - clamp(abs(dot(N, V)), 0.0, 1.0), 3.0);
    em += vec3(1.0, 0.24, 0.03) * fr * (0.5 + 0.5 * lkTipW) * 1.1 * uLkRim;
    // sunlight through the feathers: the sun behind the sheet lights the face we see (thin = feathers more than body)
    // (saturated: light through a red feather comes out deep orange, never white)
    float back = max(dot(-N, uLkSunView), 0.0);
    float toward = pow(max(dot(-V, uLkSunView), 0.0), 4.0);
    float thin = 0.2 + 0.8 * lkTipW;
    em += lkFire(1.9 + 0.7 * lkTipW + 0.4 * n) * back * (0.08 + 0.6 * toward) * thin * uLkTrans;
    em *= heat;
    // 5. eyes: two coals (they close with the lid)
    float eyeG = max(lkEye(vMapUv, uLkEye0), lkEye(vMapUv, uLkEye1)) * (1.0 - smoothstep(0.2, 0.8, uLkBlink));
    em += vec3(1.0, 0.62, 0.16) * eyeG * 3.0 * uLkEyes;
    // incandescent edge of the burnt tips
    em += mix(vec3(1.0, 0.30, 0.04), vec3(1.0, 0.85, 0.40), lkEdge * lkEdge) * lkEdge * 3.0 * heat;
    totalEmissiveRadiance += em;
  }`;

/** Patches the phoenix's MeshStandardMaterial. Returns { uniforms, set(params), update(frame) }. */
export function applyFenixLook(mesh, params = {}) {
  const material = mesh.material;
  if (!mesh.geometry.attributes.aTip) buildTipMeshy(mesh);
  const P = { ...LOOK_DEFAULTS, ...params };
  const U = {
    uLkAlbedo: { value: P.albedo }, uLkTime: { value: 0 }, uLkHeat: { value: 1 }, uLkBlink: { value: 0 },
    uLkGrade: { value: P.grade }, uLkEmbers: { value: P.embers }, uLkFlow: { value: P.flow }, uLkTips: { value: P.tips },
    uLkRim: { value: P.rim }, uLkTrans: { value: P.trans }, uLkEyes: { value: P.eyes }, uLkBurn: { value: P.burn },
    uLkSunView: { value: new THREE.Vector3(0, 0, 1) }, uLkSunCol: { value: new THREE.Color(1.0, 0.62, 0.30) },
    uLkEye0: { value: new THREE.Vector4(...EYES[0]) }, uLkEye1: { value: new THREE.Vector4(...EYES[1]) },
  };
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer);
    Object.assign(shader.uniforms, U);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aTip; varying float vLkTip; varying vec3 vLkRest;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLkTip = aTip; vLkRest = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL_COMMON}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${GLSL_BURN}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${GLSL_GRADE}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${GLSL_EMISSIVE}`);
  };
  material.customProgramCacheKey = ((old) => () => (old ? old() : '') + '|look1')(material.customProgramCacheKey?.bind(material));
  material.needsUpdate = true;

  const sunView = new THREE.Vector3();
  return {
    uniforms: U,
    set(p) {
      const map = { albedo: 'uLkAlbedo', grade: 'uLkGrade', embers: 'uLkEmbers', flow: 'uLkFlow', tips: 'uLkTips', rim: 'uLkRim', trans: 'uLkTrans', eyes: 'uLkEyes', burn: 'uLkBurn' };
      for (const k of Object.keys(p)) if (map[k]) U[map[k]].value = p[k];
    },
    /** time: seconds (wall clock); heat: scene intensity (1 = normal); sunDir: world direction TO the sun; blink 0..1 */
    update({ time, heat = 1, camera, sunDir, blink = 0 }) {
      U.uLkTime.value = time; U.uLkHeat.value = heat; U.uLkBlink.value = blink;
      if (camera && sunDir) { sunView.copy(sunDir).transformDirection(camera.matrixWorldInverse); U.uLkSunView.value.copy(sunView); }
    },
  };
}

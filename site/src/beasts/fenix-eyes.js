// Eyelids by shader. The phoenix's eyes are painted in the base-colour texture (there is no eyelid or eye geometry), so a blink is a
// patch of the texture: inside each eye's UV ellipse the colour is closed toward the skin around the eye (sampled from the same map,
// four taps outside the eye), with a thin darker lid line on the closing edge. Nothing in the geometry moves.
//
//   const eyes = applyEyes(material)      patches the material (MeshStandardMaterial with a base-colour map); returns { uniforms, set(amount) }
//   blinkAt(t)  -> 0..1                   the blink schedule as a pure function of time (reversible with the scroll)
//
// The UVs were found by casting rays through the eyes of close-up renders (tools: scratchpad eye-uv.mjs, see tools/meshy-test/README.md);
// the web GLB is simplified but keeps the UVs, and the lite one too (checked in the lab).
import * as THREE from 'three';

// [u, v, radius u, radius v] of the left and right eye (the left eye is the one on the bird's left, -x of the model's right...)
export const EYES = [
  [0.6563, 0.6520, 0.0034, 0.0031],
  [0.0735, 0.9795, 0.0038, 0.0030],
];

const hash = (k) => { const x = Math.sin(k * 91.7 + 13.3) * 43758.5453; return x - Math.floor(x); };

/** A blink every 2.4 to 6 s (sometimes a quick double), each 0.16 s: eases shut faster than it opens. */
export function blinkAt(t) {
  const T = 3.4, k0 = Math.floor(t / T);
  let v = 0;
  for (let k = k0 - 1; k <= k0; k++) {
    const t0 = k * T + (hash(k) * 0.55 + 0.1) * T * 0.9, dur = 0.16, e = (t - t0) / dur;
    const blink = (x) => (x < 0 || x > 1 ? 0 : x < 0.4 ? Math.pow(x / 0.4, 1.6) : Math.pow(1 - (x - 0.4) / 0.6, 1.3));      // closes in 40 %, opens in 60 %
    v = Math.max(v, blink(e));
    if (hash(k + 7) > 0.72) v = Math.max(v, blink((t - (t0 + 0.26)) / dur));                                                  // the double blink
  }
  return v;
}

export function applyEyes(material, { strength = 1 } = {}) {
  const U = { uBlink: { value: 0 }, uEye0: { value: new THREE.Vector4(...EYES[0]) }, uEye1: { value: new THREE.Vector4(...EYES[1]) }, uLid: { value: strength } };
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer);
    Object.assign(shader.uniforms, U);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uBlink, uLid; uniform vec4 uEye0, uEye1;`)
      .replace('#include <map_pars_fragment>', `#include <map_pars_fragment>
#ifdef USE_MAP
vec3 eyeClose(vec3 col, vec2 uv, vec4 e) {
  vec2 d = (uv - e.xy) / e.zw;                                   // 1 at the edge of the eye
  float r = length(d);
  float m = 1.0 - smoothstep(1.0, 1.75, r);                      // soft mask a little wider than the eye
  if (m <= 0.0 || uBlink <= 0.001) return col;
  // the skin around the eye: four taps outside it, from the same colour map
  vec3 skin = (texture2D(map, uv + vec2(e.z, 0.0) * 2.1).rgb + texture2D(map, uv - vec2(e.z, 0.0) * 2.1).rgb
             + texture2D(map, uv + vec2(0.0, e.w) * 2.1).rgb + texture2D(map, uv - vec2(0.0, e.w) * 2.1).rgb) * 0.25;
  // the lid comes down from the top of the eye (the texture's v axis): the covered part grows with the blink; a darker line on its edge
  float edge = d.y * 0.5 + 0.5;                                    // 0 at the bottom of the eye .. 1 at the top
  float b = clamp(uBlink * 1.15, 0.0, 1.0);
  float cover = smoothstep(1.0 - b - 0.22, 1.0 - b + 0.02, edge) * smoothstep(0.0, 0.06, b);
  float line = smoothstep(0.1, 0.4, cover) * (1.0 - smoothstep(0.4, 0.9, cover));
  vec3 lid = skin * 0.9;
  vec3 outc = mix(col, lid, cover * m * uLid);
  outc *= 1.0 - 0.45 * line * m * uLid;
  return outc;
}
#endif`)
      .replace('#include <map_fragment>', `#include <map_fragment>
#ifdef USE_MAP
  diffuseColor.rgb = eyeClose(diffuseColor.rgb, vMapUv, uEye0);
  diffuseColor.rgb = eyeClose(diffuseColor.rgb, vMapUv, uEye1);
#endif`);
  };
  material.customProgramCacheKey = ((old) => () => (old ? old() : '') + '|eyes1')(material.customProgramCacheKey?.bind(material));
  material.needsUpdate = true;
  return { uniforms: U, set(amount) { U.uBlink.value = amount; } };
}

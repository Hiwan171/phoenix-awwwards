// The phoenix's skin: ONE patch of three's MeshStandardMaterial shared by the hero (stage.js) and the lab (sky-test.js).
//   * plumage      painted palette by anatomy + position along the feather (PLUMAGE_GLSL, needs bakePlumage attributes)
//   * eyes         slanted yellow wedge drawn per pixel from the eye-local coords (aE)
//   * translucency light through thin feathers, tinted BY the feather, only where a light sits behind the bird (uSunV)
//   * embers       a faint glow in the creases (cavity)
//   * rim          optional coloured rim light separating the silhouette from the background
//   * reveal       optional dissolve-in used by the hero's intro (bottom-up, noise-edged ember line)
//   * grade        legacy albedo grade for the FIRST (Tripo) phoenix, off unless uGradeOn
// U is the shared uniform bag of makeUniforms() (+ uSunV: a Vector3 = direction TOWARD the back light, in VIEW space).
import { GLSL_NOISE, GRADE_GLSL, PLUMAGE_GLSL } from './shaders.js';

const UNIFORM_KEYS = ['uGradeOn', 'uHueShift', 'uSatRed', 'uValRed', 'uValAmber', 'uPlumeOn', 'uEye', 'uDetail', 'uCavity',
  'uRough', 'uTrans', 'uGlow', 'uDbg', 'uSunV', 'uTime', 'uReveal', 'uYMin', 'uYMax'];

export function patchPhoenixMaterial(mat, U, { reveal = false, rim = null } = {}) {
  const rimU = rim ?? { uRim: { value: 0 }, uRimCol: { value: [1, 0.74, 0.36] } };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, rimU);
    for (const k of UNIFORM_KEYS) if (U[k]) sh.uniforms[k] = U[k];
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 aW0, aW1, aQ, aX, aE;
varying vec4 vW0, vW1, vQ, vX, vE;
${reveal ? 'varying vec3 vFWPos;' : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vW0 = aW0; vW1 = aW1; vQ = aQ; vX = aX; vE = aE;`);
    if (reveal) sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
vFWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);

    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uRim; uniform vec3 uRimCol;
uniform float uTrans, uGlow, uDbg, uDetail, uCavity, uRough, uEye; uniform vec3 uSunV;
varying vec4 vW0, vW1, vQ, vX, vE;
${reveal ? `varying vec3 vFWPos; uniform float uTime, uReveal, uYMin, uYMax; ${GLSL_NOISE}` : ''}
${GRADE_GLSL}
${PLUMAGE_GLSL}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
      {
        vec3 rawT = diffuseColor.rgb;
        if (uPlumeOn > 0.5) {
          // the clay texture only carries baked sculpt shading: its LOCAL contrast (full-res / blurred mip) is the detail
          vec3 blurT = texture2D(map, vMapUv, 5.0).rgb;
          float dl = dot(rawT, vec3(0.30, 0.59, 0.11)) / max(dot(blurT, vec3(0.30, 0.59, 0.11)), 1e-3);
          float detail = mix(1.0, clamp(pow(max(dl, 0.0), 1.5), 0.35, 1.35), uDetail);
          diffuseColor.rgb = plumage(vW0, vW1, vec4(vQ.x * uCavity, vQ.yzw), vX, vE) * detail;
        } else diffuseColor.rgb = phxGrade(rawT);
      }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      if (uPlumeOn > 0.5) roughnessFactor = clamp(uRough - 0.18 * vQ.z + 0.15 * vQ.x, 0.3, 0.95);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
      if (uPlumeOn > 0.5) metalnessFactor = 0.0;                      // feathers are dielectric`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      if (uPlumeOn > 0.5) {
        vec3 Vv = normalize(vViewPosition);
        float back = pow(clamp(dot(-Vv, uSunV), 0.0, 1.0), 2.2);       // a light behind the feather, the camera in front
        vec3 glowC = diffuseColor.rgb * 2.0 + vec3(0.04, 0.015, 0.0);   // tinted BY the feather (a fixed orange washed the dark tips out)
        totalEmissiveRadiance += glowC * back * vQ.z * uTrans;
        totalEmissiveRadiance += vec3(1.0, 0.26, 0.04) * pow(max(vQ.x * uCavity, 0.0), 1.5) * uGlow;   // embers under the plumage
        totalEmissiveRadiance += vec3(1.0, 0.72, 0.10) * eyeIris(vE, vX) * uEye;                        // the eye glows
        if (uDbg > 0.5) {
          totalEmissiveRadiance = uDbg < 1.5 ? vec3(vQ.x) : uDbg < 2.5 ? vec3(vW1.w) : uDbg < 3.5 ? vec3(vQ.z) : uDbg < 4.5 ? vec3(vQ.y)
            : uDbg < 5.5 ? vec3(vX.x) : uDbg < 6.5 ? vec3(clamp(vX.y / 4.0, 0.0, 1.0)) : uDbg < 7.5 ? vec3(vX.z)
            : uDbg < 8.5 ? vec3(vW1.y) : vec3(vW1.z);
          diffuseColor.rgb = vec3(0.0);
        }
      }
      { float rm = pow(1.0 - saturate(dot(normalize(vNormal), normalize(vViewPosition))), 2.6);
        totalEmissiveRadiance += uRimCol * rm * uRim * (0.35 + 0.65 * smoothstep(0.1, 0.5, dot(diffuseColor.rgb, vec3(0.30, 0.59, 0.11)) + 0.15)); }
      ${reveal ? 'totalEmissiveRadiance += (diffuseColor.rgb * 1.2 + vec3(1.0, 0.30, 0.04) * 0.55) * rvEdge * 1.15;' : ''}`);
    if (reveal) sh.fragmentShader = sh.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
float rvEdge = 0.0;
{
  float h = clamp((vFWPos.y - uYMin) / (uYMax - uYMin), 0.0, 1.0);
  float nz = fbm3(vFWPos * 11.0);
  float key = h * 0.72 + nz * 0.50;                    // 0 .. ~1.15
  float th = uReveal * 1.32 - 0.06;                     // sweeps the whole body
  if (key > th) discard;
  rvEdge = 1.0 - smoothstep(0.0, 0.06, th - key);       // 1 on the dissolve line
}`);
  };
  mat.customProgramCacheKey = () => `phoenix-plumage-${reveal ? 'reveal' : 'plain'}`;
}

// All GLSL for the phoenix: noise + fire ramp, reveal (dissolve-in) patch, flame shells, ash particles.

export const GLSL_NOISE = /* glsl */`
float hash13(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vnoise(vec3 p){
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i),               hash13(i + vec3(1,0,0)), f.x),
        mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x),
        mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm3(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 3; i++){ s += a * vnoise(p); p = p * 2.03 + vec3(7.1, 3.7, 5.3); a *= 0.5; } return s; }
float fbm4(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++){ s += a * vnoise(p); p = p * 2.03 + vec3(7.1, 3.7, 5.3); a *= 0.5; } return s; }
`;

// Shared uniform objects (one source of truth for every layer).
export function makeUniforms() {
  return {
    uTime:   { value: 0 },
    uReveal: { value: 0 },      // 0..1 mesh materialises (bottom-up, noise-edged ember line)
    uIgnite: { value: 0 },      // 0..1 flame front climbing the body
    uFire:   { value: 1.5 },    // approved preset
    uLen:    { value: 0.05 },   // approved preset
    uYMin:   { value: -0.5 },
    uYMax:   { value: 0.5 },
  };
}

/* ───────────────────────── 1) mesh: reveal patch on the PBR material ─────────────────────────
   The texture is never darkened or repainted. Dissolve only decides *which fragments exist*, and the
   fraction that sits on the edge gets an ember line tinted by the model's own colour. */
export function patchReveal(mat, U) {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vFWPos;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        vFWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vFWPos;
        uniform float uTime, uReveal, uYMin, uYMax;
        ${GLSL_NOISE}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        float rvEdge = 0.0;
        {
          float h = clamp((vFWPos.y - uYMin) / (uYMax - uYMin), 0.0, 1.0);
          float nz = fbm3(vFWPos * 11.0);
          float key = h * 0.72 + nz * 0.50;                    // 0 .. ~1.15
          float th = uReveal * 1.32 - 0.06;                     // sweeps the whole body
          if (key > th) discard;
          rvEdge = 1.0 - smoothstep(0.0, 0.06, th - key);       // 1 on the dissolve line
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += (diffuseColor.rgb * 1.2 + vec3(1.0, 0.30, 0.04) * 0.55) * rvEdge * 1.15;`);
  };
  mat.customProgramCacheKey = () => 'phoenix-reveal';
}

/* ───────────────────────── 2) flame shells (skinned) ─────────────────────────
   Flames only LEAVE the model (upward-facing skin + silhouette). They inherit the feather colour at
   the root and settle into ember orange/gold. Approved look: see DESIGN-BRIEF / memory. */
export const SHELL_VERT = /* glsl */`
uniform float uTime, uShell, uLen, uYMin, uYMax;
varying vec3 vWPos; varying vec3 vN; varying vec2 vUv; varying float vH;
#include <common>
#include <skinning_pars_vertex>
void main() {
  vUv = uv;
  #include <beginnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  vec3 n = normalize(objectNormal);
  vec4 base = modelMatrix * vec4(transformed, 1.0);
  vH = clamp((base.y - uYMin) / (uYMax - uYMin), 0.0, 1.0);
  float jit = 0.55 + 0.9 * fract(sin(dot(base.xyz * 37.0, vec3(12.9898, 78.233, 45.164))) * 43758.5453);
  float L = uLen * uShell * jit;
  vec4 wp = modelMatrix * vec4(transformed + n * L * 0.2, 1.0);
  wp.y += L * 1.5;
  wp.x += sin(wp.y * 18.0 + uTime * 3.2 + uShell * 4.0) * 0.006 * uShell;
  wp.z += cos(wp.y * 15.0 - uTime * 2.7 + uShell * 3.0) * 0.006 * uShell;
  vWPos = wp.xyz;
  vN = normalize(mat3(modelMatrix) * n);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

export const SHELL_FRAG = /* glsl */`
uniform float uTime, uShell, uFire, uIgnite, uReveal;
uniform sampler2D uMap;
varying vec3 vWPos; varying vec3 vN; varying vec2 vUv; varying float vH;
${GLSL_NOISE}
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vWPos);
  float rim = pow(1.0 - abs(dot(N, V)), 1.6);
  float up = clamp(N.y, 0.0, 1.0);
  float emitter = smoothstep(0.12, 0.75, up * 0.85 + rim * 0.75);
  float burn = smoothstep(vH, vH + 0.15, uIgnite * 1.35 - 0.2);
  if (emitter * burn < 0.02) discard;

  vec3 q = vWPos * vec3(16.0, 5.0, 16.0) - vec3(0.0, uTime * (1.3 + uShell * 1.8), 0.0);
  float n = fbm4(q);
  n += 0.45 * (fbm3(q * 1.7 + vec3(uTime * 0.35, uTime * 0.5, 3.0)) - 0.5);
  vec3 albedo = texture2D(uMap, vUv).rgb;
  float luma = dot(albedo, vec3(0.30, 0.59, 0.11));
  float cover = n * 0.95 + luma * 0.35 - 0.12;
  float edge = 0.30 + uShell * 0.62;
  float a = smoothstep(edge, edge + 0.12, cover);
  float fade = pow(1.0 - uShell, 1.2);
  float flick = 0.88 + 0.12 * sin(uTime * 17.0 + vWPos.y * 40.0);
  float core = clamp(cover - edge, 0.0, 1.0);

  vec3 root = albedo * 1.7 + 0.04;
  vec3 tip  = mix(vec3(1.0, 0.36, 0.05), vec3(1.0, 0.70, 0.24), core);
  vec3 col  = mix(root, tip, smoothstep(0.0, 0.55, uShell));
  gl_FragColor = vec4(col * uFire * flick, a * fade * burn * emitter * 0.5);
}`;

/* ───────────────────────── 3) ash: particles sampled from the phoenix surface ─────────────────────────
   aTarget = rest-pose surface point, aColor = the model's own colour there (so the ash "remembers").
   uForm 0 -> scattered cloud, 1 -> exact silhouette. */
export const ASH_VERT = /* glsl */`
attribute vec3 aTarget; attribute vec3 aColor; attribute vec4 aRand;
uniform float uTime, uForm, uSize, uScale, uFade, uBreath;
varying vec3 vCol; varying float vA;
float ease(float x){ return x * x * (3.0 - 2.0 * x); }
void main() {
  float f = ease(clamp((uForm - aRand.w * 0.5) / 0.5, 0.0, 1.0));       // per-particle delay
  float ang = uTime * (0.035 + 0.05 * aRand.x) + aRand.y * 6.2831;
  vec3 c = (aRand.xyz - 0.5) * vec3(2.5, 1.8, 2.5);
  float cs = cos(ang), sn = sin(ang);
  vec3 sc = vec3(c.x * cs - c.z * sn,
                 c.y + sin(uTime * 0.25 + aRand.z * 6.2831) * 0.10 + uTime * 0.0,
                 c.x * sn + c.z * cs);
  vec3 p = mix(sc, aTarget, f);
  // in transit the ash spirals around the phoenix axis (0 at both ends), so formation reads as a vortex
  float tr = sin(f * 3.14159);
  float va = tr * (1.6 + aRand.x * 1.4);
  float vc = cos(va), vs = sin(va);
  p.xz = vec2(p.x * vc - p.z * vs, p.x * vs + p.z * vc);
  p += vec3(sin(uTime * 1.7 + aRand.x * 40.0), cos(uTime * 1.3 + aRand.y * 40.0), sin(uTime * 1.1 + aRand.z * 40.0))
       * (0.003 + 0.010 * (1.0 - f)) * uBreath;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float ember = step(0.97, aRand.z);
  gl_PointSize = uSize * (0.55 + aRand.x * 0.9) * (1.0 + ember * 1.6) * uScale / -mv.z;
  vec3 ash = vec3(0.22, 0.19, 0.17) * (0.7 + aRand.x * 0.7);
  vCol = mix(ash, aColor * 0.9, f);
  float tw = 1.2 + 0.6 * sin(uTime * 4.0 + aRand.x * 30.0);
  vCol = mix(vCol, vec3(1.0, 0.36, 0.07) * tw, ember * (0.55 + 0.45 * f));
  vCol *= 1.0 + tr * 1.1;
  vA = uFade * (0.28 + 0.72 * f);
}`;

export const ASH_FRAG = /* glsl */`
varying vec3 vCol; varying float vA;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.05, length(c));
  if (a * vA < 0.01) discard;
  gl_FragColor = vec4(vCol, a * vA);
}`;

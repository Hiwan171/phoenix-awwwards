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

/* Colour grade for the phoenix albedo (non-destructive, off by default).
   The raw texture is a flat, self-lit flame: mean #e6580a, saturation 0.96, value 0.85-0.94 (almost no darks),
   hue 8-45deg only. Against an orange sky that reads as a single orange "blanket" whatever the lighting does.
   The grade (a) pulls the ORANGES toward red (reds are pinned: shifting them past 0deg turns them magenta),
   (b) restores a real value range: reds go deep, the amber feathers stay bright and become the gold accents.
   Done in sRGB-encoded HSV so the degrees are intuitive. */
export const GRADE_GLSL = /* glsl */`
uniform float uGradeOn, uHueShift, uSatRed, uValRed, uValAmber;
vec3 rgb2hsv(vec3 c){ vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y); float e = 1e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x); }
vec3 hsv2rgb(vec3 c){ vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y); }
vec3 phxGrade(vec3 lin){
  if (uGradeOn < 0.5) return lin;
  vec3 h = rgb2hsv(pow(max(lin, 0.0), vec3(1.0 / 2.2)));
  float hd = h.x * 360.0;
  if (hd > 300.0) hd -= 360.0;                                      // slightly-magenta reds are still reds...
  hd = max(hd, 3.0);                                                // ...and must never be pushed toward pink
  float amber = smoothstep(32.0, 42.0, hd);                         // 32-42deg: the gold-ish feathers
  float shift = uHueShift * smoothstep(4.0, 16.0, hd) * (1.0 - 0.7 * amber);   // reds stay, oranges move, ambers move less
  h.x = max(hd - shift, 3.0) / 360.0;
  h.y = clamp(h.y * mix(uSatRed, 1.0, amber), 0.0, 1.0);
  h.z = max(h.z * mix(uValRed, uValAmber, amber), 0.0);
  // hsv2rgb can come back a hair below 0 from rounding, and pow(<0, 2.2) is NaN: one NaN pixel blanks the whole
  // frame through the bloom pass (see HANDOFF), so the result is clamped before the pow.
  return pow(max(hsv2rgb(h), vec3(0.0)), vec3(2.2));
}`;

/* Plumage: the phoenix is PAINTED here, not recoloured. Inputs come from bakePlumage() (plumage.js):
   region weights, t along the feather chain, cavity, thinness. The GLB texture only supplies the
   feather-scale pattern (its red<->amber streaks), as `pat` in 0..1.
   Ramp (sRGB): deep crimson -> crimson -> scarlet -> vermilion -> orange -> amber -> gold -> hot cream.
   Feathers are darkest at the root and hottest at the tip, like a real fire-coloured bird. */
export const PLUMAGE_GLSL = /* glsl */`
uniform float uPlumeOn;
vec3 srgbc(float r, float g, float b){ return pow(vec3(r, g, b) / 255.0, vec3(2.2)); }
vec3 plumeRamp(float u){                       // 0 burnt brown -> red -> orange -> amber -> gold -> yellow -> cream
  u = clamp(u, 0.0, 1.0) * 7.0;
  vec3 c = vec3(43.0, 12.0, 8.0) / 255.0;                                             // #2b0c08
  c = mix(c, vec3(122.0, 20.0, 9.0) / 255.0,   clamp(u,       0.0, 1.0));            // #7a1409
  c = mix(c, vec3(184.0, 42.0, 12.0) / 255.0,  clamp(u - 1.0, 0.0, 1.0));            // #b82a0c
  c = mix(c, vec3(229.0, 82.0, 15.0) / 255.0,  clamp(u - 2.0, 0.0, 1.0));            // #e5520f
  c = mix(c, vec3(245.0, 138.0, 22.0) / 255.0, clamp(u - 3.0, 0.0, 1.0));            // #f58a16
  c = mix(c, vec3(252.0, 185.0, 44.0) / 255.0, clamp(u - 4.0, 0.0, 1.0));            // #fcb92c
  c = mix(c, vec3(255.0, 224.0, 102.0) / 255.0, clamp(u - 5.0, 0.0, 1.0));           // #ffe066
  c = mix(c, vec3(255.0, 244.0, 192.0) / 255.0, clamp(u - 6.0, 0.0, 1.0));           // #fff4c0
  return pow(c, vec3(2.2));
}
// The eye is a thin slanted DIAMOND drawn per pixel from the eye-local coords e = (u, v) (see plumage.js, aE): plain
// golden yellow (no pupil, as in the reference), narrow, with a dark liner and a heavy slanted brow for an angry look. x.y (3D distance / eyeR) only gates it
// to the neighbourhood of an eye, so the same shape cannot show up on the forehead between the two.
float eyeGate(vec4 x) { return 1.0 - smoothstep(1.8, 2.8, x.y); }
// Angry wedge: thick at the front corner (beak side, u < 0), pointed at the rear (u > 0); the UPPER lid is a straight,
// short slant (it sits right under the brow) and the LOWER lid is the curved one. 1 on the outline.
float almondD(vec2 uv) {
  float wedge = mix(1.30, 0.60, clamp(uv.x * 0.5 + 0.5, 0.0, 1.0));      // height factor along the eye
  float y = uv.y > 0.0 ? uv.y / (0.42 * wedge) : uv.y / wedge;            // upper half is squashed
  return pow(pow(abs(uv.x), 1.5) + pow(abs(y), 1.35), 1.0 / 1.4);
}
float eyeIris(vec4 e, vec4 x)  { return (1.0 - smoothstep(0.80, 1.0, almondD(e.xy))) * eyeGate(x); }
/* Inputs: w0 (torso, head, beak, crest), w1 (wing, tail, leg, t), q (cavity, convex, thin, front), x (outward, eyeD, cere), e (eye-local u, v).
   Modelled on a real fire-bird reference: bright amber coverts, red-orange mid wing, the primaries ending in cool
   charcoal (the cold against the fire), golden-cream breast, orange-gold head with a yellow crest, dark horn beak
   with a yellow cere, golden eye with a black pupil, yellow legs with dark claws, tail from gold to red-brown. */
vec3 plumage(vec4 w0, vec4 w1, vec4 q, vec4 x, vec4 e){
  float t = clamp(w1.w, 0.0, 1.0), cav = q.x, cvx = q.y, front = q.w, o = x.x;
  float sh = -0.06 * cav + 0.04 * cvx;                                   // cavity barely moves the hue
  vec3 charcoal = srgbc(54.0, 48.0, 45.0);
  vec3 brownRed = srgbc(96.0, 30.0, 14.0);

  vec3 cTorso = plumeRamp(0.30 + 0.30 * pow(front, 1.3) + sh);          // deep orange sides/back, golden-cream breast
  vec3 cHead  = plumeRamp(0.46 + 0.08 * front + sh);
  vec3 cCrest = plumeRamp(0.54 + 0.30 * t + sh);                        // gold -> yellow tufts
  vec3 cBeak  = mix(charcoal * 1.2, brownRed, 0.25);

  vec3 cWing = plumeRamp(0.52 - 0.20 * smoothstep(0.0, 0.85, t) + sh);  // amber near the shoulder -> red-orange
  float k = clamp(0.70 * o + 0.45 * t, 0.0, 1.0);                        // how far along its own feather
  cWing = mix(cWing, brownRed, smoothstep(0.40, 0.70, k));
  cWing = mix(cWing, charcoal, smoothstep(0.66, 0.94, k));

  vec3 cTail = plumeRamp(0.44 + 0.12 * sin(t * 3.14159) + sh);          // orange root, gold middle
  cTail = mix(cTail, brownRed, smoothstep(0.42, 0.82, t));
  cTail = mix(cTail, charcoal, 0.6 * smoothstep(0.84, 1.0, t));

  vec3 cLeg = mix(plumeRamp(0.60 + sh), plumeRamp(0.80 + sh), smoothstep(0.1, 0.5, t));   // feathered thigh -> yellow foot
  cLeg = mix(cLeg, charcoal, smoothstep(0.62, 0.94, t));                                  // claws

  float tot = w0.x + w0.y + w0.z + w0.w + w1.x + w1.y + w1.z;
  vec3 col = (w0.x * cTorso + w0.y * cHead + w0.z * cBeak + w0.w * cCrest + w1.x * cWing + w1.y * cTail + w1.z * cLeg) / max(tot, 1e-3);
  col *= mix(1.0, 0.68, cav);                                            // ambient occlusion baked into the albedo

  col = mix(col, plumeRamp(0.74), x.z * 0.85 * clamp(w0.y + w0.z, 0.0, 1.0));   // yellow cere at the base of the beak
  float ed = almondD(e.xy), gate = eyeGate(x);
  float lid  = smoothstep(0.90, 1.0, ed) * (1.0 - smoothstep(1.0, 1.35, ed)) * gate;                  // thin dark liner
  // brow: not a slab, just the shadow right above the upper lid, strongest at the lid and fading upward
  float brow = smoothstep(0.36, 0.55, e.y) * (1.0 - smoothstep(0.55, 2.6, e.y))
             * (1.0 - smoothstep(1.0, 2.1, abs(e.x))) * gate * 0.62;
  col *= 1.0 - 0.80 * lid;
  col *= 1.0 - brow;
  vec3 iris = mix(plumeRamp(0.74), plumeRamp(0.84), 1.0 - smoothstep(0.0, 0.9, ed));                 // plain yellow, a touch hotter inside
  col = mix(col, iris, eyeIris(e, x));
  return col;
}`;

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
    // albedo grade (see GRADE_GLSL); uGradeOn 0 = the original texture, untouched
    uPlumeOn: { value: 0 }, uEye: { value: 0.35 }, uDetail: { value: 0 }, uCavity: { value: 1 }, uRough: { value: 0.78 }, uTrans: { value: 0.7 }, uGlow: { value: 0.12 }, uDbg: { value: 0 },
    uGradeOn: { value: 0 }, uHueShift: { value: 4 }, uSatRed: { value: 0.88 }, uValRed: { value: 0.85 }, uValAmber: { value: 1.0 },
  };
}

/* ───────────────────────── 1) mesh: reveal patch on the PBR material ─────────────────────────
   The hero keeps the raw texture (uGradeOn 0; the sky scene grades it, see GRADE_GLSL). Dissolve only decides *which fragments exist*, and the
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
attribute vec4 aW0, aW1, aQ, aX;
varying vec4 vW0, vW1, vQ, vX;
varying vec3 vWPos; varying vec3 vN; varying vec2 vUv; varying float vH;
#include <common>
#include <skinning_pars_vertex>
void main() {
  vUv = uv;
  vW0 = aW0; vW1 = aW1; vQ = aQ; vX = aX;
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
${GRADE_GLSL}
${PLUMAGE_GLSL}
varying vec4 vW0, vW1, vQ, vX;
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
  vec3 albedoRaw = texture2D(uMap, vUv).rgb;
  float luma = dot(albedoRaw, vec3(0.30, 0.59, 0.11));                // flame SHAPE: always from the original texture
  // flame COLOUR: graded hue/saturation, but the original brightness (the fire must stay the brightest thing)
  vec3 albedo;
  if (uPlumeOn > 0.5) {
    albedo = plumage(vW0, vW1, vec4(0.0, vQ.y, vQ.z, vQ.w), vec4(vX.x, 9.0, 0.0, 0.0), vec4(9.0));   // no cavity paint, no eye/cere on flames
    albedo = albedo * 1.1 + 0.03;                                       // flames root in the plumage colour (dark tips = weak fire)
  } else {
    albedo = phxGrade(albedoRaw);
    albedo *= luma / max(dot(albedo, vec3(0.30, 0.59, 0.11)), 1e-3);
  }
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
uniform float uTime, uForm, uSize, uScale, uFade, uBreath, uBirth;
varying vec3 vCol; varying float vA;
float ease(float x){ return x * x * (3.0 - 2.0 * x); }
void main() {
  float f = ease(clamp((uForm - aRand.w * 0.5) / 0.5, 0.0, 1.0));       // per-particle delay
  // birth (driven by the loader): every particle is thrown out of the ember at the origin, hot, and cools into ash
  float b = clamp((uBirth - aRand.w * 0.62) / 0.38, 0.0, 1.0);
  float bo = 1.0 - pow(1.0 - b, 2.2);
  float ang = uTime * (0.035 + 0.05 * aRand.x) + aRand.y * 6.2831;
  vec3 c = (aRand.xyz - 0.5) * vec3(2.5, 1.8, 2.5);
  float cs = cos(ang), sn = sin(ang);
  vec3 sc = vec3(c.x * cs - c.z * sn,
                 c.y + sin(uTime * 0.25 + aRand.z * 6.2831) * 0.10 + uTime * 0.0,
                 c.x * sn + c.z * cs) * bo;
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
  // independent hash: aRand.z is also the z coordinate, so using it here put every big ember on one plane
  float ember = step(0.97, fract(sin(dot(aRand.xy, vec2(12.9898, 78.233))) * 43758.5453));
  gl_PointSize = uSize * (0.55 + aRand.x * 0.9) * (1.0 + ember * 1.6) * (0.45 + 0.55 * bo) * uScale / -mv.z;
  vec3 ash = vec3(0.22, 0.19, 0.17) * (0.7 + aRand.x * 0.7);
  vCol = mix(ash, aColor * 0.9, f);
  float tw = 1.2 + 0.6 * sin(uTime * 4.0 + aRand.x * 30.0);
  vCol = mix(vCol, vec3(1.0, 0.36, 0.07) * tw, ember * (0.55 + 0.45 * f));
  vCol *= 1.0 + tr * 1.1;
  vCol += vec3(1.0, 0.42, 0.09) * pow(1.0 - bo, 1.5) * 2.2 * (1.0 - f);   // newborn sparks are hot
  vA = uFade * (0.28 + 0.72 * f) * smoothstep(0.0, 0.2, b);
}`;

/* ───────────────────────── 4) the ember: the seed the loader is drawn around ─────────────────────────
   One point at the world origin (where the phoenix will form). uFlare blows it up at the hand-over. */
export const EMBER_VERT = /* glsl */`
uniform float uTime, uScale, uSize, uFlare;
void main() {
  vec4 mv = viewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float pulse = 0.8 + 0.2 * sin(uTime * 3.9);
  gl_PointSize = uSize * pulse * (1.0 + uFlare * 16.0) * uScale / -mv.z;
}`;

export const EMBER_FRAG = /* glsl */`
uniform float uAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float core = smoothstep(0.24, 0.0, d);
  float halo = exp(-d * d * 5.0) * smoothstep(1.0, 0.7, d);
  vec3 col = mix(vec3(1.0, 0.30, 0.06), vec3(1.0, 0.82, 0.45), core);
  float a = (core + halo * 0.55) * uAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(col * (1.0 + core * 1.5), a);
}`;

export const ASH_FRAG = /* glsl */`
varying vec3 vCol; varying float vA;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.05, length(c));
  if (a * vA < 0.01) discard;
  gl_FragColor = vec4(vCol, a * vA);
}`;

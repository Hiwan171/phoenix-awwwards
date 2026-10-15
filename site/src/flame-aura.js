// Flame aura: fluid flame tongues rising off the phoenix's SILHOUETTE (the detailing of the Noomo "storytelling" finale).
// It is a screen-space effect, not geometry, in three cheap stages:
//   1. MASK   the phoenix alone, white on black, at half resolution (camera layer 1 + override material);
//   2. FLAME  at half resolution, every pixel walks DOWN the mask (flames rise, so the source is below) along a path
//             sheared by a flow field; coverage has to beat a moving noise threshold, so it breaks into separate licks;
//   3. COMPOSITE (full resolution, inside the composer) adds the flame behind the bird + a thin hot rim on her edge.
// Cost design (measured: the first single-pass version at full res took the scene from ~100-340 fps to ~25):
//   * noise comes from a 256x256 texture with the smoothstep-interpolation trick, never from hashes in the loop;
//   * the flow field is evaluated ONCE per pixel (two heights, interpolated along the path), not once per step;
//   * the expensive part runs at half resolution (the flames are soft anyway).
// Usage:  const aura = createFlameAura({ renderer, scene, camera, composer, objects: [skinnedMesh] });
//         per frame, BEFORE composer.render():  aura.update(time)       on resize: aura.setSize(w, h)
import * as THREE from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

const QUAD_VERT = /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const NOISE_GLSL = /* glsl */`
uniform sampler2D tNoise;
float vn(vec2 p){                                   // smooth value noise: smoothstep trick on a bilinear texture
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return texture2D(tNoise, (i + f + 0.5) * (1.0 / 256.0)).r;
}
float fbm3(vec2 p){ return 0.5 * vn(p) + 0.25 * vn(p * 2.03 + vec2(5.2, 1.7)) + 0.125 * vn(p * 4.11 + vec2(1.3, 9.2)); }
float fbm4(vec2 p){ return fbm3(p) + 0.0625 * vn(p * 8.27 + vec2(7.7, 3.3)); }
`;

// stage 2: flame field -> RGB (premultiplied colour of the flame), at half resolution
const FLAME_FRAG = /* glsl */`
uniform sampler2D tMask;
uniform float uTime, uIntensity, uHeight, uWarp, uAspect, uSteps, uDensity, uDebug;
varying vec2 vUv;
${NOISE_GLSL}
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }

vec3 ramp(float f){                                  // 0 nothing -> deep red -> orange -> yellow
  vec3 c = vec3(0.0);
  c = mix(c, vec3(0.30, 0.02, 0.0), smoothstep(0.02, 0.22, f));
  c = mix(c, vec3(0.95, 0.20, 0.01), smoothstep(0.18, 0.50, f));
  c = mix(c, vec3(1.00, 0.55, 0.08), smoothstep(0.45, 0.85, f));
  c = mix(c, vec3(1.00, 0.86, 0.45), smoothstep(0.88, 1.25, f));
  return c;
}

void main() {
  float m0 = texture2D(tMask, vUv).r;
  vec2 q = vec2(vUv.x * uAspect, vUv.y);

  // per-column height: some tongues leap far above the body, others stay short
  float colN = fbm3(vec2(q.x * 5.0, uTime * 0.18)) * 0.65 + fbm3(vec2(q.x * 17.0 + 3.1, uTime * 0.35)) * 0.35;
  float flick = fbm3(vec2(q.x * 9.0, uTime * 0.9 + 7.0));
  float H = uHeight * (0.40 + 1.15 * colN) * (0.70 + 0.65 * flick);

  // flow field, once per pixel: sway at the pixel and at the end of its path, braid once
  float swayA = fbm3(vec2(q.x * 3.0, q.y * 1.8 - uTime * 0.5)) - 0.4375;
  float swayB = fbm3(vec2(q.x * 3.0 + 1.2, (q.y - H) * 1.8 - uTime * 0.5)) - 0.4375;
  float braid = fbm3(vec2(q.x * 20.0 + swayA * 4.0, q.y * 5.5 - uTime * 1.8)) - 0.4375;

  float jit = h21(gl_FragCoord.xy);                  // breaks the sampling terraces into fine grain
  float cov = 0.0, wsum = 0.0;
  for (int i = 0; i < 24; i++) {
    if (float(i) >= uSteps) break;
    float k = min((float(i) + jit) / uSteps, 1.0);   // 0 at the pixel, 1 at the end of the flame height
    float sway = mix(swayA, swayB, k);
    vec2 p = vUv;
    p.x += (sway * 0.50 + braid * 0.18) * uWarp * (0.15 + k);
    p.y -= k * H;
    float w = pow(max(1.0 - k, 0.0), 1.15);          // k can land a hair above 1: pow(<0) is NaN
    cov += texture2D(tMask, p).r * w; wsum += w;
  }
  cov = cov / max(wsum, 1e-3) * uDensity;

  // ragged tongue edges: coverage has to beat a moving noise threshold
  // meander: the whole noise domain is pushed sideways by a slow flow that varies with height AND time, so each tongue
  // snakes left/right as it climbs instead of standing as a straight pillar
  float wob = (fbm3(vec2(q.y * 2.2 - uTime * 0.6, q.x * 1.1 + 4.0)) - 0.4375) * 0.55 * uWarp
            + (fbm3(vec2(q.y * 6.0 - uTime * 1.4, q.x * 3.0)) - 0.4375) * 0.16 * uWarp;
  float wx = q.x + wob;
  float n1 = fbm4(vec2(wx * 15.0, q.y * 1.1 - uTime * 1.2));                  // long licks
  float n2 = fbm4(vec2(wx * 46.0 + n1 * 2.5, q.y * 2.8 - uTime * 2.1));       // fine streaks
  float n3 = fbm3(vec2(wx * 120.0 + n2 * 3.0, q.y * 6.0 - uTime * 3.2));      // hair
  float tongue = clamp((n1 * 0.55 + n2 * 0.30 + n3 * 0.15 * 1.6) / 0.93, 0.0, 1.0);
  float f = clamp((cov - (1.0 - tongue) * 0.74) / 0.26, 0.0, 1.0);
  f *= 0.50 + 0.60 * tongue;
  f *= 0.90 + 0.10 * sin(f * 22.0 + tongue * 7.0 - uTime * 1.6);     // flowing contour bands

  if (uDebug > 0.5 && uDebug < 1.5) { gl_FragColor = vec4(vec3(m0), 1.0); return; }
  if (uDebug > 1.5 && uDebug < 2.5) { gl_FragColor = vec4(vec3(f), 1.0); return; }
  if (uDebug > 2.5 && uDebug < 3.5) { gl_FragColor = vec4(vec3(cov), 1.0); return; }
  if (uDebug > 3.5) { gl_FragColor = vec4(vec3(tongue), 1.0); return; }

  // brightest right at the silhouette (cov close to 1), cooling to red as it climbs away
  vec3 fire = ramp(f * (0.62 + 0.30 * smoothstep(0.55, 1.0, cov))) * uIntensity * (0.55 + 0.45 * f);
  if (!(fire.r >= 0.0 && fire.g >= 0.0 && fire.b >= 0.0)) fire = vec3(0.0);   // NaN guard
  // alpha = how much of the sky this flame hides (used by the composite when the background is bright)
  float alpha = smoothstep(0.03, 0.35, f) * clamp(uIntensity, 0.0, 1.0);
  gl_FragColor = vec4(min(fire, vec3(8.0)), alpha);
}`;

// stage 3: composite in the composer chain (full resolution)
const COMP_FRAG = /* glsl */`
uniform sampler2D tDiffuse, tMask, tFlame;
uniform float uRim, uDebug, uOpaque;                 // uOpaque: 0 = additive (dark bg), 1 = flames cover the sky (bright bg)
uniform vec2 uTexel;                                 // 1 / mask size
varying vec2 vUv;
void main() {
  vec4 base = texture2D(tDiffuse, vUv);
  if (uDebug > 0.5) { gl_FragColor = vec4(texture2D(tFlame, vUv).rgb, 1.0); return; }
  float m0 = texture2D(tMask, vUv).r;
  // 5-tap soft sample of the half-res flame: hides the per-pixel jitter grain and the 2x upsampling
  vec2 o = uTexel * 0.9;
  vec4 fl4 = texture2D(tFlame, vUv) * 0.36
          + (texture2D(tFlame, vUv + vec2(o.x, o.y)) + texture2D(tFlame, vUv + vec2(-o.x, o.y))
           + texture2D(tFlame, vUv + vec2(o.x, -o.y)) + texture2D(tFlame, vUv + vec2(-o.x, -o.y))) * 0.16;
  vec3 fire = fl4.rgb * (1.0 - m0);
  // bright sky: lay the flame OVER it (additive orange on a golden sky is invisible), keeping a little additive glow
  float cover = fl4.a * (1.0 - m0) * uOpaque;
  vec3 baseCol = mix(base.rgb, base.rgb * 0.25, cover);
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
  gl_FragColor = vec4(baseCol + min(fire, vec3(8.0)), base.a);
}`;

function makeNoiseTexture() {
  const data = new Uint8Array(256 * 256 * 4);
  let seed = 1337; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < data.length; i++) data[i] = (rnd() * 255) | 0;
  const tex = new THREE.DataTexture(data, 256, 256, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false; tex.needsUpdate = true;
  return tex;
}

export function createFlameAura({ renderer, scene, camera, composer, objects, scale = 0.5, insertAt = 1, params = {} }) {
  const size = new THREE.Vector2();
  renderer.getDrawingBufferSize(size);
  const W = Math.max(2, Math.round(size.x * scale)), H = Math.max(2, Math.round(size.y * scale));
  const maskRT = new THREE.WebGLRenderTarget(W, H, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true, type: THREE.UnsignedByteType });
  const flameRT = new THREE.WebGLRenderTarget(W, H, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, type: THREE.HalfFloatType });
  const maskMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  for (const o of objects) o.layers.enable(1);               // layer 1 = "this belongs to the flame mask"
  const noise = makeNoiseTexture();

  const flameUniforms = {
    tMask: { value: maskRT.texture }, tNoise: { value: noise },
    uTime: { value: 0 }, uIntensity: { value: params.intensity ?? 1.0 }, uHeight: { value: params.height ?? 0.36 },
    uWarp: { value: params.warp ?? 1.0 }, uAspect: { value: innerWidth / innerHeight },
    uSteps: { value: params.steps ?? 20 }, uDensity: { value: params.density ?? 1.0 }, uDebug: { value: params.debug ?? 0 },
  };
  const flameMat = new THREE.ShaderMaterial({ uniforms: flameUniforms, vertexShader: QUAD_VERT, fragmentShader: FLAME_FRAG, depthTest: false, depthWrite: false });
  const flameQuad = new FullScreenQuad(flameMat);

  const compUniforms = {
    tDiffuse: { value: null }, tMask: { value: maskRT.texture }, tFlame: { value: flameRT.texture },
    uRim: { value: params.rim ?? 0.5 }, uOpaque: { value: params.opaque ?? 0 }, uDebug: { value: params.debug ? 1 : 0 }, uTexel: { value: new THREE.Vector2(1 / W, 1 / H) },
  };
  // a ShaderMaterial, NOT a plain shader object: ShaderPass clones plain uniforms and a render-target texture clones to null
  const pass = new ShaderPass(new THREE.ShaderMaterial({ uniforms: compUniforms, vertexShader: QUAD_VERT, fragmentShader: COMP_FRAG, depthTest: false, depthWrite: false }));
  composer.insertPass(pass, insertAt);

  const prevClear = new THREE.Color();
  function renderMask() {
    const prevRT = renderer.getRenderTarget(), prevAlpha = renderer.getClearAlpha(), prevMask = camera.layers.mask;
    const prevOverride = scene.overrideMaterial, prevBg = scene.background;
    renderer.getClearColor(prevClear);
    scene.overrideMaterial = maskMat; scene.background = null;
    camera.layers.set(1);
    renderer.setClearColor(0x000000, 1);
    renderer.setRenderTarget(maskRT); renderer.clear(); renderer.render(scene, camera);
    camera.layers.mask = prevMask; scene.overrideMaterial = prevOverride; scene.background = prevBg;
    // flame field
    renderer.setRenderTarget(flameRT); flameQuad.render(renderer);
    renderer.setRenderTarget(prevRT);
    renderer.setClearColor(prevClear, prevAlpha);
  }

  return {
    pass, uniforms: flameUniforms, compUniforms,
    update(time) { flameUniforms.uTime.value = time; if (pass.enabled) renderMask(); },
    setSize(w, h) {
      const rw = Math.max(2, Math.round(w * scale)), rh = Math.max(2, Math.round(h * scale));
      maskRT.setSize(rw, rh); flameRT.setSize(rw, rh);
      compUniforms.uTexel.value.set(1 / rw, 1 / rh);
      flameUniforms.uAspect.value = w / h;
    },
    set enabled(v) { pass.enabled = v; },
    get enabled() { return pass.enabled; },
  };
}

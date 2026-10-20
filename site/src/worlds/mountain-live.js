// mountain1 LIVE: the Shadertoy shader itself (S. Guillitte 2021, fddSzl, field after Yonatan; CC BY-NC-SA 3.0), rendered every
// frame from OUR camera into a reduced-resolution target. Its maths are unchanged (field, glow accumulation, log tone); only:
//   * the ray comes from our camera (world -> shader units: x/K + FIELD_O.x, (y - Y0)/KY, z/K + FIELD_O.z);
//   * the march starts at the camera (the original starts 2.5 units out: its camera was far above the peaks);
//   * the field's origin cone is sunk (as in mountain-world.js);
//   * octaves far below the pixel footprint are skipped (they add a constant-ish bias there, measured: invisible), for speed;
//   * a grade (darker, colder: the user wants it sombre) is applied where the texture is read, not here.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// the 13 octaves' rotations are constants: precomputed (the original takes cos/sin of s at every octave of every step)
const OCT = []; for (let s = 2; s < 800; s *= 1.6) OCT.push(s);
const ROTS = OCT.map((s) => `mat2(${Math.cos(s).toFixed(8)}, ${Math.sin(s).toFixed(8)}, ${(-Math.sin(s)).toFixed(8)}, ${Math.cos(s).toFixed(8)})`).join(', ');
const SS = OCT.map((s) => s.toFixed(6)).join(', ');
const FRAG = /* glsl */`
precision highp float;
out vec4 stOut;
uniform vec3 uCamS, uScaleS;
uniform mat4 uInvProj, uCamWorld;
uniform float uPix, uStart, uLod, uSteps, uStall;
in vec2 vUv;
mat2 rot(float a) { return mat2(cos(a), sin(a), -sin(a), cos(a)); }
// the original field; LOD: an octave is dropped when its wavelength is far below the footprint fp (shader units)
const mat2 R[${OCT.length}] = mat2[](${ROTS});
const float S[${OCT.length}] = float[](${SS});
vec2 field(in vec3 p, float fp) {
  vec2 p0 = p.xz;
  float e, f, o;
  e = f = p.y;
  for (int i = 0; i < ${OCT.length}; i++) {
    float s = S[i];
    if (6.2832 / s < fp * uLod) break;
    p.xz *= R[i];
    vec3 a = sin(p * s); vec2 b = sin(p.xz * (s * 0.5));
    e += abs(a.x + a.y + a.z) * 0.4 / s;
    f += abs(b.x + b.y) / s;
  }
  float tk = max(0.0, 1.0 - length(p0) / 0.35); f += 0.6 * tk * tk * (3.0 - 2.0 * tk);   // the origin cone, sunk
  o = 1.0 + (f > 0.001 ? e : -exp(-f * f));
  return vec2(max(o, 0.0), min(f, max(e, 0.07)));
}
// the original march is 100 steps, dt x1.03 per step, an exponential average of 0.95. With N steps the same distances are
// covered (dt grows by 1.03^(100/N), starting at the matching size) and the average keeps the same memory in distance
vec3 raycast(in vec3 ro, vec3 rd) {
  float k = 100.0 / uSteps, g = pow(1.03, k);
  float t = uStart, dt = 0.035 * (g - 1.0) / 0.03;
  float a = pow(0.95, k), b = 0.09 * (1.0 - a) / 0.05;
  vec3 col = vec3(0.0);
  for (int i = 0; i < 100; i++) {
    if (float(i) >= uSteps) break;
    vec2 v = field(ro + t * rd, t * uPix);
    float c = v.x, f = v.y;
    t += dt * f;
    dt *= g;
    col = a * col + b * vec3(c * c * c, c * c, c);
    // stalled at the rock (the step shrinks with f, the ray creeps but never advances): every remaining sample is inside, c ~ 0,
    // so the rest of the average is closed-form (identical result, the remaining steps are skipped)
    if (f < uStall) { col *= pow(a, uSteps - float(i) - 1.0); break; }
  }
  return col;
}
void main() {
  vec4 v = uInvProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0); v /= v.w;
  vec3 dW = normalize((uCamWorld * vec4(v.xyz, 0.0)).xyz);
  vec3 rd = normalize(dW * uScaleS);
  vec3 col = raycast(uCamS, rd);
  col = 0.5 * log(1.0 + col);
  stOut = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

// Progressive refinement: while the camera moves (the visitor is scrolling) the shader runs at the low resolution `scale`; when
// it stops, a HIGH resolution copy is filled band by band (a few ms a frame) and faded in. On a scroll-driven page the camera
// rests most of the time, so what is looked at is sharp.
export function createMountainLive({ K, KY, Y0, FIELD_O, scale = 0.25, hiScale = 0.6, bands = 12 }) {
  const opts = { type: THREE.UnsignedByteType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
  const lo = new THREE.WebGLRenderTarget(2, 2, opts), hi = new THREE.WebGLRenderTarget(2, 2, opts);
  const U = {
    uCamS: { value: new THREE.Vector3() }, uScaleS: { value: new THREE.Vector3(1 / K, 1 / KY, 1 / K) },
    uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uPix: { value: 0.002 }, uStart: { value: 0.0 }, uLod: { value: +(globalThis.location ? new URLSearchParams(location.search).get('lod') ?? 0.8 : 0.8) }, uSteps: { value: +(globalThis.location ? new URLSearchParams(location.search).get('steps2') ?? 100 : 100) }, uStall: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms: U, vertexShader: 'out vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }', fragmentShader: FRAG, depthTest: false, depthWrite: false });
  const quad = new FullScreenQuad(mat);
  const size = new THREE.Vector2();
  let sc = scale, hsc = hiScale, sig = '', band = 0, mix = 0;
  const out = { lo: lo.texture, hi: hi.texture, mix: 0 };
  function setCamera(camera, h) {
    const p = camera.position;
    U.uCamS.value.set(p.x / K + FIELD_O.x, (p.y - Y0) / KY, p.z / K + FIELD_O.z);
    U.uInvProj.value.copy(camera.projectionMatrixInverse); U.uCamWorld.value.copy(camera.matrixWorld);
    U.uPix.value = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / h;     // one pixel of the target, in radians
  }
  return {
    out, _u: U,
    get scale() { return sc; }, set scale(v) { sc = v; },
    get hiScale() { return hsc; }, set hiScale(v) { hsc = v; sig = ''; },
    render(renderer, camera) {
      renderer.getDrawingBufferSize(size);
      camera.updateMatrixWorld();
      const e = camera.matrixWorld.elements, s2 = e.map((x) => x.toFixed(4)).join(',') + camera.fov.toFixed(3) + size.x + 'x' + size.y;
      const prev = renderer.getRenderTarget();
      if (s2 !== sig) {                                   // moving: the low resolution, every frame; the high one starts over
        sig = s2; band = 0; mix = 0;
        const w = Math.max(2, Math.round(size.x * sc)), h = Math.max(2, Math.round(size.y * sc));
        if (lo.width !== w || lo.height !== h) lo.setSize(w, h);
        setCamera(camera, h);
        renderer.setRenderTarget(lo); quad.render(renderer);
      } else if (band < bands) {                          // resting: one band of the high resolution a frame
        const w = Math.max(2, Math.round(size.x * hsc)), h = Math.max(2, Math.round(size.y * hsc));
        if (hi.width !== w || hi.height !== h) hi.setSize(w, h);
        setCamera(camera, h);
        const y0 = Math.floor((band * h) / bands), y1 = Math.floor(((band + 1) * h) / bands);
        hi.scissor.set(0, y0, w, y1 - y0); hi.scissorTest = true;      // (read by setRenderTarget)
        renderer.setRenderTarget(hi);
        quad.render(renderer);
        hi.scissorTest = false;
        band++;
      } else mix = Math.min(1, mix + 0.12);               // complete: fade it in
      renderer.setRenderTarget(prev);
      out.mix = mix;
    },
    /** render the high resolution at once (QA / screenshots) */
    settle(renderer, camera) { for (let i = 0; i < bands + 12; i++) this.render(renderer, camera); },
  };
}

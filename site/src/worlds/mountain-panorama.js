// The far world of the opening: "clouds / mountains combined field" from the Shadertoy shader by S. Guillitte (2021),
// https://www.shadertoy.com/view/fddSzl  (field after Yonatan). Licence: Creative Commons Attribution-NonCommercial-ShareAlike 3.0.
// Our adaptation (equirectangular baking, our sky and sun on top) is under the same licence; credit the author on the site.
//
// The shader costs ~215 ms a frame at 1280x720 on an Intel UHD (100 steps x 13 octaves), far beyond a real-time budget. The far
// world has no visible parallax over the metres the camera travels, so it is rendered ONCE at load as panoramas (the lower
// hemisphere and a little above the horizon, equirectangular) at a few camera heights, in strips over several frames (the loader
// shows the progress). At run time the sky shader reads them: one texture lookup.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// ── the original field and march (unchanged maths) ──
const FIELD = /* glsl */`
mat2 rot(float a) { return mat2(cos(a), sin(a), -sin(a), cos(a)); }
vec2 field(in vec3 p) {
  vec3 l = vec3(1.0);
  float s = 2.0, e, f, o;
  for (e = f = p.y; s < 8e2; s *= 1.6)
    p.xz *= rot(s),
    e += abs(dot(sin(p * s) / s, 0.4 * l)),
    f += abs(dot(sin(p.xz * s * 0.5) / s, l.xz));
  o = 1.0 + (f > 0.001 ? e : -exp(-f * f));
  return vec2(max(o, 0.0), min(f, max(e, 0.07)));
}
vec3 raycast(in vec3 ro, vec3 rd) {
  float t = 2.5, dt = 0.035;
  vec3 col = vec3(0.0);
  for (int i = 0; i < 100; i++) {
    vec2 v = field(ro + t * rd);
    float c = v.x, f = v.y;
    t += dt * f;
    dt *= 1.03;
    col = 0.95 * col + 0.09 * vec3(c * c * c, c * c, c);
  }
  return col;
}`;

export const PANO_LAT_TOP = 0.16;          // the panoramas cover latitudes -90 deg .. +9 deg (the rest is our own sky)

const BAKE_FRAG = /* glsl */`
uniform float uH, uX; uniform vec2 uSize;
${FIELD}
void main() {
  vec2 q = gl_FragCoord.xy / uSize;
  float lon = (q.x - 0.5) * 6.2831853, lat = mix(-1.5707963, ${PANO_LAT_TOP.toFixed(4)}, q.y);
  vec3 rd = vec3(cos(lat) * sin(lon), sin(lat), -cos(lat) * cos(lon));
  vec3 col = raycast(vec3(uX, uH, 0.0), rd);
  col = 0.5 * log(1.0 + col);
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

/**
 * Bakes one panorama per height (shader units: ~0.6 among the cloud tops, ~1.2 high above them).
 * @returns Promise<THREE.Texture[]>
 */
export async function bakeMountainPanoramas(renderer, { heights = [0.6, 1.2], width = 3072, x = 0, onProgress = () => {}, rowsPerFrame = 48 } = {}) {
  const height = Math.round(width * (Math.PI / 2 + PANO_LAT_TOP) / (2 * Math.PI));
  const mat = new THREE.ShaderMaterial({ uniforms: { uH: { value: 0 }, uX: { value: x }, uSize: { value: new THREE.Vector2(width, height) } },
    vertexShader: 'void main(){ gl_Position = vec4(position.xy * 2.0, 0.0, 1.0); }', fragmentShader: BAKE_FRAG, depthTest: false, depthWrite: false });
  const quad = new FullScreenQuad(mat);
  const out = [], total = heights.length * Math.ceil(height / rowsPerFrame);
  let done = 0;
  const prevTarget = renderer.getRenderTarget(), prevScissor = renderer.getScissorTest();
  for (const h of heights) {
    const rt = new THREE.WebGLRenderTarget(width, height, { type: THREE.UnsignedByteType, depthBuffer: false, generateMipmaps: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping });
    mat.uniforms.uH.value = h;
    for (let y = 0; y < height; y += rowsPerFrame) {
      renderer.setRenderTarget(rt);
      renderer.setScissorTest(true);
      renderer.setScissor(0, y, width, Math.min(rowsPerFrame, height - y));
      quad.render(renderer);
      renderer.setScissorTest(false);
      renderer.setRenderTarget(prevTarget);
      onProgress(++done / total);
      await new Promise((r) => requestAnimationFrame(r));          // one strip a frame: the page stays responsive
    }
    rt.texture.wrapS = THREE.RepeatWrapping;
    out.push(rt.texture);
  }
  renderer.setScissorTest(prevScissor);
  quad.dispose(); mat.dispose();
  return out;
}

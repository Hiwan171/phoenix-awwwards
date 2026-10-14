// Runs any Shadertoy "Image" pass (mainImage) as a scene background, rendered at a reduced
// resolution into a render target and composited behind the phoenix. No Shadertoy API needed.
import * as THREE from 'three';

const PRE = /* glsl */`
precision highp float;
uniform vec3 iResolution; uniform float iTime, iTimeDelta; uniform int iFrame; uniform vec4 iMouse;
uniform sampler2D iChannel0, iChannel1, iChannel2, iChannel3;
uniform vec3 iChannelResolution[4]; uniform vec4 iDate; uniform float iSampleRate;
`;
const POST = /* glsl */`
void main() { vec4 c = vec4(0.0); mainImage(c, gl_FragCoord.xy); gl_FragColor = vec4(c.rgb, 1.0); }
`;

export function createToySky({ source, scale = 0.5, gamma = true, renderer }) {
  // 256² noise stand-in for iChannelN (Shadertoy's own textures are not bundled)
  const data = new Uint8Array(256 * 256 * 4);
  let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < data.length; i++) data[i] = (rnd() * 255) | 0;
  // many Shadertoy shaders sample (uv + (37,17)*z) and read .yx: bake G(uv) = R(uv - (37,17)); the shader reads .yx = (G,R), so mix(G,R,f.z) walks from layer z to z+1 continuously
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    data[(y * 256 + x) * 4 + 1] = data[(((y - 17) & 255) * 256 + ((x - 37) & 255)) * 4];
  }
  const noise = new THREE.DataTexture(data, 256, 256, THREE.RGBAFormat);
  noise.wrapS = noise.wrapT = THREE.RepeatWrapping; noise.minFilter = noise.magFilter = THREE.LinearFilter; noise.needsUpdate = true;

  const rt = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, depthBuffer: false });
  const u = {
    iResolution: { value: new THREE.Vector3(2, 2, 1) }, iTime: { value: 0 }, iTimeDelta: { value: 0.016 }, iFrame: { value: 0 },
    iMouse: { value: new THREE.Vector4() }, iDate: { value: new THREE.Vector4() }, iSampleRate: { value: 44100 },
    iChannel0: { value: noise }, iChannel1: { value: noise }, iChannel2: { value: noise }, iChannel3: { value: noise },
    iChannelResolution: { value: [0, 1, 2, 3].map(() => new THREE.Vector3(256, 256, 1)) },
  };
  const toyMat = new THREE.ShaderMaterial({
    uniforms: u, glslVersion: THREE.GLSL1,
    vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: PRE + source.replaceAll('texture(', 'texture2D(') + POST, depthTest: false, depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), toyMat); quad.frustumCulled = false;
  const toyScene = new THREE.Scene(); toyScene.add(quad);
  const toyCam = new THREE.Camera();

  // the visible background: samples the render target, un-gammas it (Shadertoy outputs display values)
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: { uTex: { value: rt.texture }, uGamma: { value: gamma ? 1 : 0 }, uVig: { value: 0.55 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 1.0, 1.0); }',
    fragmentShader: 'uniform sampler2D uTex; uniform float uGamma, uVig; varying vec2 vUv;' +
      'void main(){ vec3 c = texture2D(uTex, vUv).rgb; if (uGamma > 0.5) c = pow(max(c, 0.0), vec3(2.2));' +
      ' vec2 q = vUv - 0.5; c *= 1.0 - uVig * smoothstep(0.25, 0.85, dot(q * vec2(1.0, 1.15), q * vec2(1.0, 1.15)) * 2.6);' +
      ' if (!(c.r >= 0.0 && c.g >= 0.0 && c.b >= 0.0)) c = vec3(0.0); gl_FragColor = vec4(min(c, vec3(32.0)), 1.0); }',
    depthTest: false, depthWrite: false,
  }));
  bg.frustumCulled = false; bg.renderOrder = -1000;

  let frame = 0;
  function resize(w, h, dpr) {
    const rw = Math.max(2, Math.round(w * dpr * scale)), rh = Math.max(2, Math.round(h * dpr * scale));
    rt.setSize(rw, rh); u.iResolution.value.set(rw, rh, 1);
  }
  function render(time, dt, mouse) {
    u.iTime.value = time; u.iTimeDelta.value = dt; u.iFrame.value = frame++;
    if (mouse) u.iMouse.value.set(mouse.x, mouse.y, mouse.z ?? 0, mouse.w ?? 0);
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(rt); renderer.render(toyScene, toyCam); renderer.setRenderTarget(prev);
  }
  return { mesh: bg, resize, render, uniforms: u };
}

// Runs a Shadertoy "Image" shader from /shaders/<name>.glsl to judge its look and cost on this machine.
//   /st-lab.html?s=mountain1&scale=0.5     scale = render resolution (the canvas is stretched)
//   iChannel0..3: a mipmapped RGBA noise texture (a stand-in for Shadertoy's noise textures)
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const Q = new URLSearchParams(location.search);
const name = Q.get('s') ?? 'mountain1', scale = +(Q.get('scale') ?? 1);
const src = await (await fetch(`/shaders/${name}.glsl`)).text();
const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('gl'), antialias: false });
renderer.setPixelRatio(scale);
renderer.setSize(innerWidth, innerHeight, false);

// noise texture (like Shadertoy's "RGBA Noise Medium", 256 x 256)
const N = 256, data = new Uint8Array(N * N * 4); let k = 7;
for (let i = 0; i < data.length; i++) { k = (k * 16807) % 2147483647; data[i] = (k & 255); }
const noise = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
noise.wrapS = noise.wrapT = THREE.RepeatWrapping; noise.minFilter = THREE.LinearMipmapLinearFilter; noise.magFilter = THREE.LinearFilter; noise.generateMipmaps = true; noise.needsUpdate = true;

const uniforms = { iResolution: { value: new THREE.Vector3() }, iTime: { value: 0 }, iFrame: { value: 0 }, iMouse: { value: new THREE.Vector4() },
  iChannel0: { value: noise }, iChannel1: { value: noise }, iChannel2: { value: noise }, iChannel3: { value: noise } };
const mat = new THREE.RawShaderMaterial({
  glslVersion: THREE.GLSL3, uniforms,
  vertexShader: 'in vec3 position; void main(){ gl_Position = vec4(position.xy * 2.0, 0.0, 1.0); }',
  fragmentShader: `precision highp float; precision highp int;
uniform vec3 iResolution; uniform float iTime; uniform int iFrame; uniform vec4 iMouse;
uniform sampler2D iChannel0, iChannel1, iChannel2, iChannel3;
out vec4 stOut;
${src}
void main() { vec4 c = vec4(0.0); mainImage(c, gl_FragCoord.xy); stOut = vec4(c.rgb, 1.0); }`,
});
const quad = new FullScreenQuad(mat);
const hud = document.getElementById('hud');
const t0 = performance.now(); let frames = 0, last = t0, acc = [];
function frame(now) {
  const b = renderer.getDrawingBufferSize(new THREE.Vector2());
  uniforms.iResolution.value.set(b.x, b.y, 1); uniforms.iTime.value = (now - t0) / 1000; uniforms.iFrame.value = frames++;
  quad.render(renderer);
  acc.push(now - last); last = now; if (acc.length > 60) acc.shift();
  const m = acc.slice().sort((a, b) => a - b)[acc.length >> 1];
  hud.textContent = `${name}  ${b.x}x${b.y}  ${m.toFixed(1)} ms  ${(1000 / m).toFixed(0)} fps`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.__st = { renderer, quad, uniforms, ready: true, render(t) { uniforms.iTime.value = t; quad.render(renderer); } };

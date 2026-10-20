// Celestial motion for the approved red opening: a fixed star field and sparse, deterministic burning comets.
// Everything lives behind the terrain/bird and uses the existing HDR/bloom pass. No textures or extra full-screen passes.
import * as THREE from 'three';

const TAU = Math.PI * 2;
const hash = (n) => { const x = Math.sin(n * 127.1 + 17.7) * 43758.5453; return x - Math.floor(x); };
const smooth = (a, b, x) => { const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

const STAR_VERTEX = /* glsl */`
attribute vec3 aStar;
uniform float uTime, uPixels;
uniform vec3 uSun;
varying float vLight, vSeed, vHero;
void main() {
  vec3 direction = normalize(position);
  float haze = smoothstep(0.035, 0.25, direction.y);
  float daylight = 1.0 - smoothstep(0.72, 0.98, dot(direction, uSun));
  float pulse = sin(uTime * (0.7 + aStar.x * 0.65) + aStar.x * 83.0);
  float shimmer = sin(uTime * (2.1 + aStar.x) + aStar.x * 123.0);
  vSeed = aStar.x; vHero = step(0.84, aStar.x);
  float breath = mix(0.74 + 0.26 * pulse, 0.30 + 0.70 * pow(0.5 + 0.5 * pulse, 1.4), vHero);
  vLight = aStar.z * haze * daylight * (breath + 0.04 * shimmer);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aStar.y * uPixels;
}`;

const STAR_FRAGMENT = /* glsl */`
varying float vLight, vSeed, vHero;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  float core = exp(-r2 * 70.0);
  float halo = exp(-r2 * 10.0) * 0.075;
  float crossLight = (exp(-abs(p.x) * 70.0 - abs(p.y) * 7.0)
                    + exp(-abs(p.y) * 70.0 - abs(p.x) * 7.0)) * vHero * 0.20;
  vec3 color = mix(vec3(1.0, 0.64, 0.42), vec3(1.0, 0.91, 0.77), vSeed);
  vec3 light = color * (core + halo + crossLight) * vLight;
  if (max(light.r, max(light.g, light.b)) < 0.001) discard;
  gl_FragColor = vec4(light, 1.0);
}`;

const COMET_VERTEX = /* glsl */`
uniform float uLength, uRadius, uWidth, uPad;
varying vec2 vP;
void main() {
  vP = vec2((uv.x * (uLength + uPad) - uPad) / uRadius, (uv.y - 0.5) * uWidth / uRadius);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const COMET_FRAGMENT = /* glsl */`
uniform float uTime, uLength, uRadius, uGain, uSeed;
varying vec2 vP;
float flameHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float flameNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(flameHash(i), flameHash(i + vec2(1, 0)), f.x),
             mix(flameHash(i + vec2(0, 1)), flameHash(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  float x = vP.x, y = vP.y, lengthInRadii = uLength / uRadius;
  float age = clamp(x / lengthInRadii, 0.0, 1.0);
  float n = flameNoise(vec2(x * 0.31 - uTime * 6.5 + uSeed, y * 2.4));
  float fine = flameNoise(vec2(x * 0.89 - uTime * 11.0, y * 5.0 + uSeed));
  float curl = (sin(x * 0.55 - uTime * 8.0 + uSeed) * 0.23
              + sin(x * 1.19 - uTime * 13.0) * 0.09) * sqrt(age);
  float width = 0.55 + 1.65 * sqrt(age) * (1.0 - age * 0.40);
  float across = abs(y - curl) / max(width, 0.01);
  float fade = smoothstep(-0.4, 0.9, x) * (1.0 - smoothstep(0.60, 1.0, age));
  float flame = exp(-across * across * (2.4 + 2.2 * fine)) * (0.35 + n * 0.85) * fade;
  flame *= 1.0 - smoothstep(0.35, 1.65, across + fine * 0.40);
  float spine = exp(-abs(y - curl * 0.55) * 11.0 / (0.35 + age)) * exp(-age * 3.0) * fade;
  float r2 = dot(vP, vP);
  float headNoise = flameNoise(vP * 3.0 + vec2(-uTime * 8.0, uSeed));
  float head = exp(-r2 * (2.8 + headNoise * 1.2));
  float halo = exp(-r2 * 0.14) * 0.22;
  vec3 color = vec3(1.0, 0.16, 0.016) * flame * 3.4
             + vec3(1.0, 0.53, 0.10) * flame * (1.0 - age) * 1.4
             + vec3(1.0, 0.81, 0.43) * spine * 3.0
             + vec3(1.0, 0.91, 0.66) * head * 10.0
             + vec3(1.0, 0.36, 0.055) * halo;
  color *= uGain;
  if (max(color.r, max(color.g, color.b)) < 0.002) discard;
  gl_FragColor = vec4(color, 1.0);
}`;

const SPARK_VERTEX = /* glsl */`
attribute vec3 aSpark;
uniform float uTime, uLength, uRadius, uGain, uPixels;
uniform vec3 uHead, uBack, uSide;
varying float vAge, vLight;
void main() {
  float age = fract(aSpark.x + uTime * (0.20 + aSpark.z * 0.09));
  float spread = age * age * uRadius * 4.0;
  vec3 p = uHead + uBack * age * uLength;
  p += uSide * ((aSpark.y * 2.0 - 1.0) * spread + sin(age * 10.0 + aSpark.x * 30.0) * uRadius * age);
  p.y -= age * age * uRadius * (0.4 + aSpark.z);
  vAge = age;
  vLight = uGain * smoothstep(0.0, 0.07, age) * (1.0 - smoothstep(0.25, 1.0, age));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = uPixels * (1.4 + aSpark.z * 1.7) * (1.0 - age * 0.5);
}`;

const SPARK_FRAGMENT = /* glsl */`
varying float vAge, vLight;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float light = exp(-dot(p, p) * 5.5) * vLight;
  if (light < 0.003) discard;
  vec3 color = mix(vec3(1.0, 0.70, 0.25), vec3(1.0, 0.13, 0.01), vAge);
  gl_FragColor = vec4(color * light * 3.2, 1.0);
}`;

function material(uniforms, vertexShader, fragmentShader) {
  return new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, transparent: true,
    blending: THREE.AdditiveBlending, depthTest: true, depthWrite: false, toneMapped: false });
}

const LANES = [
  { azimuth: -0.48, elevation: 0.36, delay: 1.8, period: 19.4, duration: 8.2, radius: 0.82, length: 27, distance: 260, span: 0.94 },
  { azimuth: 1.10, elevation: 0.41, delay: 10.2, period: 26.3, duration: 8.8, radius: 0.46, length: 22, distance: 290, span: 0.90 },
  { azimuth: 2.85, elevation: 0.32, delay: 5.5, period: 28.1, duration: 9.0, radius: 0.68, length: 31, distance: 245, span: 1.02 },
  { azimuth: -2.03, elevation: 0.45, delay: 15.1, period: 31.7, duration: 7.8, radius: 0.38, length: 19, distance: 310, span: 0.82 },
];

export function createEmberSky({ scene, renderer, sunDirection, lite = false, stars = true, comets = true,
  reducedMotion = false } = {}) {
  const group = new THREE.Group(); group.name = 'Ember sky'; scene.add(group);
  const resources = [];
  const count = stars ? (lite ? 620 : 1000) : 0;
  const positions = new Float32Array(count * 3), attributes = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const seed = hash(i + 0.21), y = 0.035 + hash(i + 1.71) * 0.965, angle = hash(i + 4.19) * TAU;
    const radial = Math.sqrt(1 - y * y) * 340;
    positions.set([Math.cos(angle) * radial, y * 340, Math.sin(angle) * radial], i * 3);
    attributes.set([seed, seed > 0.84 ? 15 + hash(i + 9.7) * 7 : 7 + hash(i + 2.8) * 5,
      seed > 0.84 ? 4.5 + hash(i + 6.7) * 2 : 0.65 + hash(i + 8.3) * 1.15], i * 3);
  }
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  starGeometry.setAttribute('aStar', new THREE.BufferAttribute(attributes, 3));
  const starUniforms = { uTime: { value: 0 }, uPixels: { value: 1 }, uSun: { value: sunDirection.clone() } };
  const starMaterial = material(starUniforms, STAR_VERTEX, STAR_FRAGMENT);
  const starPoints = new THREE.Points(starGeometry, starMaterial); starPoints.frustumCulled = false;
  // Stars have screen-sized cores. Reflection targets must scale them to their
  // own viewport, otherwise the lake magnifies low-resolution white blobs.
  let basePixels = 1;
  const viewportSize = new THREE.Vector2();
  const pixelsForTarget = () => {
    const target = renderer.getRenderTarget();
    renderer.getDrawingBufferSize(viewportSize);
    return basePixels * (target ? target.height / viewportSize.y : 1);
  };
  starPoints.onBeforeRender = () => { starUniforms.uPixels.value = pixelsForTarget(); };
  starPoints.name = 'Pulsing stars'; group.add(starPoints); resources.push(starGeometry, starMaterial);

  const plane = new THREE.PlaneGeometry(1, 1); resources.push(plane);
  const sparkCount = lite ? 22 : 38, sparkGeometry = new THREE.BufferGeometry();
  const seeds = new Float32Array(sparkCount * 3);
  for (let i = 0; i < seeds.length; i++) seeds[i] = hash(i + 12.5);
  sparkGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(sparkCount * 3), 3));
  sparkGeometry.setAttribute('aSpark', new THREE.BufferAttribute(seeds, 3)); resources.push(sparkGeometry);
  const lanes = (comets ? LANES : []).map((spec, i) => {
    const head = new THREE.Vector3(), back = new THREE.Vector3(), side = new THREE.Vector3();
    const uniforms = { uTime: { value: 0 }, uLength: { value: spec.length }, uRadius: { value: spec.radius },
      uWidth: { value: spec.radius * 9 }, uPad: { value: spec.radius * 4 }, uGain: { value: 0 },
      uSeed: { value: i * 19.3 }, uPixels: { value: 1 }, uHead: { value: head }, uBack: { value: back }, uSide: { value: side } };
    const flameMaterial = material(uniforms, COMET_VERTEX, COMET_FRAGMENT);
    const sparkMaterial = material(uniforms, SPARK_VERTEX, SPARK_FRAGMENT);
    const mesh = new THREE.Mesh(plane, flameMaterial); mesh.frustumCulled = false;
    const sparks = new THREE.Points(sparkGeometry, sparkMaterial); sparks.frustumCulled = false;
    sparks.onBeforeRender = () => { uniforms.uPixels.value = pixelsForTarget(); };
    mesh.name = `Burning comet ${i + 1}`; sparks.name = `Comet embers ${i + 1}`;
    group.add(mesh, sparks); resources.push(flameMaterial, sparkMaterial);
    const center = new THREE.Vector3(Math.sin(spec.azimuth) * Math.cos(spec.elevation), Math.sin(spec.elevation), Math.cos(spec.azimuth) * Math.cos(spec.elevation));
    const east = new THREE.Vector3(Math.cos(spec.azimuth), 0, -Math.sin(spec.azimuth));
    const north = new THREE.Vector3(0, 1, 0).addScaledVector(center, -center.y).normalize();
    return { spec, mesh, sparks, uniforms, head, back, side, center, east, north, phase: -1, gain: 0 };
  });
  const next = new THREE.Vector3(), towardCamera = new THREE.Vector3(), normal = new THREE.Vector3(), matrix = new THREE.Matrix4();
  const point = (lane, phase, cycle, target) => {
    const drift = (hash(cycle * 11.3 + lane.spec.azimuth + 2.7) - 0.5) * 0.16;
    return target.copy(lane.center).addScaledVector(lane.east, lane.spec.span * (phase - 0.5) + drift)
      .addScaledVector(lane.north, 0.085 - 0.18 * phase).normalize().multiplyScalar(lane.spec.distance);
  };
  let lastTime = 0;
  function update(time, camera) {
    const t = reducedMotion ? 0 : Math.max(0, Number.isFinite(time) ? time : 0);
    lastTime = t;
    group.position.copy(camera.position);
    const pixels = renderer.getPixelRatio() * Math.pow(Math.max(0.65, renderer.domElement.clientHeight / 900), 0.2);
    basePixels = pixels;
    starUniforms.uTime.value = t; starUniforms.uPixels.value = pixels;
    for (const lane of lanes) {
      const { spec, mesh, sparks, uniforms, head, back, side } = lane;
      const elapsed = t - spec.delay, cycle = Math.max(0, Math.floor(elapsed / spec.period));
      const phase = elapsed < 0 ? -1 : (elapsed - cycle * spec.period) / spec.duration;
      lane.phase = phase;
      const gain = phase >= 0 && phase <= 1 ? smooth(0, 0.12, phase) * (1 - smooth(0.80, 1, phase)) : 0;
      lane.gain = gain;
      mesh.visible = sparks.visible = gain > 0.0001;
      if (!mesh.visible) continue;
      point(lane, phase, cycle, head); point(lane, phase + 0.005, cycle, next);
      back.copy(head).sub(next).normalize();
      towardCamera.copy(head).negate().normalize(); side.crossVectors(towardCamera, back).normalize();
      normal.crossVectors(back, side).normalize(); matrix.makeBasis(back, side, normal);
      mesh.quaternion.setFromRotationMatrix(matrix);
      mesh.position.copy(head).addScaledVector(back, (spec.length - uniforms.uPad.value) * 0.5);
      mesh.scale.set(spec.length + uniforms.uPad.value, uniforms.uWidth.value, 1);
      uniforms.uTime.value = t; uniforms.uGain.value = gain; uniforms.uPixels.value = pixels;
    }
  }
  return {
    update, group,
    diagnostics() { return { time: lastTime, stars: count, reducedMotion,
      comets: lanes.filter((l) => l.gain > 0.0001).map((l) => ({ name: l.mesh.name, phase: l.phase, gain: l.gain,
        position: l.head.toArray(), radius: l.spec.radius, tailLength: l.spec.length })) }; },
    dispose() { group.removeFromParent(); for (const resource of resources) resource.dispose(); },
  };
}

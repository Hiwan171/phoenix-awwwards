// Embers shed by the phoenix: sparks born on her feather tips that stay in the air where she was (so in flight they stream
// behind her as a trail, and perched they rise off her plumes). A classic particle loop on the wall clock: every spark lives
// L seconds; when it is reborn it takes the CURRENT world position of one skinned vertex (CPU skinning of that one vertex only,
// ~count * dt / L vertices a frame), then drifts: buoyancy, a slow swirl, a little scatter. One draw call, additive, HDR
// (the bloom picks the hot ones up).
//
//   const embers = createEmbers({ mesh, count })    scene.add(embers.points)
//   per frame, AFTER the bird is posed:  embers.update(timeSeconds, rate)     rate 0..1 = how many are reborn (0 = they die out)
import * as THREE from 'three';

const VERT = /* glsl */`
attribute float aAge;       // 0 born .. 1 dead (>1 = hidden)
attribute float aSeed;
uniform float uScale, uTime;
varying float vAge, vSeed;
void main() {
  vAge = aAge; vSeed = aSeed;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float flick = 0.75 + 0.25 * sin(uTime * (11.0 + aSeed * 13.0) + aSeed * 40.0);
  float size = (0.018 + 0.03 * aSeed * aSeed) * pow(max(1.0 - aAge, 0.0), 0.6) * flick;
  gl_PointSize = aAge > 1.0 ? 0.0 : size * uScale / max(-mv.z, 0.05);
}`;

const FRAG = /* glsl */`
uniform float uGain;
varying float vAge, vSeed;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  if (r > 1.0) discard;
  float core = pow(1.0 - r, 2.2);
  // white-gold when born, orange, then a dying red
  vec3 c = mix(vec3(1.0, 0.82, 0.45) * 5.0, vec3(1.0, 0.36, 0.05) * 2.6, smoothstep(0.0, 0.35, vAge));
  c = mix(c, vec3(0.55, 0.06, 0.02) * 1.2, smoothstep(0.45, 1.0, vAge));
  float a = smoothstep(0.0, 0.06, vAge) * (1.0 - smoothstep(0.7, 1.0, vAge));
  gl_FragColor = vec4(c * core * a * uGain, 1.0);
}`;

const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

/**
 * @param mesh   the phoenix's SkinnedMesh (needs the aTip attribute: applyFenixLook / buildTipMeshy writes it)
 * @param count  number of sparks
 */
export function createEmbers({ mesh, count = 320, life = [0.7, 2.0] }) {
  const tip = mesh.geometry.attributes.aTip.array;
  // emitters: mostly the outer feathers (tips, plumes, crest), a few from the body
  const outer = [], inner = [];
  for (let i = 0; i < tip.length; i++) { if (tip[i] > 0.6) outer.push(i); else if (tip[i] > 0.25) inner.push(i); }
  const pickVertex = (k) => { const h = hash(k * 1.37 + 0.5); const pool = h < 0.85 || !inner.length ? outer : inner; return pool[Math.floor(hash(k * 2.11 + 9.1) * pool.length) % pool.length]; };

  const pos = new Float32Array(count * 3), age = new Float32Array(count).fill(2), seed = new Float32Array(count);
  const born = new Float32Array(count * 3), vel = new Float32Array(count * 3), t0 = new Float64Array(count), L = new Float32Array(count);
  const spawnN = new Uint32Array(count);
  for (let i = 0; i < count; i++) { seed[i] = hash(i + 0.17); L[i] = life[0] + (life[1] - life[0]) * hash(i * 3.3 + 1.1); t0[i] = -1e9; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aAge', new THREE.BufferAttribute(age, 1).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const uniforms = { uScale: { value: 600 }, uTime: { value: 0 }, uGain: { value: 1 } };
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const points = new THREE.Points(g, mat);
  points.frustumCulled = false;

  const V = new THREE.Vector3();
  let first = true;
  return {
    points, uniforms,
    /** time: seconds (wall clock), rate 0..1: share of the sparks that are reborn when they die */
    update(time, rate = 1, wind = { x: 0.12, z: 0.05 }) {
      uniforms.uTime.value = time;
      mesh.updateMatrixWorld(true);
      for (let i = 0; i < count; i++) {
        let a = (time - t0[i]) / L[i];
        if (first) { t0[i] = time - hash(i * 7.7) * L[i] * 1.2; a = (time - t0[i]) / L[i]; }   // stagger the first generation
        if (a >= 1 || a < 0) {                                         // reborn (or the clock jumped back)
          const k = ++spawnN[i] + i * 7919;
          t0[i] = time;
          a = 0;
          if (hash(k * 0.73 + 3.3) > rate) { age[i] = 2; continue; }    // not reborn this time (low heat)
          mesh.getVertexPosition(pickVertex(k), V).applyMatrix4(mesh.matrixWorld);
          born[i*3] = V.x; born[i*3+1] = V.y; born[i*3+2] = V.z;
          const th = hash(k * 1.9) * Math.PI * 2, s = 0.1 + 0.25 * hash(k * 2.7);
          vel[i*3] = Math.cos(th) * s; vel[i*3+1] = 0.15 + 0.35 * hash(k * 4.1); vel[i*3+2] = Math.sin(th) * s;
        }
        if (age[i] > 1.5 && a > 0) { age[i] = 2; continue; }             // skipped this life
        const t = a * L[i], sw = seed[i] * 40;
        // drift: initial scatter (damped), buoyancy, wind, a slow swirl that widens with age
        const damp = (1 - Math.exp(-2.5 * t)) / 2.5;
        pos[i*3]   = born[i*3]   + vel[i*3] * damp + wind.x * t + Math.sin(t * 2.3 + sw) * 0.06 * t;
        pos[i*3+1] = born[i*3+1] + vel[i*3+1] * damp + 0.22 * t * t;
        pos[i*3+2] = born[i*3+2] + vel[i*3+2] * damp + wind.z * t + Math.cos(t * 1.9 + sw) * 0.06 * t;
        age[i] = a;
      }
      first = false;
      g.attributes.position.needsUpdate = true; g.attributes.aAge.needsUpdate = true;
    },
    setPixelScale(h, fovDeg) { uniforms.uScale.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2)); },
  };
}

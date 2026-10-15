// Fire on the phoenix's own skin: the feather tips burn away into embers (a noise dissolve with a glowing edge).
// It does two jobs: it is the look (the Zhuque, the fire bird), and it hides what the rig cannot: ragged edges, the small
// holes left by the stretch cuts and the hard sheet edge of a fully opened wing become "the feather burning", on purpose.
//
//   buildTip(mesh)         per-vertex `aTip` 0..1 = how far along a feather / plume / crest strand the vertex sits, from the
//                          skin weights (bone m of a chain of n  ->  m / n; body, arm and legs  ->  0)
//   createFireUniforms()   shared uniforms: uTime, uBurn (how much of the tips is eaten), uHeat (ember glow), uDebug
//   fireMaterial(mat, U)   patches a MeshStandardMaterial (dissolve + emissive edge)
//   fireMask(U)            the same dissolve for the flame-aura silhouette mask, so the flames follow what is left of her
//
// The noise is 3D value noise of the REST position (before skinning), so it is glued to the feather and never swims.
import * as THREE from 'three';

const CHAIN = /^((?:Wing_[LR]_F\d+)|(?:Tail_\w+?)|(?:Crest_\w+?))_(\d+|Tip)$/;

/** Writes the `aTip` attribute into the geometry of a skinned mesh. Returns { max } for QA. */
export function buildTip(mesh) {
  const g = mesh.geometry, names = mesh.skeleton.bones.map((b) => b.name);
  const longest = new Map();                                       // chain prefix -> number of numbered bones
  for (const n of names) { const m = CHAIN.exec(n); if (m && m[2] !== 'Tip') longest.set(m[1], Math.max(longest.get(m[1]) ?? 0, +m[2])); }
  const frac = new Float32Array(names.length);
  names.forEach((n, i) => {
    const m = CHAIN.exec(n); if (!m) return;
    const len = longest.get(m[1]) ?? 1;
    frac[i] = m[2] === 'Tip' ? 1 : Math.min(1, +m[2] / (len + 1));
  });
  const si = g.attributes.skinIndex, sw = g.attributes.skinWeight, count = si.count;
  const tip = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    let s = 0, wsum = 0;
    for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); s += w * frac[si.getComponent(i, k)]; wsum += w; }
    tip[i] = wsum > 0 ? s / wsum : 0;
  }
  g.setAttribute('aTip', new THREE.BufferAttribute(tip, 1));
  return { count };
}

// ── the Meshy-rigged phoenix (Bone_NNN + one chain per feather, F_<region>_<n>_<i>) ──
const MESHY_REGIONS = {
  wingA: [36, 35, 34, 50, 49, 60, 59, 62, 61, 53, 52, 51],
  wingB: [39, 38, 37, 55, 54, 64, 63, 66, 65, 58, 57, 56],
  tail: Array.from({ length: 18 }, (_, i) => 14 + i),
  back: [45, 44, 43, 48, 47, 46],
};
/** Same `aTip` attribute for the Meshy rig: a feather chain's joint i of K -> (i + 1) / K; an original wing / tail / back bone ->
 *  its depth inside its region (arms low, outer feather bones high); the body, neck and legs -> 0. */
export function buildTipMeshy(mesh) {
  const g = mesh.geometry, bones = mesh.skeleton.bones;
  const chainLen = new Map();
  for (const b of bones) { const m = /^F_(\w+?)_(\d+)_(\d+)$/.exec(b.name); if (m) { const key = m[1] + '_' + m[2]; chainLen.set(key, Math.max(chainLen.get(key) ?? 0, +m[3] + 1)); } }
  const regionOf = (name) => { const k = +name.replace(/\D/g, ''); if (!/^Bone_/.test(name)) return null; for (const r of Object.keys(MESHY_REGIONS)) if (MESHY_REGIONS[r].includes(k)) return r; return null; };
  const depth = (b, r) => { let d = 0; for (let p = b.parent; p && p.isBone && regionOf(p.name) === r; p = p.parent) d++; return d; };
  const maxDepth = {};
  for (const b of bones) { const r = regionOf(b.name); if (r) maxDepth[r] = Math.max(maxDepth[r] ?? 1, depth(b, r)); }
  const frac = bones.map((b) => {
    const m = /^F_(\w+?)_(\d+)_(\d+)$/.exec(b.name);
    if (m) {                                                    // short chains (small feathers near the body) barely burn
      const K = chainLen.get(m[1] + '_' + m[2]);
      return Math.min(1, (+m[3] + 1) / K) * Math.min(1, Math.max(0, (K - 3) / 4));
    }
    const r = regionOf(b.name);
    return r ? 0.1 + 0.8 * depth(b, r) / maxDepth[r] : 0;
  });
  const si = g.attributes.skinIndex, sw = g.attributes.skinWeight, n = si.count, tip = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0, wsum = 0;
    for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); s += w * frac[si.getComponent(i, k)]; wsum += w; }
    tip[i] = wsum > 0 ? s / wsum : 0;
  }
  g.setAttribute('aTip', new THREE.BufferAttribute(tip, 1));
  return { count: n };
}

export function createFireUniforms(init = {}) {
  return {
    uTime: { value: 0 },
    uBurn: { value: init.burn ?? 0.55 },          // how far the dissolve reaches (0 = none)
    uHeat: { value: init.heat ?? 1 },             // ember glow multiplier (the beat drives it)
    uEdge: { value: init.edge ?? 0.09 },          // width of the glowing band (noise units)
    uFreq: { value: init.freq ?? 9 },             // noise frequency (model units: she is ~1 high)
    uDebug: { value: 0 },                          // 1 = show aTip
  };
}

const NOISE = /* glsl */`
varying float vTip; varying vec3 vFirePos;
uniform float uTime, uBurn, uHeat, uEdge, uFreq, uDebug;
float fireHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float fireNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(fireHash(i), fireHash(i + vec3(1,0,0)), f.x), mix(fireHash(i + vec3(0,1,0)), fireHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(fireHash(i + vec3(0,0,1)), fireHash(i + vec3(1,0,1)), f.x), mix(fireHash(i + vec3(0,1,1)), fireHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
// embers rise: the noise field scrolls DOWN through the feather, so the edge appears to climb
float fireField(vec3 p) {
  vec3 q = p * uFreq + vec3(0.0, uTime * 0.9, 0.0);
  return 0.55 * fireNoise(q) + 0.30 * fireNoise(q * 2.07 + 3.1) + 0.15 * fireNoise(q * 4.3 + 7.7);
}`;

const DISSOLVE = /* glsl */`
  float fireGlow = 0.0;
  if (vTip > 0.5) {
    float n = fireField(vFirePos);
    float thr = pow(smoothstep(0.55, 1.0, vTip), 1.4) * uBurn;
    if (n < thr) discard;
    fireGlow = 1.0 - smoothstep(thr, thr + uEdge, n);
  }`;

function patchVertex(shader) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float aTip; varying float vTip; varying vec3 vFirePos;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTip = aTip; vFirePos = position;');
}

/** MeshStandardMaterial: dissolve the tips + add an ember edge to the emissive term. */
export function fireMaterial(mat, U) {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    patchVertex(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${NOISE}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${DISSOLVE}`)
      .replace('#include <emissivemap_fragment>', /* glsl */`#include <emissivemap_fragment>
        {
          // hot edge: white-yellow right on the cut, orange further in; plus a faint heat on the whole outer feather
          vec3 ember = mix(vec3(1.0, 0.30, 0.04), vec3(1.0, 0.85, 0.40), fireGlow * fireGlow);
          totalEmissiveRadiance += ember * (fireGlow * 2.2 + smoothstep(0.55, 1.0, vTip) * 0.20) * uHeat;
          if (uDebug > 0.5) totalEmissiveRadiance = vec3(vTip);
        }`);
  };
  mat.customProgramCacheKey = () => 'fenix-fire-1';
  mat.needsUpdate = true;
}

/** White mask material for the flame aura, with the same dissolve (so flames do not stand in the burnt-away holes). */
export function fireMask(U) {
  const m = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    patchVertex(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${NOISE}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${DISSOLVE}`);
  };
  m.customProgramCacheKey = () => 'fenix-fire-mask-1';
  return m;
}

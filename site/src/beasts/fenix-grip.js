// The claws grip the ground: on uneven rock, the part of each toe that hangs over a dip curls down until it touches.
// The Meshy rig has ONE bone for all the toes of a foot, so this is done on the vertices, after skinning:
//   1. the foot's vertices are skinned on the CPU (bone-space table, as in the scene's contact code) and binned in 1 cm columns;
//      a column's SOLE is its lowest vertex, its gap = sole - ground (the rendered terrain);
//   2. every vertex comes down by the gap of its column (min over the 3 x 3 neighbourhood, so the claw keeps its thickness and no
//      vertex goes below the rock), weighted along the foot: nothing at the foot joint, full at the claw tips, and on an ARC about
//      the foot joint (its distance to the joint is kept): the toe curls like a claw closing on the rock, it is not stretched;
//   3. the offsets go into a small float texture (one texel per foot vertex), read by the vertex shader right after skinning.
// The texture is re-uploaded only when the feet moved (a perched bird costs nothing).
//
//   const grip = createFootGrip({ mesh, feet: [['Bone_004','Bone_003','Bone_002'], [...]], joints: ['Bone_003','Bone_010'], surfaceAt })
//   per frame, after the bird is posed and its world matrices are up to date:  grip.update(groundWeight)
import * as THREE from 'three';

const SIZE = 64;                       // texture side: up to 4096 foot vertices

export function createFootGrip({ mesh, feet, joints, surfaceAt, maxPull = 0.06, eps = 0.004, cell = 0.01 }) {
  const g = mesh.geometry, pos = g.attributes.position, si = g.attributes.skinIndex, sw = g.attributes.skinWeight, sk = mesh.skeleton;
  const names = sk.bones.map((b) => b.name);
  // the vertices of each foot (dominant joint), their slots, and their influences in bone space
  const slotAttr = new Float32Array(pos.count).fill(-1), legs = [];
  let slot = 0;
  mesh.updateMatrixWorld(true);
  const p = new THREE.Vector3();
  feet.forEach((nm, li) => {
    const set = new Set(nm.map((n) => names.indexOf(n))), idx = [];
    for (let i = 0; i < pos.count; i++) { let b = 0, w = -1; for (let k = 0; k < 4; k++) { const ww = sw.getComponent(i, k); if (ww > w) { w = ww; b = si.getComponent(i, k); } } if (set.has(b) && slot < SIZE * SIZE) { idx.push(i); slotAttr[i] = slot++; } }
    const bone = [], w = [], q = [], start = [0];
    for (const i of idx) {
      for (let k = 0; k < 4; k++) { const ww = sw.getComponent(i, k); if (ww <= 0) continue; const b = si.getComponent(i, k);
        p.fromBufferAttribute(pos, i).applyMatrix4(mesh.bindMatrix).applyMatrix4(sk.boneInverses[b]); bone.push(b); w.push(ww); q.push(p.x, p.y, p.z); }
      start.push(bone.length);
    }
    legs.push({ idx, slot0: slotAttr[idx[0]], bone, w, q, start, joint: sk.bones[names.indexOf(joints[li])], X: new Float32Array(idx.length), Y: new Float32Array(idx.length), Z: new Float32Array(idx.length) });
  });
  g.setAttribute('aGrip', new THREE.BufferAttribute(slotAttr, 1));
  const data = new Float32Array(SIZE * SIZE * 4);
  const tex = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.needsUpdate = true;

  // the shader: right after skinning (mesh-local space)
  const material = mesh.material, prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer);
    shader.uniforms.uGrip = { value: tex };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGrip; uniform highp sampler2D uGrip;')
      .replace('#include <skinning_vertex>', `#include <skinning_vertex>
        if (aGrip >= 0.0) { int gs = int(aGrip + 0.5); transformed += texelFetch(uGrip, ivec2(gs % ${SIZE}, gs / ${SIZE}), 0).xyz; }`);
  };
  material.customProgramCacheKey = ((old) => () => (old ? old() : '') + '|grip1')(material.customProgramCacheKey?.bind(material));
  material.needsUpdate = true;

  const inv = new THREE.Matrix4(), m3 = new THREE.Matrix3(), J = new THREE.Vector3(), W = new THREE.Vector3();
  const cols = new Map();
  let lastKey = '', zeroed = true;
  const key = (x, z) => Math.floor(x / cell) * 100003 + Math.floor(z / cell);

  return {
    texture: tex,
    /** gw: how much she stands (0 in the air: no grip) */
    update(gw) {
      if (gw <= 0.001) { if (!zeroed) { data.fill(0); tex.needsUpdate = true; zeroed = true; lastKey = ''; } return; }
      // skip when nothing moved (a perched bird: the feet are still)
      let h = gw.toFixed(3);
      for (const L of legs) { L.joint.getWorldPosition(J); h += J.x.toFixed(4) + J.y.toFixed(4) + J.z.toFixed(4); }
      if (h === lastKey) return;
      lastKey = h; zeroed = false;
      inv.copy(mesh.matrixWorld).invert();
      m3.setFromMatrix4(inv);                                      // world vectors -> mesh-local (scale included)
      const bones = sk.bones;
      for (const L of legs) {
        L.joint.getWorldPosition(J);
        cols.clear();
        let dMax = 1e-6;
        const n = L.idx.length;
        for (let v = 0; v < n; v++) {
          let x = 0, y = 0, z = 0;
          for (let k = L.start[v]; k < L.start[v + 1]; k++) {
            const m = bones[L.bone[k]].matrixWorld.elements, qx = L.q[k * 3], qy = L.q[k * 3 + 1], qz = L.q[k * 3 + 2], ww = L.w[k];
            x += ww * (m[0] * qx + m[4] * qy + m[8] * qz + m[12]); y += ww * (m[1] * qx + m[5] * qy + m[9] * qz + m[13]); z += ww * (m[2] * qx + m[6] * qy + m[10] * qz + m[14]);
          }
          L.X[v] = x; L.Y[v] = y; L.Z[v] = z;
          const gap = y - surfaceAt(x, z), kk = key(x, z), c = cols.get(kk);
          if (c === undefined || gap < c) cols.set(kk, gap);
          const d = Math.hypot(x - J.x, z - J.z); if (d > dMax) dMax = d;
        }
        for (let v = 0; v < n; v++) {
          const x = L.X[v], z = L.Z[v], cx = Math.floor(x / cell), cz = Math.floor(z / cell);
          let sole = Infinity;
          for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const c = cols.get((cx + a) * 100003 + (cz + b)); if (c !== undefined && c < sole) sole = c; }
          const f = Math.hypot(x - J.x, z - J.z) / dMax, t = Math.min(1, Math.max(0, (f - 0.3) / 0.6)), along = t * t * (3 - 2 * t);
          const pull = Math.min(maxPull, Math.max(0, sole - eps)) * along * gw, o = (L.slot0 + v) * 4;
          // CURL, not stretch: the vertex goes down on an arc about the foot joint (its distance to the joint is kept, so it also
          // comes back toward the foot as it drops), like a toe closing; a pure vertical pull lengthened the claws
          const rx = x - J.x, ry = L.Y[v] - J.y, rz = z - J.z, H = Math.hypot(rx, rz), R2 = rx * rx + ry * ry + rz * rz, ny = ry - pull;
          const H2 = R2 - ny * ny, k = H > 1e-5 && H2 > 0 ? (Math.sqrt(H2) - H) / H : 0;
          W.set(rx * k, -pull, rz * k).applyMatrix3(m3);              // world offset -> mesh-local (scale included)
          data[o] = W.x; data[o + 1] = W.y; data[o + 2] = W.z;
        }
      }
      tex.needsUpdate = true;
    },
  };
}

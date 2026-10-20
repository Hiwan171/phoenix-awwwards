// Sparse CPU skinning for terrain clearance checks. The per-influence bind coordinates are cached once;
// sampling never rebuilds matrices or allocates vectors. Used by the offline opening calibration and QA.
import * as THREE from 'three';

export function createFenixClearance({ mesh, bird, surfaceAt, maxSamples = 1800 }) {
  const { position, skinIndex, skinWeight } = mesh.geometry.attributes;
  const skeleton = mesh.skeleton, bones = skeleton.bones;
  const tail = bones.map((b) => /^F_tail_/.test(b.name) || /^Bone_0(?:1[4-9]|2\d|3[01])$/.test(b.name));
  const candidates = [];
  for (let i = 0; i < position.count; i++) {
    let amount = 0;
    for (let k = 0; k < 4; k++) if (tail[skinIndex.getComponent(i, k)]) amount += skinWeight.getComponent(i, k);
    if (amount > 0.65) candidates.push(i);
  }
  const step = Math.max(1, Math.floor(candidates.length / maxSamples));
  const indices = candidates.filter((_, i) => i % step === 0);
  const starts = [0], joint = [], weights = [], coords = [], p = new THREE.Vector3();
  for (const i of indices) {
    for (let k = 0; k < 4; k++) {
      const weight = skinWeight.getComponent(i, k);
      if (!weight) continue;
      const j = skinIndex.getComponent(i, k);
      p.fromBufferAttribute(position, i).applyMatrix4(mesh.bindMatrix).applyMatrix4(skeleton.boneInverses[j]);
      joint.push(j); weights.push(weight); coords.push(p.x, p.y, p.z);
    }
    starts.push(joint.length);
  }
  const q = new Float64Array(coords), w = new Float64Array(weights), ids = new Uint16Array(joint);
  function tailGap() {
    bird.updateMatrixWorld(true);
    let gap = Infinity;
    for (let i = 0; i < indices.length; i++) {
      let x = 0, y = 0, z = 0;
      for (let k = starts[i]; k < starts[i + 1]; k++) {
        const e = bones[ids[k]].matrixWorld.elements, px = q[k * 3], py = q[k * 3 + 1], pz = q[k * 3 + 2];
        x += w[k] * (e[0] * px + e[4] * py + e[8] * pz + e[12]);
        y += w[k] * (e[1] * px + e[5] * py + e[9] * pz + e[13]);
        z += w[k] * (e[2] * px + e[6] * py + e[10] * pz + e[14]);
      }
      gap = Math.min(gap, y - surfaceAt(x, z));
    }
    return gap;
  }
  return { tailGap, count: indices.length };
}

export function clearanceAt(table, u) {
  const x = THREE.MathUtils.clamp(u, 0, 1) * (table.length - 1), i = Math.min(table.length - 2, Math.floor(x));
  return table[i] + (table[i + 1] - table[i]) * (x - i);
}

import * as THREE from 'three';
import { FENIX_TOE_GUIDES, toeCenters, toeProjection, toeWeights } from './fenix-toe-guides.js';

const UP = new THREE.Vector3(0, 1, 0);
const MARGIN = 0.005;
const smooth = (x) => { const t = THREE.MathUtils.clamp(x, 0, 1); return t * t * (3 - 2 * t); };

/** Extend the existing skin, in its bind pose, without replacing its GLB or material. */
export function installFenixToeRig({ mesh }) {
  const skeleton = mesh.skeleton;
  const existing = skeleton.bones.find((b) => b.name === 'Toe_A_0_0');
  if (existing) throw new Error('The phoenix toe rig was already installed.');
  // Bones are siblings of the mesh in a GLTF. Updating only the mesh leaves
  // their cached world matrices at the old, unattached model transform.
  mesh.updateWorldMatrix(true, false); mesh.updateMatrixWorld(true);
  for (const bone of skeleton.bones) bone.updateWorldMatrix(true, false);
  const originalCount = skeleton.bones.length;
  const byName = new Map(skeleton.bones.map((b, i) => [b.name, i]));
  const position = mesh.geometry.attributes.position;
  const indices = mesh.geometry.attributes.skinIndex;
  const weights = mesh.geometry.attributes.skinWeight;
  const decode = new THREE.Matrix4().multiplyMatrices(skeleton.bones[0].matrixWorld, skeleton.boneInverses[0]);
  const point = new THREE.Vector3(), inverse = new THREE.Matrix4(), quat = new THREE.Quaternion();
  // Store rest coordinates before changing any influences. applyBoneTransform
  // decodes the quantized geometry through the existing inverse bind matrices.
  const candidates = FENIX_TOE_GUIDES.map((spec) => ({ spec, vertices: [], toes: [] }));
  for (let i = 0; i < position.count; i++) {
    let best = -1, amount = 0;
    for (let fi = 0; fi < candidates.length; fi++) {
      let w = 0;
      for (let k = 0; k < 4; k++) if (candidates[fi].spec.old.some((name) => byName.get(name) === indices.getComponent(i, k))) w += weights.getComponent(i, k);
      if (w > amount) { amount = w; best = fi; }
    }
    if (amount < 0.65) continue;
    point.fromBufferAttribute(position, i); mesh.applyBoneTransform(i, point);
    // The tarsus/scales above the toes retain their original skinning.
    if (point.y > 0.135) continue;
    candidates[best].vertices.push({ index: i, p: point.toArray() });
  }
  for (const foot of candidates) {
    const ankle = skeleton.bones[byName.get(foot.spec.ankle)];
    foot.ankle = ankle;
    foot.leg = foot.spec.leg.map((name) => skeleton.bones[byName.get(name)]);
    for (let ti = 0; ti < foot.spec.toes.length; ti++) {
      const guide = foot.spec.toes[ti], centers = toeCenters(guide), bones = [];
      let parent = ankle;
      for (let j = 0; j < centers.length; j++) {
        const bone = new THREE.Bone(); bone.name = `Toe_${foot.spec.side}_${ti}_${j}`;
        parent.updateWorldMatrix(true, false);
        inverse.copy(parent.matrixWorld).invert();
        bone.position.fromArray(centers[j]).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse);
        parent.getWorldQuaternion(quat); bone.quaternion.copy(quat).invert();
        parent.add(bone); bone.updateWorldMatrix(true, false);
        skeleton.bones.push(bone);
        skeleton.boneInverses.push(new THREE.Matrix4().copy(bone.matrixWorld).invert().multiply(decode));
        bones.push(bone); parent = bone;
      }
      const hingeLocal = new THREE.Vector3().fromArray(guide.tip).sub(new THREE.Vector3().fromArray(guide.root)).cross(UP).normalize();
      hingeLocal.transformDirection(mesh.matrixWorld); ankle.getWorldQuaternion(quat).invert(); hingeLocal.applyQuaternion(quat);
      foot.toes.push({ guide, bones, hingeLocal, jointIndices: bones.map((b) => skeleton.bones.indexOf(b)), rest: bones.map((b) => b.quaternion.clone()), vertices: [] });
    }
    for (const vertex of foot.vertices) {
      let closest = null, projection = null;
      for (const toe of foot.toes) {
        const p = toeProjection(vertex.p, toe.guide);
        if (!projection || p.distance < projection.distance) { projection = p; closest = toe; }
      }
      if (projection.distance > 0.052 || projection.t < 0.03) continue;
      const influence = toeWeights(vertex.p, closest.guide), ii = vertex.index;
      const values = [
        [byName.get(foot.spec.ankle), 1 - influence.alpha],
        [closest.jointIndices[influence.first], influence.alpha * (1 - influence.blend)],
        [closest.jointIndices[influence.first + 1], influence.alpha * influence.blend],
      ];
      values.sort((a, b) => b[1] - a[1]);
      indices.setXYZW(ii, values[0][0], values[1][0], values[2][0], 0);
      weights.setXYZW(ii, values[0][1], values[1][1], values[2][1], 0);
      closest.vertices.push(vertex);
    }
  }
  indices.needsUpdate = true; weights.needsUpdate = true;
  // Reallocate the texture/matrix array for the appended joints. Binding again
  // would recalculate all inverse matrices and corrupt quantized geometry.
  skeleton.boneTexture?.dispose(); skeleton.boneTexture = null;
  skeleton.boneMatrices = new Float32Array(skeleton.bones.length * 16);
  mesh.updateWorldMatrix(true, true); skeleton.update();
  return { feet: candidates, addedBones: skeleton.bones.length - originalCount, originalCount };
}

/** Per-foot planted anchors, leg IK, and rigid phalanges following the rock. */
export function createFenixFeet({ mesh, bird, surfaceAt, rig }) {
  const anchors = new Map(), sk = mesh.skeleton;
  const releases = new Map();
  const P = new THREE.Vector3(), B = new THREE.Vector3(), A = new THREE.Vector3(), C = new THREE.Vector3();
  const V = new THREE.Vector3(), W = new THREE.Vector3(), axis = new THREE.Vector3();
  const worldQ = new THREE.Quaternion(), parentQ = new THREE.Quaternion(), delta = new THREE.Quaternion(), fullDelta = new THREE.Quaternion();
  const baseAngles = new Float64Array(3);
  let lastKey = null, weight = 0, bodyDrop = 0;
  const stats = { ready: true, addedBones: rig.addedBones, feet: [], minGap: 0, maxGap: 0, maxDrift: 0, finite: true };
  const sourceObjects = new Set();
  for (const foot of rig.feet) for (let object = foot.ankle; object; object = object.parent) sourceObjects.add(object);
  const inputObjects = [...sourceObjects], input = new Float64Array(inputObjects.length * 10), cachedInput = new Float64Array(input.length);
  const outputBones = rig.feet.flatMap((foot) => [...foot.leg, foot.ankle, ...foot.toes.flatMap((toe) => toe.bones)]);
  const cachedRotations = new Float64Array(outputBones.length * 4);
  const releaseRotation = new THREE.Quaternion();
  let cachedKey = null, cachedWeight = 0, cachedDrop = 0, cacheValid = false, cacheHit = false;

  function matchesCachedInput(key, ground) {
    let offset = 0;
    for (const object of inputObjects) {
      object.position.toArray(input, offset); object.quaternion.toArray(input, offset + 3); object.scale.toArray(input, offset + 7); offset += 10;
    }
    if (!cacheValid || cachedKey !== key || cachedWeight !== ground) return false;
    for (let i = 0; i < input.length; i++) if (Math.abs(input[i] - cachedInput[i]) > 1e-12) return false;
    return true;
  }

  function skinVertex(index, out) {
    out.fromBufferAttribute(mesh.geometry.attributes.position, index);
    mesh.applyBoneTransform(index, out); return out.applyMatrix4(mesh.matrixWorld);
  }
  function updateWorld() { bird.updateMatrixWorld(true); }
  function resetToes() { for (const f of rig.feet) for (const t of f.toes) for (let j = 0; j < 3; j++) t.bones[j].quaternion.copy(t.rest[j]); }
  function worldRotation(bone, q) {
    bone.parent.getWorldQuaternion(parentQ).invert();
    bone.quaternion.copy(parentQ).multiply(q); bone.updateWorldMatrix(false, true);
  }
  function solveLeg(foot, target, orientation, ground) {
    foot.ankle.getWorldPosition(A);
    V.copy(A).lerp(target, ground);
    // CCD changes rotations only; no scale or bone translation is allowed.
    for (let iteration = 0; iteration < 80; iteration++) {
      if (foot.ankle.getWorldPosition(A).distanceToSquared(V) < 2.5e-8) break;
      for (let i = foot.leg.length - 1; i >= 0; i--) {
        const bone = foot.leg[i]; bone.getWorldPosition(B); foot.ankle.getWorldPosition(A);
        C.copy(A).sub(B); W.copy(V).sub(B);
        if (C.lengthSq() < 1e-10 || W.lengthSq() < 1e-10) continue;
        delta.setFromUnitVectors(C.normalize(), W.normalize());
        const angle = 2 * Math.acos(Math.min(1, Math.abs(delta.w)));
        if (angle > 0.20) { fullDelta.copy(delta); delta.identity().slerp(fullDelta, 0.20 / angle); }
        bone.getWorldQuaternion(worldQ); worldQ.premultiply(delta); worldRotation(bone, worldQ);
      }
    }
    foot.ankle.getWorldQuaternion(worldQ).slerp(orientation, ground); worldRotation(foot.ankle, worldQ);
  }

  // Sample only the sole near each phalanx. Above-surface scales must not pull
  // the digit down through the rock when the claw has already made contact.
  for (const foot of rig.feet) {
    const ankle = foot.ankle.getWorldPosition(new THREE.Vector3()); mesh.worldToLocal(ankle);
    foot.pad = foot.vertices.filter((v) => {
      return Math.hypot(v.p[0] - ankle.x, v.p[2] - ankle.z) < 0.075 && v.p[1] < 0.105;
    });
    if (!foot.pad.length) foot.pad = foot.vertices;
    for (const toe of foot.toes) {
      const sorted = [...toe.vertices].sort((a, b) => toeProjection(b.p, toe.guide).t - toeProjection(a.p, toe.guide).t || a.p[1] - b.p[1]);
      toe.tipVertex = sorted.slice(0, Math.max(1, Math.floor(sorted.length * 0.16))).sort((a, b) => a.p[1] - b.p[1])[0]?.index;
      // Bottommost vertex per cross-section, plus a few underside neighbours.
      toe.samples = Array.from({ length: 6 }, (_, bin) => toe.vertices.filter((v) => Math.min(5, Math.floor(toeProjection(v.p, toe.guide).t * 6)) === bin).sort((a, b) => a.p[1] - b.p[1]).slice(0, 3)).flat();
    }
  }

  function toeObjective(toe) {
    let cost = 0, worst = 0, penetration = 0;
    for (const sample of toe.samples) {
      skinVertex(sample.index, P); const gap = P.y - surfaceAt(P.x, P.z) - MARGIN;
      cost += gap * gap;
    }
    for (const vertex of toe.vertices) {
      skinVertex(vertex.index, P); const gap = P.y - surfaceAt(P.x, P.z) - MARGIN;
      if (gap < 0) { worst = Math.min(worst, gap); penetration += gap * gap; }
    }
    return cost / Math.max(1, toe.samples.length) + penetration * 200 / Math.max(1, toe.vertices.length) + worst * worst * 1000;
  }
  function solveToe(toe) {
    if (toe.tipVertex === undefined) return;
    toe.bones[0].parent.getWorldQuaternion(worldQ);
    const worldAxis = toe.hingeLocal.clone().applyQuaternion(worldQ);
    baseAngles.fill(0);
    // Coordinate search is baked at each deterministic perch, not every frame.
    // Rotation about the digit's lateral axis preserves length and thickness.
    for (const step of [0.28, 0.14, 0.07, 0.035, 0.0175]) for (let pass = 0; pass < 2; pass++) for (let j = 0; j < 3; j++) {
      const bone = toe.bones[j];
      bone.parent.getWorldQuaternion(parentQ).invert(); axis.copy(worldAxis).applyQuaternion(parentQ);
      let angle = baseAngles[j], best = toeObjective(toe);
      for (const candidate of [angle - step, angle + step]) {
        if (Math.abs(candidate) > (j ? 1.05 : 0.80)) continue;
        delta.setFromAxisAngle(axis, candidate); bone.quaternion.copy(delta).multiply(toe.rest[j]); bone.updateWorldMatrix(false, true);
        const cost = toeObjective(toe) + candidate * candidate * 0.000004;
        if (cost < best) { best = cost; baseAngles[j] = candidate; }
      }
      delta.setFromAxisAngle(axis, baseAngles[j]); bone.quaternion.copy(delta).multiply(toe.rest[j]); bone.updateWorldMatrix(false, true);
    }
  }

  function capture(key) {
    resetToes(); updateWorld();
    const data = rig.feet.map((foot) => {
      const position = foot.ankle.getWorldPosition(new THREE.Vector3()), orientation = foot.ankle.getWorldQuaternion(new THREE.Quaternion());
      // Match the whole sole to the ledge before individual digits grip it.
      // A horizontal foot cannot reach a steep face by curling its nails alone.
      const h = 0.085;
      const normal = new THREE.Vector3(
        -(surfaceAt(position.x + h, position.z) - surfaceAt(position.x - h, position.z)) / (2 * h),
        1,
        -(surfaceAt(position.x, position.z + h) - surfaceAt(position.x, position.z - h)) / (2 * h),
      ).normalize();
      delta.setFromUnitVectors(UP, normal); const tilt = 2 * Math.acos(Math.min(1, Math.abs(delta.w)));
      if (tilt > 0.80) { fullDelta.copy(delta); delta.identity().slerp(fullDelta, 0.80 / tilt); }
      orientation.premultiply(delta); worldRotation(foot.ankle, orientation);
      let gap = Infinity;
      for (const sample of foot.pad) { skinVertex(sample.index, P); gap = Math.min(gap, P.y - surfaceAt(P.x, P.z)); }
      position.y += THREE.MathUtils.clamp(MARGIN - gap, -0.18, 0.18);
      return { position, orientation, toes: null };
    });
    settleBody(data, 1);
    for (let i = 0; i < rig.feet.length; i++) solveLeg(rig.feet[i], data[i].position, data[i].orientation, 1);
    for (let i = 0; i < rig.feet.length; i++) {
      for (const toe of rig.feet[i].toes) solveToe(toe);
      // Check the entire skin, including the sides of each scale. If a ridge
      // cannot fit beneath a rigid phalanx, raise the foot rather than squash it.
      for (let pass = 0; pass < 2; pass++) {
        let gap = Infinity;
        for (const toe of rig.feet[i].toes) for (const vertex of toe.vertices) {
          skinVertex(vertex.index, P); gap = Math.min(gap, P.y - surfaceAt(P.x, P.z));
        }
        if (gap >= 0.002) break;
        data[i].position.y += MARGIN - gap;
        solveLeg(rig.feet[i], data[i].position, data[i].orientation, 1);
        for (const toe of rig.feet[i].toes) solveToe(toe);
      }
      data[i].toes = rig.feet[i].toes.map((toe) => toe.bones.map((b) => b.quaternion.clone()));
    }
    anchors.set(key, data); cacheValid = false; return data;
  }

  function settleBody(data, ground) {
    bodyDrop = 0;
    // A leg cannot extend beyond its fixed segment lengths. Let the pelvis
    // settle instead of stretching a shin or allowing the lower foot to hover.
    for (let i = 0; i < rig.feet.length; i++) {
      const foot = rig.feet[i], target = data[i].position;
      let reach = 0;
      for (let j = 0; j < foot.leg.length; j++) {
        foot.leg[j].getWorldPosition(A); (foot.leg[j + 1] ?? foot.ankle).getWorldPosition(B); reach += A.distanceTo(B);
      }
      foot.leg[0].getWorldPosition(A);
      const lateral = Math.hypot(A.x - target.x, A.z - target.z), extension = Math.sqrt(Math.max(0.001, (reach * 0.97) ** 2 - lateral ** 2));
      bodyDrop = Math.max(bodyDrop, A.y - target.y - extension);
    }
    bodyDrop = THREE.MathUtils.clamp(bodyDrop, 0, 0.3) * ground;
    if (bodyDrop > 0) { bird.position.y -= bodyDrop; updateWorld(); }
  }

  function update({ ground, key }) {
    weight = smooth(ground); lastKey = key;
    bodyDrop = 0; cacheHit = false;
    resetToes();
    if (weight < 0.0001 || !anchors.has(key)) return;
    const release = releases.get(key);
    if (release && ground < 1) {
      // Once the toes leave the perch, stop solving toward a world-space rock anchor.
      // Near full extension CCD can flip its bend while the flight pose retracts the same leg.
      // Blend the final supported push-off pose into the authored air pose in joint space instead.
      bodyDrop = release.bodyDrop * weight;
      bird.position.y -= bodyDrop;
      for (let i = 0; i < outputBones.length; i++) {
        releaseRotation.fromArray(release.rotations, i * 4);
        outputBones[i].quaternion.slerp(releaseRotation, weight);
      }
      cacheValid = false;
      updateWorld(); return;
    }
    if (matchesCachedInput(key, weight)) {
      bodyDrop = cachedDrop; bird.position.y -= bodyDrop;
      for (let i = 0; i < outputBones.length; i++) outputBones[i].quaternion.fromArray(cachedRotations, i * 4);
      cacheHit = true; updateWorld(); return;
    }
    updateWorld(); const data = anchors.get(key);
    settleBody(data, weight);
    for (let i = 0; i < rig.feet.length; i++) {
      const foot = rig.feet[i], anchor = data[i];
      solveLeg(foot, anchor.position, anchor.orientation, weight);
      for (let ti = 0; ti < foot.toes.length; ti++) for (let j = 0; j < 3; j++) foot.toes[ti].bones[j].quaternion.copy(foot.toes[ti].rest[j]).slerp(anchor.toes[ti][j], weight);
      foot.ankle.updateWorldMatrix(false, true);
    }
    cachedInput.set(input); cachedKey = key; cachedWeight = weight; cachedDrop = bodyDrop; cacheValid = true;
    for (let i = 0; i < outputBones.length; i++) outputBones[i].quaternion.toArray(cachedRotations, i * 4);
  }

  function diagnostics() {
    updateWorld(); stats.feet = []; stats.minGap = Infinity; stats.maxGap = -Infinity; stats.maxDrift = 0; stats.finite = true;
    for (let i = 0; i < rig.feet.length; i++) {
      const foot = rig.feet[i], target = anchors.get(lastKey)?.[i]; let min = Infinity, max = -Infinity;
      const pads = [];
      const toes = foot.toes.map((toe, ti) => {
        let low = Infinity, high = -Infinity;
        for (const v of toe.vertices) { skinVertex(v.index, P); const gap = P.y - surfaceAt(P.x, P.z); low = Math.min(low, gap); high = Math.max(high, gap); }
        for (const v of toe.samples) { skinVertex(v.index, P); const gap = P.y - surfaceAt(P.x, P.z); pads.push({ position: P.toArray(), gap, toe: ti, vertex: v.index }); }
        min = Math.min(min, low); max = Math.max(max, high);
        return { vertices: toe.vertices.length, minGap: low, maxGap: high };
      });
      foot.ankle.getWorldPosition(P); const drift = target ? P.distanceTo(target.position) : 0;
      stats.maxDrift = Math.max(stats.maxDrift, drift); stats.minGap = Math.min(stats.minGap, min); stats.maxGap = Math.max(stats.maxGap, max);
      stats.feet.push({ name: foot.spec.side, anchor: target?.position.toArray() ?? null, minGap: min, maxGap: max, drift, toes, pads });
      for (const bone of [...foot.leg, foot.ankle, ...foot.toes.flatMap((t) => t.bones)]) stats.finite &&= [...bone.position, ...bone.quaternion, ...bone.scale].every(Number.isFinite);
    }
    return { ...stats, key: lastKey, weight, bodyDrop, cacheHit };
  }

  function captureRelease(key) {
    const rotations = new Float64Array(outputBones.length * 4);
    for (let i = 0; i < outputBones.length; i++) outputBones[i].quaternion.toArray(rotations, i * 4);
    releases.set(key, { rotations, bodyDrop });
  }

  return { capture, captureRelease, update, diagnostics, rig, anchors, clearCache() { cacheValid = false; } };
}

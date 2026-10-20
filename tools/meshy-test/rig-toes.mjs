// Reproduce the runtime's anatomical toe extension in either phoenix LOD.
// node tools/meshy-test/rig-toes.mjs [input.glb] [output.glb]
// Omit output to audit only. The approved source GLB is never overwritten.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from '../../site/node_modules/three/build/three.module.js';
import { installFenixToeRig, createFenixFeet } from '../../site/src/beasts/fenix-feet.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const input = path.resolve(process.argv[2] ?? path.join(here, '../../site/public/models/fenix-flight-web.glb'));
const output = process.argv[3] ? path.resolve(process.argv[3]) : null;
if (output === input) throw new Error('Choose a separate output file; the approved GLB must be preserved.');
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(input), root = doc.getRoot(), skin = root.listSkins()[0];
const prim = root.listMeshes()[0].listPrimitives()[0], oldJoints = skin.listJoints();
const geometry = new THREE.BufferGeometry();
for (const [semantic, name, ArrayType] of [['POSITION', 'position', Float32Array], ['JOINTS_0', 'skinIndex', Uint16Array], ['WEIGHTS_0', 'skinWeight', Float32Array]]) {
  const accessor = prim.getAttribute(semantic), array = new ArrayType(accessor.getCount() * accessor.getElementSize());
  for (let i = 0; i < accessor.getCount(); i++) array.set(accessor.getElement(i, []), i * accessor.getElementSize());
  geometry.setAttribute(name, new THREE.BufferAttribute(array, accessor.getElementSize()));
}
const scene = new THREE.Group(), nodeMap = new Map();
if (process.env.HOLDER === '1') { scene.rotation.y = -Math.PI / 2; scene.scale.setScalar(1 / 1.7); scene.position.y = -0.5; }
for (const node of root.listNodes()) {
  const object = oldJoints.includes(node) ? new THREE.Bone() : new THREE.Group();
  object.name = node.getName(); object.position.fromArray(node.getTranslation()); object.quaternion.fromArray(node.getRotation()); object.scale.fromArray(node.getScale());
  nodeMap.set(node, object);
}
for (const [node, object] of nodeMap) {
  const parent = node.getParentNode(); (parent ? nodeMap.get(parent) : scene).add(object);
}
const skeleton = new THREE.Skeleton(oldJoints.map((node) => nodeMap.get(node)), oldJoints.map((_, i) => new THREE.Matrix4().fromArray(skin.getInverseBindMatrices().getElement(i, []))));
const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial()); mesh.name = 'toe-audit'; scene.add(mesh); scene.updateMatrixWorld(true); mesh.bind(skeleton, new THREE.Matrix4()); scene.updateMatrixWorld(true);
const before = new Float32Array(geometry.attributes.position.count * 3), P = new THREE.Vector3();
for (let i = 0; i < geometry.attributes.position.count; i++) { P.fromBufferAttribute(geometry.attributes.position, i); mesh.applyBoneTransform(i, P); P.toArray(before, i * 3); }
const rig = installFenixToeRig({ mesh });
let maxBindError = 0, weightError = 0;
for (let i = 0; i < geometry.attributes.position.count; i++) {
  P.fromBufferAttribute(geometry.attributes.position, i); mesh.applyBoneTransform(i, P);
  maxBindError = Math.max(maxBindError, P.distanceTo(new THREE.Vector3().fromArray(before, i * 3)));
  let sum = 0; for (let k = 0; k < 4; k++) sum += geometry.attributes.skinWeight.getComponent(i, k);
  weightError = Math.max(weightError, Math.abs(1 - sum));
}
if (maxBindError > 0.001 || weightError > 0.0001) throw new Error(`Invalid toe skin: bind error ${maxBindError}, weight error ${weightError}`);
const facts = { input: path.basename(input), addedBones: rig.addedBones, maxBindError, maxWeightError: weightError, feet: rig.feet.map((foot) => ({ side: foot.spec.side, toes: foot.toes.map((toe) => toe.vertices.length) })) };

// Exercise the actual runtime contact solver over an inclined uneven perch.
// This is an audit, not a separate implementation of the production solver.
const surfaceAt = (x, z) => (process.env.HOLDER === '1' ? -0.49 : 0.024) + 0.04 * Math.sin(x * 7) + 0.009 * Math.cos(z * 21);
const feet = createFenixFeet({ mesh, bird: scene, surfaceAt, rig });
const rest = skeleton.bones.map((bone) => bone.quaternion.clone());
feet.capture('audit');
for (let i = 0; i < skeleton.bones.length; i++) skeleton.bones[i].quaternion.copy(rest[i]);
feet.update({ ground: 1, key: 'audit' });
facts.contact = feet.diagnostics();
if (!facts.contact.finite) throw new Error('Contact solver produced a non-finite transform.');
const footVertices = new Set(rig.feet.flatMap((foot) => foot.toes.flatMap((toe) => toe.vertices.map((v) => v.index))));
const moved = new Map(), B = new THREE.Vector3();
for (const i of footVertices) { P.fromBufferAttribute(geometry.attributes.position, i); mesh.applyBoneTransform(i, P); moved.set(i, P.clone()); }
let maxEdgeRatio = 1;
const triangleIndices = prim.getIndices().getArray();
for (let i = 0; i < triangleIndices.length; i += 3) for (const [a, b] of [[triangleIndices[i], triangleIndices[i + 1]], [triangleIndices[i + 1], triangleIndices[i + 2]], [triangleIndices[i + 2], triangleIndices[i]]]) {
  if (!footVertices.has(a) || !footVertices.has(b)) continue;
  const length = P.fromArray(before, a * 3).distanceTo(B.fromArray(before, b * 3));
  if (length > 0.002) maxEdgeRatio = Math.max(maxEdgeRatio, moved.get(a).distanceTo(moved.get(b)) / length);
}
facts.maxFootEdgeLengthRatio = maxEdgeRatio;
for (let i = 0; i < skeleton.bones.length; i++) skeleton.bones[i].quaternion.copy(rest[i]); scene.updateMatrixWorld(true);

if (output) {
  const backMap = new Map([...nodeMap].map(([node, object]) => [object, node]));
  for (const bone of skeleton.bones.slice(oldJoints.length)) {
    const node = doc.createNode(bone.name).setTranslation(bone.position.toArray()).setRotation(bone.quaternion.toArray());
    backMap.set(bone, node); backMap.get(bone.parent).addChild(node); skin.addJoint(node);
  }
  const buffer = root.listBuffers()[0];
  skin.setInverseBindMatrices(doc.createAccessor('toe-inverse-bind').setType('MAT4').setArray(new Float32Array(skeleton.boneInverses.flatMap((m) => m.toArray()))).setBuffer(buffer));
  prim.setAttribute('JOINTS_0', doc.createAccessor('toe-joints').setType('VEC4').setArray(geometry.attributes.skinIndex.array).setBuffer(buffer));
  prim.setAttribute('WEIGHTS_0', doc.createAccessor('toe-weights').setType('VEC4').setArray(geometry.attributes.skinWeight.array).setBuffer(buffer));
  root.listExtensionsUsed().find((ext) => ext.extensionName === 'EXT_meshopt_compression')?.dispose();
  await io.write(output, doc); facts.output = output;
}
// Keep the audit output compact; detailed sole points remain available in browser diagnostics.
facts.contact.feet = facts.contact.feet.map(({ pads, ...foot }) => foot);
console.log(JSON.stringify(facts, null, 2));

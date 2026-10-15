// Writes a skeleton + skin into a prepped GLB (gltf-transform). Joints keep an IDENTITY rest rotation, so local axes ==
// model axes and every controller can reason in model space; a child's translation is its rest offset from the parent.
import { Accessor } from '@gltf-transform/core';

/**
 * @param doc    gltf-transform Document (from loadPrep)
 * @param prim   the mesh primitive to skin
 * @param joints [{ name, parent: index|null (index into this array), pos: [x,y,z] }]  parents MUST come before children
 * @param top    { joints: Uint16Array(nW*4), weights: Float32Array(nW*4) } per WELDED vertex
 * @param weld   Int32Array(nV): vertex -> welded id
 * @param opts   { skinName, extras }  extras are written on the skeleton root node (read back as userData by three.js)
 */
export function writeSkin(doc, prim, joints, top, weld, { skinName = 'Skin', extras = {} } = {}) {
  const root = doc.getRoot(), buffer = root.listBuffers()[0], nV = weld.length, J = joints.length;
  const nodes = joints.map((j) => doc.createNode(j.name));
  joints.forEach((j, i) => {
    const n = nodes[i];
    const p = j.parent == null ? [0, 0, 0] : joints[j.parent].pos;
    n.setTranslation([j.pos[0] - p[0], j.pos[1] - p[1], j.pos[2] - p[2]]);
    if (j.parent != null) nodes[j.parent].addChild(n);
  });
  const roots = joints.map((j, i) => (j.parent == null ? i : -1)).filter((i) => i >= 0);
  if (roots.length !== 1) throw new Error(`skeleton must have exactly one root, has ${roots.length}`);
  const rootNode = nodes[roots[0]];
  rootNode.setExtras({ ...extras, joints: J });
  const ibm = new Float32Array(J * 16);
  joints.forEach((j, i) => ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -j.pos[0], -j.pos[1], -j.pos[2], 1], i * 16));
  const ibmAcc = doc.createAccessor('ibm').setType(Accessor.Type.MAT4).setArray(ibm).setBuffer(buffer);
  const skin = doc.createSkin(skinName).setInverseBindMatrices(ibmAcc).setSkeleton(rootNode);
  nodes.forEach((n) => skin.addJoint(n));
  const joints0 = new Uint8Array(nV * 4), weights0 = new Float32Array(nV * 4);
  for (let i = 0; i < nV; i++) {
    const w = weld[i];
    for (let k = 0; k < 4; k++) { joints0[i*4+k] = top.joints[w*4+k]; weights0[i*4+k] = top.weights[w*4+k]; }
  }
  if (J > 255) throw new Error('more than 255 joints: switch JOINTS_0 to Uint16');
  prim.setAttribute('JOINTS_0', doc.createAccessor('joints0').setType(Accessor.Type.VEC4).setArray(joints0).setBuffer(buffer));
  prim.setAttribute('WEIGHTS_0', doc.createAccessor('weights0').setType(Accessor.Type.VEC4).setArray(weights0).setBuffer(buffer));
  const mesh = prim.listParents().find((p) => p.propertyType === 'Mesh');
  const meshNode = root.listNodes().find((n) => n.getMesh() === mesh);
  meshNode.setSkin(skin);
  root.listScenes()[0].addChild(rootNode);
  return { rootNode, nodes, skin };
}

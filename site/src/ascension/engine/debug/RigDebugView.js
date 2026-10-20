// RigDebugView — visual diagnostics for the audited rig: joints coloured by anatomical
// region (wing R/L, tail, body, head/crest, legs), parent links, and the solved wing chains.
import * as THREE from 'three';

const COL = { body: 0x40ff80, wingR: 0xff3a30, wingL: 0x30a0ff, tail: 0xffd040, head: 0xff40ff, leg: 0x30ffff, chain: 0xffffff };

export class RigDebugView {
  constructor(rig) {
    this.rig = rig;
    const n = rig.n;
    this.pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const r = rig.region[i], s = rig.sideOf[i];
      c.setHex(r === 1 ? (s < 0 ? COL.wingR : COL.wingL) : r === 2 ? COL.tail : r === 3 ? COL.head : r === 4 ? COL.leg : COL.body);
      col.set([c.r, c.g, c.b], i * 3);
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    pg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.points = new THREE.Points(pg, new THREE.PointsMaterial({ size: 4, sizeAttenuation: false, vertexColors: true, depthTest: false, transparent: true }));
    this.links = [];
    rig.parent.forEach((p, i) => { if (p >= 0) this.links.push(p, i); });
    this.lpos = new Float32Array(this.links.length * 3);
    const lc = new Float32Array(this.links.length * 3);
    this.links.forEach((b, k) => lc.set(col.subarray(b * 3, b * 3 + 3), k * 3));
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(this.lpos, 3).setUsage(THREE.DynamicDrawUsage));
    lg.setAttribute('color', new THREE.BufferAttribute(lc, 3));
    this.lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.55 }));
    this.group = new THREE.Group(); this.group.add(this.lines, this.points);
    this.group.renderOrder = 999; this.points.renderOrder = 1000; this.lines.renderOrder = 999;
    this.points.frustumCulled = this.lines.frustumCulled = false;
    this.group.visible = false;
  }
  update() {
    if (!this.group.visible) return;
    const v = new THREE.Vector3();
    this.rig.bones.forEach((b, i) => { v.setFromMatrixPosition(b.matrixWorld); this.pos.set([v.x, v.y, v.z], i * 3); });
    this.links.forEach((b, k) => this.lpos.set(this.pos.subarray(b * 3, b * 3 + 3), k * 3));
    this.points.geometry.attributes.position.needsUpdate = true;
    this.lines.geometry.attributes.position.needsUpdate = true;
  }
}

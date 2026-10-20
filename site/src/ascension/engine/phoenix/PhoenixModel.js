// PhoenixModel — loads the original fenix-flight-lite.glb (meshopt + WebP + quantised),
// runs the rig audit on the untouched SkinnedMesh and installs the premium material.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { auditRig, analyseSkin } from './RigAudit.js';
import { createPhoenixMaterial } from './PhoenixMaterials.js';

export const PHOENIX_SCALE = 2.2;

export class PhoenixModel {
  static async load(url, onProgress) {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync(url, e => { if (e.total) onProgress?.(e.loaded / e.total); });
    return new PhoenixModel(gltf);
  }

  constructor(gltf) {
    this.gltf = gltf;
    let mesh = null;
    gltf.scene.traverse(o => { if (o.isSkinnedMesh) mesh = o; });
    if (!mesh) throw new Error('No SkinnedMesh in GLB');
    this.mesh = mesh;
    mesh.frustumCulled = false; // quantised positions: bounds live in the inverse bind matrices
    gltf.scene.updateMatrixWorld(true);
    // audit + skin analysis happen in bind space, before any re-parenting
    this.rig = auditRig(mesh);
    analyseSkin(this.rig);
    this.rig.report.ms = Math.round(performance.now() - this.rig.t0);
    this.originalMaterial = mesh.material;
    this.root = new THREE.Group(); this.root.name = 'PhoenixRoot';
    this.pivot = new THREE.Group(); this.pivot.name = 'PhoenixPivot';
    this.pivot.rotation.y = -Math.PI / 2; // model faces −X → group faces −Z
    this.pivot.scale.setScalar(PHOENIX_SCALE);
    this.pivot.add(gltf.scene); this.root.add(this.pivot);
    this.root.updateMatrixWorld(true);
    // feet (leg tips) in root space, used to rest the bird on the summit
    const feet = new THREE.Vector3(); let n = 0;
    for (const s of ['R', 'L']) { const L = this.rig.legs[s]; if (L && L.length) { feet.add(this.rig.rest.pos[L[L.length - 1]]); n++; } }
    feet.divideScalar(Math.max(1, n));
    this.feetModel = feet.clone();
    this.feetLocal = feet.clone().applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(), this.pivot.quaternion, this.pivot.scale));
    this.chestBone = this.rig.bones[this.rig.torso[Math.max(0, this.rig.torso.length - 3)]];
    // emitter joints: tips of every feather chain, tagged by region
    this.emitters = this.rig.chains.map(c => ({ bone: this.rig.bones[c.bones[c.bones.length - 1]], prev: this.rig.bones[c.bones[Math.max(0, c.bones.length - 2)]], region: c.region, len: c.length }));
    this.emitterPos = this.emitters.map(() => new THREE.Vector3());
    this.emitterPrev = this.emitters.map(() => new THREE.Vector3());
    this.emitterVel = this.emitters.map(() => new THREE.Vector3());
  }

  installMaterial(envMap) {
    this.premium = createPhoenixMaterial(this.originalMaterial, this.rig, envMap);
    this.mesh.material = this.premium;
    return this.premium;
  }

  setOriginal(on) { this.premium.userData.uniforms.uPremium.value = on ? 0 : 1; }

  updateEmitters(dt) {
    for (let i = 0; i < this.emitters.length; i++) {
      const p = this.emitterPos[i];
      this.emitterPrev[i].copy(p);
      p.setFromMatrixPosition(this.emitters[i].bone.matrixWorld);
      if (dt > 0) this.emitterVel[i].subVectors(p, this.emitterPrev[i]).divideScalar(dt);
    }
  }
}

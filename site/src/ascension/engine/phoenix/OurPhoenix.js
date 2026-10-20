// OurPhoenix — the phoenix of the original project inside the Ascension world:
//   * the pose controller (beasts/fenix-flight.js): unified wings, 11-joint spine, tail on the body, steady head, sleep, wind,
//     shake, crouch, planted feet — driven by the Ascension flight state machine (its states / weights / trajectory);
//   * the look (beasts/fenix-look.js): fire-palette grade, crevice embers, heat bands, Fresnel rim, ember eyes; eyelids
//     (beasts/fenix-eyes.js) blink and stay shut while she sleeps.
// Replaces PhoenixRigController + PhoenixMaterials (their rig audit is kept: the flame emitters and the feet use it).
import * as THREE from 'three';
import { createFenixFlight, breathAt, gustAt } from '../../../beasts/fenix-flight.js';
import { applyFenixLook } from '../../../beasts/fenix-look.js';
import { applyEyes, blinkAt } from '../../../beasts/fenix-eyes.js';
import { U } from '../core/SharedUniforms.js';

const clamp = THREE.MathUtils.clamp;
const sm = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export class OurPhoenix {
  /** @param phoenix PhoenixModel (loaded, audited) */
  constructor(phoenix, envMap) {
    this.phoenix = phoenix;
    this.enabled = true;
    this.params = {};                                   // (the Experience writes the Ascension rig params here; we read what we need)
    this.flight = createFenixFlight(phoenix.gltf.scene);
    this.flight.CROUCH.splice(0, 5, 0.6, -0.6, -0.4, 0, 0.4);   // the roost crouch: toes stay flat
    // material: the original MeshStandardMaterial + our eyelids + our fire look
    const mat = phoenix.originalMaterial;
    mat.envMap = envMap; mat.envMapIntensity = 0.3; mat.metalness = 0.15; mat.side = THREE.DoubleSide;
    this.eyes = applyEyes(mat);
    this.look = applyFenixLook(phoenix.mesh);
    phoenix.mesh.material = mat;
    // the Experience pokes these uniforms on its own material: give it harmless stand-ins
    phoenix.premium = { userData: { uniforms: { uEnergy: { value: 0 }, uSunView: { value: new THREE.Vector3() }, uEmission: { value: 1 }, uRegionDebug: { value: 0 }, uPremium: { value: 1 } } } };
    phoenix.setOriginal = () => {};
    this._wind = new THREE.Vector3(); this._q = new THREE.Quaternion();
    // the feet's skinned vertices (dominant joint = ankle, foot or toes), a sample: contact is measured on the mesh
    const g = phoenix.mesh.geometry, si = g.attributes.skinIndex, sw = g.attributes.skinWeight, names = phoenix.mesh.skeleton.bones.map((b) => b.name);
    const footJ = new Set(['Bone_004', 'Bone_003', 'Bone_002', 'Bone_011', 'Bone_010', 'Bone_009'].map((n) => names.indexOf(n)));
    const fv = [];
    for (let i = 0; i < si.count; i++) { let b = 0, w = -1; for (let k = 0; k < 4; k++) { const ww = sw.getComponent(i, k); if (ww > w) { w = ww; b = si.getComponent(i, k); } } if (footJ.has(b)) fv.push(i); }
    const step = Math.max(1, Math.floor(fv.length / 220));
    this.footVerts = fv.filter((_, i) => i % step === 0);
    this._v = new THREE.Vector3(); this._c = new THREE.Vector3();
    this.P = {};
  }

  /** the lowest point of her feet above the terrain (world units), and the feet's mean xz */
  footContact(heightAt) {
    const m = this.phoenix.mesh, v = this._v, c = this._c.set(0, 0, 0);
    let low = Infinity;
    for (const i of this.footVerts) { m.getVertexPosition(i, v).applyMatrix4(m.matrixWorld); low = Math.min(low, v.y - heightAt(v.x, v.z)); c.x += v.x; c.z += v.z; }
    c.multiplyScalar(1 / this.footVerts.length);
    return { low, x: c.x, z: c.z };
  }

  /**
   * @param ctx { t: sequence time, time: wall clock, fo: flight output, flight: PhoenixFlightController, wind, camera }
   */
  update(dt, ctx) {
    if (!this.enabled) return;
    const { t, time, fo, flight, wind, camera } = ctx;
    const W = fo.weights, A = fo.params;
    const idle = W.IDLE || 0, ant = W.ANTICIPATION || 0, tko = W.TAKEOFF || 0, fl = W.FLIGHT || 0, gl = W.GLIDE || 0, hov = W.HOVER || 0;
    // the story on the perch: asleep through the opening, eyes open, head up, she shakes the plumage out, crouches, leaps
    const manual = !!flight.manual;
    const sleep = manual ? 0 : 1 - sm(3.6, 5.0, t);
    const eyesShut = manual ? 0 : 1 - sm(3.3, 3.7, t);
    const shake = manual ? 0 : sm(5.0, 5.4, t) * (1 - sm(6.2, 6.8, t));
    const ground = clamp(idle + ant + tko * (1 - sm(9.4, 9.8, t)), 0, 1);
    // wind in the model's frame
    this.phoenix.gltf.scene.getWorldQuaternion(this._q).invert();
    this._wind.copy(U.uWindDir.value).applyQuaternion(this._q).normalize();
    const P = this.P;
    P.t = time;
    P.phase = manual ? (time - flight.manual.t0) * 1.0 : flight.phaseAt(t);
    P.flap = A.flapAmp ?? 0;
    P.rate = 1.0;
    P.open = clamp(1 - (A.fold ?? 0.8) * 1.25, 0, 1) * (1 - sleep);
    P.sweep = A.sweep ?? 0;
    P.legs = A.legTuck ?? 0;
    P.tail = 0.45 + 0.5 * (A.tailSpread ?? 0.2);
    P.fly = clamp(A.posture ?? 0, 0, 1);
    P.stretch = clamp(gl + 0.5 * fl, 0, 1);
    P.bank = fo.bank ?? 0;
    P.pitch = fo.climb ?? 0;
    P.pitchRate = 0; P.yawRate = 0; P.load = 0;
    P.lookYaw = (A.lookYaw ?? 0) * 0.6 * (1 - sleep);
    P.lookPitch = (A.lookPitch ?? 0) * 0.5 * (1 - sleep);
    P.alert = clamp(idle * 0.6 + ant + hov * 0.6, 0, 1) * (1 - sleep);
    P.sleep = sleep; P.crouch = Math.max(sleep, ant * 0.6); P.hug = sleep;
    P.shake = shake; P.shakePh = t * 7.5;
    P.ground = ground;
    P.wind = (0.4 + 0.6 * wind.gust) * (1 - 0.7 * P.fly);
    P.windX = this._wind.x; P.windY = this._wind.y; P.windZ = this._wind.z;
    this.flight.pose(P);
    // eyes, and the look: she smoulders asleep, catches fire as she wakes
    const blink = Math.max(blinkAt(time), eyesShut);
    this.eyes.set(blink);
    const heat = (0.45 + 0.75 * (fo.energy ?? 0.5)) * (1 + 0.1 * sleep * breathAt(time));
    this.look.update({ time, heat, camera, sunDir: U.uSunDir.value, blink, breath: breathAt(time) * (0.35 + 0.65 * sleep), wind: P.wind * (0.5 + 0.5 * gustAt(time, 0)) });
  }
}

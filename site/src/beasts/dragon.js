// Qinglong (the dragon): runtime controller for the rig built by tools/rigs/dragon.mjs.
//   spine     Spline IK on a guide curve (SplineIK): 12 handles drive the 52-joint chain; the skin is cubic-B-spline
//             weighted (Bendy-Bone smoothness), so the scales slide instead of creasing.
//   head      own joint under the neck top; partially stabilised against the body wave
//   whiskers  Verlet strands (stiffness fades root -> tip) with gravity + wind
//   mane      Verlet strands, one lock per spine bin
//   legs      two-bone IK anchored to the spine: 'passive' (they dangle, lag and swing with the body), 'rest', or 'orb'
//             (the claws close around an imaginary sphere)
// Usage:  const dragon = createDragon(gltf.scene);  every frame: dragon.update(dt);  then render.
import * as THREE from 'three';
import { collectBones, SplineIK, Strand, twoBoneKnee, swing, frameQuat, clamp, lerp, smoothstep } from './rigkit.js';

const { Vector3: V3, Quaternion: Q4, Matrix4: M4 } = THREE;
const TAU = Math.PI * 2;
const pad2 = (i) => String(i).padStart(2, '0');

export const DRAGON_DEFAULTS = {
  amp: 1,                 // overall amount of undulation (0 = the sculpted pose)
  lateral: 0.085,         // side-to-side wave amplitude at the tail tip, creature height = 1
  vertical: 0.045,        // up-down wave amplitude at the tail tip
  waveLength: 1.55,       // wavelength along the body
  frequency: 0.55,        // Hz
  tailGain: 1.0,          // how much the amplitude grows toward the tail
  lag: 0.0,               // extra phase offset between lateral and vertical waves (radians)
  headYaw: 0, headPitch: 0, headRoll: 0,   // radians, relative to the neck
  headStabilise: 0.45,    // 0 = head rides the neck, 1 = head keeps its own orientation against the wave
  legMode: 'passive',     // 'passive' | 'rest' | 'orb'
  legRelax: 0.30,         // passive legs: how far gravity swings the foot toward the vertical under the hip (0..1)
  orbHold: 0,             // 0..1 how far the claws have closed on the orb
  orbCenter: [0.02, -0.33, -0.70], orbRadius: 0.085,   // rest-pose position of the orb (model space), in front of the chest
  orbLegs: ['FL', 'FR'],                               // which legs hold it (the others stay passive)
  wind: [0, 0, 0], gravity: 3.0,
};

export function createDragon(scene, options = {}) {
  const P = { ...DRAGON_DEFAULTS, ...options };
  const bones = collectBones(scene);
  let meta = null;
  scene.traverse((o) => { if (o.userData?.rig === 'dragon') meta = o.userData; });
  if (!meta) throw new Error('createDragon: no dragon rig found in this scene');
  const nSpine = meta.spine.count;

  // ── spine: chain ordered root (neck top) -> tail tip
  const chain = [];
  for (let i = nSpine - 1; i >= 0; i--) chain.push(bones.get(`Spine_${pad2(i)}`));
  const ik = new SplineIK(chain, { handles: 12, side: new V3(1, 0, 0) });
  // pinch limit: a joint may not bend tighter than the local body radius allows (radius comes from the rig builder)
  const rad = meta.spineRadius;
  if (rad) ik.setMaxBend(chain.map((_, c) => { const r = rad[nSpine - 1 - c]; return Math.min(0.9, ik.len[Math.min(c, ik.n - 2)] / (1.1 * r)); }));
  const arc = [0]; for (let i = 1; i < ik.n; i++) arc.push(arc[i - 1] + ik.len[i - 1]);
  const Ltot = arc[arc.length - 1];
  const handleArc = ik.handleIndex.map((i) => arc[i]);
  const head = bones.get('Head');
  scene.updateMatrixWorld(true);
  // orb anchor: expressed in the frame of a chest bone so it follows the body
  const orbBone = bones.get('Spine_40') ?? chain[Math.floor(chain.length * 0.2)];
  const orbLocal = new V3(...P.orbCenter).sub(new V3().setFromMatrixPosition(orbBone.matrixWorld).applyMatrix4(new M4().copy(scene.matrixWorld).invert()));

  // ── strands
  const whiskers = (meta.whiskers ?? []).map((n) => {
    const b = []; for (let k = 1; bones.has(`Whisker_${n}_${k}`); k++) b.push(bones.get(`Whisker_${n}_${k}`));
    return new Strand(b, bones.get(`Whisker_${n}_Tip`), scene, { stiffRoot: 0.30, stiffTip: 0.012, damping: 0.972, gravity: 0.5 });
  });
  const manes = (meta.mane ?? []).map((id) => {
    const b = []; for (let k = 1; bones.has(`Mane_${id}_${k}`); k++) b.push(bones.get(`Mane_${id}_${k}`));
    return new Strand(b, bones.get(`Mane_${id}_Tip`), scene, { stiffRoot: 0.55, stiffTip: 0.10, damping: 0.95, gravity: 0.35 });
  });

  // ── legs
  const legs = (meta.legs ?? []).map((name) => {
    const L = [1, 2, 3, 4].map((k) => bones.get(`Leg_${name}_${k}`));
    const tip = bones.get(`Leg_${name}_Tip`);
    const all = [...L, tip];
    const inv = new M4().copy(scene.matrixWorld).invert();
    const p0 = all.map((b) => new V3().setFromMatrixPosition(b.matrixWorld).applyMatrix4(inv));
    const upper = p0[0].distanceTo(p0[1]), lower = p0[1].distanceTo(p0[2]);
    const line = p0[2].clone().sub(p0[0]).normalize();
    let pole = p0[1].clone().sub(p0[0]); pole.addScaledVector(line, -pole.dot(line));
    if (pole.lengthSq() < 1e-8) pole.set(0, 0, -1);
    pole.normalize();
    const nRest = line.clone().cross(pole).normalize();
    const d1 = p0[1].clone().sub(p0[0]).normalize(), d2 = p0[2].clone().sub(p0[1]).normalize();
    return {
      name, bones: L, parent: L[0].parent, p0, upper, lower, pole, nRest, restReach: p0[0].distanceTo(p0[2]),
      F1rest: frameQuat(d1, nRest, new Q4()), F2rest: frameQuat(d2, nRest, new Q4()),
      follow: p0[2].clone(), vel: new V3(), first: true, W1: new Q4(), W2: new Q4(),
      side: p0[0].x < 0 ? -1 : 1,
    };
  });

  let orbMarker = null;                                // optional debug sphere (params.showOrb)
  // never let a bone snap: per-group angular speed limit (radians per 1/60 s). Normal motion is far below these.
  const slew = [];
  const addSlew = (list, limit) => list.forEach((b) => b && slew.push({ b, limit, prev: b.quaternion.clone() }));
  addSlew(chain, 0.12); addSlew([head], 0.16); addSlew(legs.flatMap((l) => l.bones), 0.30);
  addSlew([...whiskers, ...manes].flatMap((s) => s.bones), 0.35);
  const slewTmp = new Q4();
  const applySlew = (dt) => {
    const k = Math.max(0.25, dt * 60);
    for (const e of slew) {
      const a = e.b.quaternion.angleTo(e.prev), lim = e.limit * k;
      if (a > lim) { slewTmp.copy(e.prev).slerp(e.b.quaternion, lim / a); e.b.quaternion.copy(slewTmp); }   // move from the previous pose toward the target by at most `lim`
      e.prev.copy(e.b.quaternion);
    }
  };
  const state = { t: 0, headQ: new Q4() };
  const tmpQ = new Q4(), tmpV = new V3(), tmpV2 = new V3(), tmpM = new M4();
  const knee = new V3(), ankle = new V3(), gLocal = new V3(), wLocal = new V3(), _gp = new V3(), _gq = new Q4(), _gs = new V3(), _gqi = new Q4();

  function updateSpine() {
    const w = TAU / P.waveLength, ph = TAU * P.frequency * state.t;
    for (let k = 0; k < ik.handles.length; k++) {
      const rest = ik.restHandles[k], s = handleArc[k], u = s / Ltot;                 // u: 0 at the neck, 1 at the tail tip
      const env = (0.10 + 0.90 * Math.pow(u, 1.35)) * P.tailGain;
      // the wave travels from head to tail
      const lat = P.lateral * P.amp * env * Math.sin(w * s - ph);
      const ver = P.vertical * P.amp * env * Math.sin(w * s - ph + 1.2 + P.lag);
      ik.handles[k].set(rest.x + lat, rest.y + ver, rest.z);
    }
    ik.solve();
  }

  function updateHead() {
    // keep part of the head's world orientation against the neck-top rotation (less whip at the skull)
    const wTop = ik.W[0];                                           // world rotation of the neck-top bone
    tmpQ.identity().slerp(_inv(wTop), P.headStabilise);
    state.headQ.setFromEuler(new THREE.Euler(P.headPitch, P.headYaw, P.headRoll, 'YXZ'));
    head.quaternion.copy(tmpQ).multiply(state.headQ);
  }
  const _invQ = new Q4();
  const _inv = (q) => _invQ.copy(q).invert();

  function updateLegs(dt) {
    const inv = tmpM.copy(scene.matrixWorld).invert();
    gLocal.set(0, -1, 0);
    // the orb floats in front of the chest: anchored to a spine bone, so it travels and turns with the body
    const om = new M4().multiplyMatrices(inv, orbBone.matrixWorld);
    const orb = orbLocal.clone().applyQuaternion(new Q4().setFromRotationMatrix(om)).add(new V3().setFromMatrixPosition(om));
    if (P.showOrb) {
      if (!orbMarker) { orbMarker = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshStandardMaterial({ color: 0xffb347, emissive: 0xaa5500, transparent: true, opacity: 0.55 })); scene.add(orbMarker); }
      orbMarker.position.copy(orb); orbMarker.scale.setScalar(P.orbRadius);
    }
    for (const lg of legs) {
      const par = lg.parent;
      const pm = new M4().multiplyMatrices(inv, par.matrixWorld);
      const parQ = new Q4().setFromRotationMatrix(pm), parPos = new V3().setFromMatrixPosition(pm);
      const hip = lg.bones[0].position.clone().applyQuaternion(parQ).add(parPos);
      const attached = lg.p0[2].clone().sub(lg.p0[0]).applyQuaternion(parQ).add(hip);   // ankle carried by the body
      let target = attached;
      const holds = P.legMode === 'orb' && P.orbHold > 0 && P.orbLegs.includes(lg.name);
      if (holds) {
        const n = attached.clone().sub(orb); const l = n.length() || 1;
        const onSphere = orb.clone().addScaledVector(n, (P.orbRadius * 1.04) / l);
        target = attached.clone().lerp(onSphere, smoothstep(P.orbHold, 0, 1));
      }
      if (P.legMode === 'rest') {
        lg.follow.copy(target); lg.vel.set(0, 0, 0);
      } else {
        // damped spring: the foot lags the body, overshoots and settles; gravity sags it a little
        const relax = holds ? 0.0 : P.legRelax;
        const dist = target.distanceTo(hip) || 1e-6;
        const dirT = target.clone().sub(hip).normalize();
        const goal = hip.clone().addScaledVector(dirT.lerp(gLocal, relax).normalize(), dist);
        if (lg.first) { lg.follow.copy(target); lg.first = false; }      // start exactly on the sculpted pose, then relax
        const steps = Math.max(1, Math.round(dt * 120)), h = dt / steps, k = 70, c = 7.5;
        for (let s = 0; s < steps; s++) {
          tmpV.copy(goal).sub(lg.follow).multiplyScalar(k).addScaledVector(lg.vel, -c);
          lg.vel.addScaledVector(tmpV, h); lg.follow.addScaledVector(lg.vel, h);
        }
      }
      const poleW = lg.pole.clone().applyQuaternion(parQ);
      twoBoneKnee(hip, lg.follow, lg.upper, lg.lower, poleW, knee, ankle, lg.restReach);
      const d1 = knee.clone().sub(hip).normalize(), d2 = ankle.clone().sub(knee).normalize();
      const dirAT = ankle.clone().sub(hip).normalize();
      const nPose = dirAT.clone().cross(poleW).normalize();
      lg.W1.copy(frameQuat(d1, nPose, new Q4())).multiply(tmpQ.copy(lg.F1rest).invert());
      lg.W2.copy(frameQuat(d2, nPose, new Q4())).multiply(tmpQ.copy(lg.F2rest).invert());
      const [b1, b2, b3, b4] = lg.bones;
      b1.quaternion.copy(tmpQ.copy(parQ).invert()).multiply(lg.W1);
      b2.quaternion.copy(tmpQ.copy(lg.W1).invert()).multiply(lg.W2);
      // foot: rides the shin; the claws close around the orb as it is held
      const curl = P.legMode === 'orb' && P.orbLegs.includes(lg.name) ? smoothstep(P.orbHold, 0, 1) : 0;
      b3.quaternion.setFromAxisAngle(lg.nRest, curl * 0.45 * lg.side);
      b4.quaternion.setFromAxisAngle(lg.nRest, curl * 0.70 * lg.side);
    }
  }

  function updateStrands(dt) {
    const t = state.t;
    scene.matrixWorld.decompose(_gp, _gq, _gs); _gqi.copy(_gq).invert();
    gLocal.set(0, -P.gravity, 0).applyQuaternion(_gqi);       // world down, in model space
    let n = 0;
    for (const s of [...whiskers, ...manes]) {
      // a little turbulence so no two locks move together
      const ph = n++ * 1.7;
      wLocal.set(P.wind[0] + 0.5 * Math.sin(t * 1.3 + ph), P.wind[1] + 0.3 * Math.sin(t * 1.9 + ph * 0.7), P.wind[2] + 0.5 * Math.sin(t * 1.1 + ph * 1.3)).applyQuaternion(_gqi);
      s.update(dt, gLocal, wLocal);
    }
  }

  return {
    params: P, ik, legs, whiskers, manes, head,
    get time() { return state.t; },
    get orbMarker() { return orbMarker; },
    update(dt) {
      dt = Math.min(dt, 1 / 20);
      state.t += dt;
      updateSpine();
      updateHead();
      scene.updateMatrixWorld(true);                    // the ONLY full update: legs and strands only read their parents
      if (P.legs !== false) updateLegs(dt);
      if (P.strands !== false) updateStrands(dt);
      if (P.slew !== false) applySlew(dt);
    },
    /** deterministic pose for tests: sets the time and settles the dynamic parts */
    pose(opts = {}) {
      Object.assign(P, opts);
      const t = opts.t ?? state.t;
      const settle = opts.settle ?? 90;
      state.t = Math.max(0, t - settle / 60);
      for (let i = 0; i < settle; i++) this.update(1 / 60);
      scene.updateMatrixWorld(true);
    },
  };
}

export default async function create(THREE_, gltf, scene) {
  return createDragon(gltf.scene);
}

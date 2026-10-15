// Zhuque / Fenghuang (the phoenix): runtime controller for the rig built by tools/rigs/fenix.mjs.
//   wings    shoulder -> elbow -> wrist two-bone IK (target = folded .. sculpted .. extended, plus a flap angle) and, hanging
//            from the arm, FEATHER COLUMNS that fan open progressively with the arm (outer columns rotate more): they spread
//            in order, so layers slide over each other instead of crossing (no clipping).
//   neck     the head turn is shared along six neck bones (gradient), the chest never feels it
//   tail     every plume is a short Spline IK with TWO controllers: base and tip. The tip follows with inertia.
//   legs     FK tuck (flight) / extend (perch)
//   crest    Verlet strands (crest feathers and the two long face streamers)
// Usage:  const phx = createFenix(gltf.scene);  every frame: phx.update(dt);  params in phx.params.
import * as THREE from 'three';
import { collectBones, SplineIK, Strand, twoBoneKnee, frameQuat, clamp, lerp, smoothstep } from './rigkit.js';

const { Vector3: V3, Quaternion: Q4, Matrix4: M4 } = THREE;
const TAU = Math.PI * 2;
const FOLD_ANGLE = 0.95;              // elbow interior angle (rad) of the fully flexed wing (open = minOpen)
const pad2 = (i) => String(i).padStart(2, '0');

export const FENIX_DEFAULTS = {
  open: 0.75,            // 0.35 = half folded, 0.75 = the sculpted pose, 1 = extended, up to 1.3 (below minOpen it is clamped)
  minOpen: 0.35,         // the sculpt is a spread wing: folding it past this tears the feather sheets (see tools/rigs/README.md)
  flap: 0,               // radians: wings up (+) / down (-) about the body's long axis
  sweep: 0,              // radians: wings swept back (+) / forward (-) about the vertical axis through the shoulder
  wingBalance: 0,        // radians: raises the lower (sculpt's right) wing and lowers the higher one so both beat about the same level
  fanGain: 1.0,          // how strongly the feathers fan with the arm
  fanCurl: 0.35,         // extra bend along each feather (tips curl) as they fan
  fanClose: 0.35,        // radians the outermost feather column swings when the wing is fully folded
  fanSpread: 0.42,       // ... and when it is fully extended
  lookYaw: 0, lookPitch: 0, lookRoll: 0,   // head, radians (shared along the neck)
  legTuck: 0,            // 0 = standing, 1 = tucked for flight
  plumeWave: 0.08,       // amplitude of the plume undulation
  plumeSpeed: 0.7,       // Hz
  plumeLag: 0.18,        // how far the plume tips trail behind the body motion
  featherTrail: 0,       // radians: feather tips lag the beat (about the span axis); the hover driver feeds it from the flap speed
  bodyAccel: [0, 0, 0],  // model-space acceleration of the body: the plume tips and crest trail against it
  plumeInertia: 0.012,   // how strongly bodyAccel pulls the plume tips (units per unit acceleration)
  wind: [0, 0, 0], gravity: 2.4,
};

export function createFenix(scene, options = {}) {
  const P = { ...FENIX_DEFAULTS, ...options };
  const bones = collectBones(scene);
  let meta = null;
  scene.traverse((o) => { if (o.userData?.rig === 'fenix') meta = o.userData; });
  if (!meta) throw new Error('createFenix: no phoenix rig found in this scene');
  scene.updateMatrixWorld(true);
  const inv0 = new M4().copy(scene.matrixWorld).invert();
  const restPos = (b) => new V3().setFromMatrixPosition(b.matrixWorld).applyMatrix4(inv0);

  const pelvis = bones.get('Pelvis');
  const spine = []; for (let k = 1; bones.has(`Spine_${k}`); k++) spine.push(bones.get(`Spine_${k}`));
  const neck = []; for (let k = 1; bones.has(`Neck_${k}`); k++) neck.push(bones.get(`Neck_${k}`));
  const head = bones.get('Head');

  // ── wings
  const wings = meta.wings.map((w) => {
    const S = bones.get(`Wing_${w.tag}_Shoulder`), E = bones.get(`Wing_${w.tag}_Elbow`), Wr = bones.get(`Wing_${w.tag}_Wrist`), H = bones.get(`Wing_${w.tag}_Hand`);
    const p0 = [S, E, Wr, H].map(restPos);
    const upper = p0[0].distanceTo(p0[1]), lower = p0[1].distanceTo(p0[2]);
    const line = p0[2].clone().sub(p0[0]).normalize();
    let pole = p0[1].clone().sub(p0[0]); pole.addScaledVector(line, -pole.dot(line));
    if (pole.lengthSq() < 1e-8) pole.set(0, 1, 0);
    pole.normalize();
    const nRest = line.clone().cross(pole).normalize();
    const d1 = p0[1].clone().sub(p0[0]).normalize(), d2 = p0[2].clone().sub(p0[1]).normalize(), d3 = p0[3].clone().sub(p0[2]).normalize();
    // feather columns: chain bones + the fan axis (normal of the wing sheet at the column)
    const armDir = p0[3].clone().sub(p0[0]).normalize();
    const columns = w.fan.map(({ k, s }) => {
      const id = pad2(k), chain = []; for (let m = 1; bones.has(`Wing_${w.tag}_F${id}_${m}`); m++) chain.push(bones.get(`Wing_${w.tag}_F${id}_${m}`));
      const tip = bones.get(`Wing_${w.tag}_F${id}_Tip`);
      const a = restPos(chain[0]), b = restPos(tip);
      const fdir = b.clone().sub(a).normalize();
      const axis = armDir.clone().cross(fdir);
      if (axis.lengthSq() < 1e-6) axis.set(0, 1, 0);
      axis.normalize();
      return { k, s, chain, axis };
    });
    return {
      tag: w.tag, side: w.side, bones: { S, E, Wr, H }, p0, upper, lower, pole, nRest, restReach: p0[0].distanceTo(p0[2]),
      F1rest: frameQuat(d1, nRest, new Q4()), F2rest: frameQuat(d2, nRest, new Q4()), F3rest: frameQuat(d3, nRest, new Q4()),
      columns, W1: new Q4(), W2: new Q4(), W3: new Q4(),
    };
  });

  // ── tail plumes: SplineIK with two controllers each (base, tip)
  const plumes = meta.plumes.map((name, i) => {
    const chain = []; for (let k = 1; bones.has(`Tail_${name}_${k}`); k++) chain.push(bones.get(`Tail_${name}_${k}`));
    const ik = new SplineIK(chain, { handles: 4, side: new V3(1, 0, 0) });
    const base = new V3(), tip = new V3(), tipVel = new V3(), tipFollow = new V3();
    return { name, ik, base, tip, tipVel, tipFollow, phase: i * 1.37 + 0.4, first: true };
  });

  // ── legs
  const legs = meta.legs.map((tag) => {
    const L = [1, 2, 3, 4].map((k) => bones.get(`Leg_${tag}_${k}`));
    return { tag, bones: L, side: tag === 'L' ? -1 : 1 };
  });

  // ── crest strands
  const crest = meta.crest.map((id) => {
    const b = []; for (let k = 1; bones.has(`Crest_${id}_${k}`); k++) b.push(bones.get(`Crest_${id}_${k}`));
    return new Strand(b, bones.get(`Crest_${id}_Tip`), scene, { stiffRoot: 0.35, stiffTip: 0.02, damping: 0.96, gravity: 0.4 });
  });

  const state = { t: 0 };
  const tmpQ = new Q4(), tmpV = new V3(), knee = new V3(), ankle = new V3(), gL = new V3(), wL = new V3();
  const AX = new V3(1, 0, 0), AY = new V3(0, 1, 0), AZ = new V3(0, 0, 1);
  const euler = new THREE.Euler();
  const trailQ = new Q4(), _gp = new V3(), _gq = new Q4(), _gs = new V3(), _gqi = new Q4();

  // never let a bone snap (radians per 1/60 s)
  const slew = [];
  const addSlew = (list, limit) => list.forEach((b) => b && slew.push({ b, limit, prev: b.quaternion.clone() }));
  addSlew(neck, 0.10); addSlew([head], 0.16);
  addSlew(wings.flatMap((w) => [w.bones.S, w.bones.E, w.bones.Wr, w.bones.H]), 0.22);
  addSlew(wings.flatMap((w) => w.columns.flatMap((c) => c.chain)), 0.10);
  addSlew(plumes.flatMap((p) => p.ik.bones), 0.12);
  addSlew(legs.flatMap((l) => l.bones), 0.12);
  addSlew(crest.flatMap((s) => s.bones), 0.20);
  const slewTmp = new Q4();
  const applySlew = (dt) => {
    const k = Math.max(0.25, dt * 60);
    for (const e of slew) {
      const a = e.b.quaternion.angleTo(e.prev), lim = e.limit * k;
      if (a > lim) { slewTmp.copy(e.prev).slerp(e.b.quaternion, lim / a); e.b.quaternion.copy(slewTmp); }   // move from the previous pose toward the target by at most `lim`
      e.prev.copy(e.b.quaternion);
    }
  };

  function updateNeck() {
    // the head turn is shared along the neck with a growing share toward the skull; the chest (Spine_*) never moves
    const shares = [0.04, 0.08, 0.13, 0.19, 0.26, 0.30];
    for (let i = 0; i < neck.length; i++) {
      const f = shares[i] ?? 0.1;
      euler.set(P.lookPitch * f, P.lookYaw * f, P.lookRoll * f, 'YXZ');
      neck[i].quaternion.setFromEuler(euler);
    }
    head.quaternion.identity();
  }

  function updateWings() {
    scene.updateMatrixWorld(true);
    const inv = tmpQ && new M4().copy(scene.matrixWorld).invert();
    const open = Math.max(P.minOpen, P.open), sculpt = 0.75;
    const fold = open < sculpt ? 1 - open / sculpt : 0;
    const ext = open > sculpt ? Math.min(1, (open - sculpt) / 0.55) : 0;
    const fan = open < sculpt ? -(1 - open / sculpt) : ext;                     // -1 closed .. 0 sculpt .. +1 spread
    for (const w of wings) {
      const { S, E, Wr, H } = w.bones;
      const par = S.parent;
      const pm = new M4().multiplyMatrices(inv, par.matrixWorld);
      const parQ = new Q4().setFromRotationMatrix(pm), parPos = new V3().setFromMatrixPosition(pm);
      const shoulder = S.position.clone().applyQuaternion(parQ).add(parPos);
      // wrist target in the parent's frame: folded <- sculpt -> extended, then flap / sweep about the shoulder
      // the opening is commanded as the ELBOW's interior angle (what the muscles do), not as a distance: the distance is a
      // very non-linear function of the angle near the straight arm (it made the elbow snap there)
      const vRest = w.p0[2].clone().sub(w.p0[0]);
      const u = w.upper, l = w.lower, d0 = w.restReach;
      const a0 = Math.acos(clamp((u * u + l * l - d0 * d0) / (2 * u * l), -1, 1));
      const ang = open >= sculpt ? a0 + (Math.PI * 0.975 - a0) * ext : a0 - (a0 - FOLD_ANGLE) * fold;
      const dist = Math.sqrt(Math.max(1e-6, u * u + l * l - 2 * u * l * Math.cos(ang)));
      const back = new V3(w.side * 0.35, 0.3, 1).normalize();          // a folding wing also comes back along the body
      const v = vRest.clone().normalize().lerp(back, fold * 0.55).normalize().multiplyScalar(dist);
      v.applyAxisAngle(AZ, (P.flap + P.wingBalance * w.side) * w.side);    // balance: the sculpt's right wing is lower than the left
      v.applyAxisAngle(AY, -P.sweep * w.side);
      const target = v.applyQuaternion(parQ).add(shoulder);
      // the beat is a RIGID rotation of the whole wing about the shoulder: the elbow's bend plane (the pole) must turn with it,
      // otherwise the arm rolls about its own axis as it rises and the feather curtain twists and crumples
      const poleW = w.pole.clone().applyAxisAngle(AZ, (P.flap + P.wingBalance * w.side) * w.side).applyAxisAngle(AY, -P.sweep * w.side).applyQuaternion(parQ);
      twoBoneKnee(shoulder, target, w.upper, w.lower, poleW, knee, ankle);
      const d1 = knee.clone().sub(shoulder).normalize(), d2 = ankle.clone().sub(knee).normalize();
      const dirAT = ankle.clone().sub(shoulder).normalize();
      const nPose = dirAT.clone().cross(poleW).normalize();
      w.W1.copy(frameQuat(d1, nPose, new Q4())).multiply(tmpQ.copy(w.F1rest).invert());
      w.W2.copy(frameQuat(d2, nPose, new Q4())).multiply(tmpQ.copy(w.F2rest).invert());
      S.quaternion.copy(tmpQ.copy(parQ).invert()).multiply(w.W1);
      E.quaternion.copy(tmpQ.copy(w.W1).invert()).multiply(w.W2);
      Wr.quaternion.identity();
      H.quaternion.identity();
      // feather columns fan about the sheet normal; outer columns rotate more; tips curl a little
      for (const c of w.columns) {
        // closing needs ~80 degrees (the feathers lie along the arm); opening spreads them by ~30
        const g = P.fanGain * fan * (0.25 + 0.75 * c.s);
        const ang = g * (fan < 0 ? P.fanClose : P.fanSpread);
        c.chain.forEach((b, i) => {
          const share = i === 0 ? 1 : P.fanCurl * (0.7 - 0.2 * i);
          b.quaternion.setFromAxisAngle(c.axis, -ang * share);
          if (P.featherTrail) {                       // the longer the feather and the farther along it, the more it lags
            const k = P.featherTrail * (0.35 + 0.65 * c.s) * (i + 1) / c.chain.length;
            b.quaternion.premultiply(trailQ.setFromAxisAngle(AX, k));
          }
        });
      }
    }
  }

  function updatePlumes(dt) {
    const t = state.t, w = TAU * P.plumeSpeed;
    for (const p of plumes) {
      const ik = p.ik, n = ik.handles.length;
      // the tip controller: where the plume tip would hang, plus a travelling wave, followed with inertia
      const sway = P.plumeWave;
      const restTip = ik.restHandles[n - 1];
      p.tip.set(Math.sin(w * t + p.phase) * sway, Math.sin(w * t * 0.8 + p.phase * 1.7) * sway * 0.6, 0);
      const goal = tmpV.copy(restTip).add(p.tip);
      goal.x -= P.bodyAccel[0] * P.plumeInertia; goal.y -= P.bodyAccel[1] * P.plumeInertia; goal.z -= P.bodyAccel[2] * P.plumeInertia;
      if (p.first) { p.tipFollow.copy(goal); p.first = false; }
      const steps = Math.max(1, Math.round(dt * 120)), h = dt / steps, k = 40 / (0.4 + P.plumeLag * 4), c = 5.5;
      for (let s = 0; s < steps; s++) {
        tmpQ.identity();
        p.tipVel.addScaledVector(wL.copy(goal).sub(p.tipFollow).multiplyScalar(k).addScaledVector(p.tipVel, -c), h);
        p.tipFollow.addScaledVector(p.tipVel, h);
      }
      for (let j = 0; j < n; j++) {
        const u = j / (n - 1), rest = ik.restHandles[j];
        // base handle stays; the others lie between rest and the following tip, plus a gentle S
        const disp = tmpV.copy(p.tipFollow).sub(restTip).multiplyScalar(u * u);
        const wave = Math.sin(TAU * u + w * t * 0.6 + p.phase) * sway * 0.9 * u;
        ik.handles[j].copy(rest).add(disp);
        ik.handles[j].x += wave; ik.handles[j].y += wave * 0.4;
      }
      ik.handles[0].copy(ik.restHandles[0]).add(p.base);
      ik.solve();
    }
  }

  function updateLegs() {
    for (const lg of legs) {
      const [a, b, c, d] = lg.bones, k = P.legTuck;
      a.quaternion.setFromAxisAngle(AX, -0.9 * k);
      b.quaternion.setFromAxisAngle(AX, 1.5 * k);
      c.quaternion.setFromAxisAngle(AX, -0.7 * k);
      d.quaternion.setFromAxisAngle(AX, 0.6 * k);
    }
  }

  function updateCrest(dt) {
    scene.updateMatrixWorld(true);
    scene.matrixWorld.decompose(_gp, _gq, _gs); _gqi.copy(_gq).invert();
    gL.set(0, -P.gravity, 0).applyQuaternion(_gqi);          // world down, in model space
    let n = 0;
    for (const s of crest) {
      const ph = n++ * 1.3;
      wL.set(P.wind[0] + 0.4 * Math.sin(state.t * 1.4 + ph), P.wind[1] + 0.25 * Math.sin(state.t * 1.9 + ph), P.wind[2] + 0.4 * Math.sin(state.t * 1.1 + ph * 1.2)).applyQuaternion(_gqi);
      s.update(dt, gL, wL);
    }
  }

  return {
    params: P, wings, plumes, legs, crest, head, neck, pelvis,
    get time() { return state.t; },
    update(dt) {
      dt = Math.min(dt, 1 / 20);
      state.t += dt;
      updateNeck();
      updatePlumes(dt);
      updateLegs();
      updateWings();
      updateCrest(dt);
      if (P.slew !== false) applySlew(dt);
    },
    pose(opts = {}) {
      Object.assign(P, opts);
      const t = opts.t ?? state.t, settle = opts.settle ?? 90;
      state.t = Math.max(0, t - settle / 60);
      for (let i = 0; i < settle; i++) this.update(1 / 60);
      scene.updateMatrixWorld(true);
    },
  };
}

export default async function create(THREE_, gltf) {
  return createFenix(gltf.scene);
}

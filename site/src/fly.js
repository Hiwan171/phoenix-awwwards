// FLIGHT TEST (14/10): the phoenix flies a story over the dusk sky, driven by scroll (or an automatic loop):
//   I   she comes out of the distance, CROSSES the lens close to the camera and leaves
//   II  she circles up, tips over and DIVES (wings swept back against the body)
//   III she pulls out low over the sea and CLIMBS back toward the sun (powerful, fast wing-beats)
// Nothing is a baked clip: position, body attitude, wings, neck are piloted by code (see wingflight.js for the wings):
//   * position  = a spline by arc length; the scroll speed IS the flight speed (stop = she hovers in place)
//   * heading   = the direction of travel (low-passed); bank = how fast the heading turns; the inner wing is lower/flexed
//   * attitude  = upright when hovering, laid down with the head leading in cruise, nose-down in the dive
//   * wings     = wingflight.js: a shape per stroke phase (elevation, sweep, elbow/wrist flexion, twist)
//   * camera    = a fixed lens that follows her with lag (pan + tilt); the sky pans and tilts with it
import './style.css';
import '@fontsource/geist-mono/400.css';
import * as THREE from 'three';
import { createStage } from './stage.js';
import { createWingRig } from './wingflight.js';

const Q = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const lite = Q.get('lite') === '1' || innerWidth < 760 || matchMedia('(pointer: coarse)').matches || (navigator.deviceMemory ?? 8) <= 4;
const D = Math.PI / 180, TAU = Math.PI * 2;
const sstep = THREE.MathUtils.smoothstep, clamp = THREE.MathUtils.clamp, lerp = THREE.MathUtils.lerp;

// ───────── the path: (sx = screen right, sy = up, sz = away from the lens); the camera sits at z = -2.6 ─────────
const W = (sx, sy, sz) => new THREE.Vector3(-sx, sy, sz);          // the camera looks +z, so screen-right is world -x
const POINTS = [
  W( 3.6, 1.00, 6.4),   //  0 comes out of the distance, far right, high
  W( 2.2, 0.70, 4.2),   //  1
  W( 0.7, 0.42, 1.6),   //  2 approaching the lens
  W(-0.5, 0.34, -0.1),  //  3 CROSSES the camera (closest point)
  W(-2.0, 0.55, 1.5),   //  4 leaves to the left
  W(-3.0, 1.10, 3.6),   //  5 turns up and around
  W(-2.4, 1.90, 5.2),   //  6
  W(-0.6, 2.25, 5.8),   //  7 top of the arc, over the sun
  W( 0.9, 1.80, 5.1),   //  8 tips over
  W( 1.6, 0.60, 3.9),   //  9 DIVE
  W( 1.6,-0.80, 2.8),   // 10
  W( 0.9,-1.60, 2.4),   // 11 bottom, just above the water
  W(-0.1,-1.35, 3.1),   // 12 pulls out
  W(-0.9,-0.30, 4.4),   // 13 CLIMB
  W(-0.7, 1.10, 5.6),   // 14
  W( 0.1, 2.50, 6.6),   // 15 up toward the sun
];
// pull the whole path toward the lens (she reads small at distance); the crossing near z = 0 is kept
const DEPTH = +(Q.get('depth') ?? 0.72);
POINTS.forEach((pt) => { pt.z = 0.0 + (pt.z - 0.0) * DEPTH; });
const curve = new THREE.CatmullRomCurve3(POINTS, false, 'centripetal');
const LEN = curve.getLength();

// ───────── tunables (URL) ─────────
const T = {
  autoDur: +(Q.get('dur') ?? 56),            // seconds for one pass in auto-flight
  bank: +(Q.get('bank') ?? 0.7),             // roll per rad/s of heading change
  lay: +(Q.get('lay') ?? 1.0),               // 0..1 how far she lays down in cruise
  neck: +(Q.get('neck') ?? 100),             // degrees of neck/head compensation at full cruise
  fMin: +(Q.get('fmin') ?? 1.1), fMax: +(Q.get('fmax') ?? 2.5),   // wing-beat frequency range (Hz)
  flex: +(Q.get('flex') ?? 0.8),             // how much the elbow/wrist fold on the upstroke (0..1)
  amp: +(Q.get('amp') ?? 1.0),               // overall stroke amplitude
  twist: +(Q.get('twist') ?? 1.0),           // feather pronation/supination (negative flips it)
  stab: +(Q.get('stab') ?? 0.5),             // head stabilisation against the body roll (0..1)
};

// ───────── stage + state ─────────
const S = {};
const stage = createStage({ canvas: $('gl'), lite, reduced });
let auto = Q.get('auto') === '1' || Q.has('u');
const frozenU = Q.has('u') ? clamp(+Q.get('u'), 0, 1) : null;
const forceV = Q.has('v') ? +Q.get('v') : null;           // QA: with ?u= pretend she flies at this speed
const forceDir = Q.get('dir') === '-1' ? -1 : 1;
const QV = Q.get('view');
const FREEZE = forceV !== null;
addEventListener('keydown', (e) => { if (e.code === 'Space') { e.preventDefault(); auto = !auto; $('h-auto').textContent = auto ? 'SPACE: back to scroll' : 'SPACE: auto-flight'; } });

const st = {
  u: 0, dU: 0, dir: 1, t: 0, uTarget: 0,
  f: new THREE.Vector3(0, 0, 1), h: new THREE.Vector3(0, 0, 1),
  yawRate: 0, bank: 0, w: 0, G: 0, dive: 0, climb: 0, e: 0.3, phase: 0, v: 0, flex: 0.5,
  camTarget: new THREE.Vector3(0, 0.4, 1.6), camPos: new THREE.Vector3(0, 0.4, -2.6),
};
const pos = new THREE.Vector3(), quat = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0), AXX = new THREE.Vector3(1, 0, 0);
const m4 = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), qd = new THREE.Quaternion(), lat = new THREE.Vector3();

// ───────── wings / neck, applied after the clips ─────────
let rig = null;
const wingState = { phase: 0, w: 0, G: 0, dive: 0, flex: 0.5, amp: 1, inner: { L: 0, R: 0 }, twistK: 1 };
function poseBones(bones) {
  if (!rig) rig = createWingRig(bones);
  wingState.phase = st.phase; wingState.w = st.w; wingState.G = st.G; wingState.dive = st.dive;
  wingState.flex = clamp(T.flex * st.flex, 0, 1.2); wingState.amp = T.amp * lerp(0.85, 1.2, st.e); wingState.twistK = T.twist;
  rig.pose(wingState);
  // neck/head: the sculpt looks along its chest (-z); laid down, the head must look along the body (+y).
  // Birds also keep the head level against the body roll: counter-rotate about the body axis.
  const k = T.neck * D * st.w;
  [['Neck1', 0.30], ['Neck2', 0.36], ['Head', 0.34]].forEach(([n, share]) => {
    const b = bones[n]; if (!b) return;
    qd.setFromAxisAngle(AXX, k * share); b.quaternion.multiply(qd);
  });
  if (bones.Neck1) { qd.setFromAxisAngle(UP, -st.bank * T.stab * st.w); bones.Neck1.quaternion.premultiply(qd); }
}
S.pose = poseBones;

// ───────── per-frame flight ─────────
let last = performance.now();
const camBase = new THREE.Vector3(0.0, 0.40, -2.6);
const camLook0 = new THREE.Vector3(0, 0.45, 1.6);
const fwd0 = camLook0.clone().sub(camBase).normalize();
const yaw0 = Math.atan2(fwd0.x, fwd0.z);

function step(dt) {
  st.t += dt;
  // 1) where on the path (scroll, or an eased ping-pong when auto)
  if (frozenU !== null) st.uTarget = frozenU;
  else if (auto) st.uTarget = 0.5 - 0.5 * Math.cos((st.t / T.autoDur) * TAU);
  else { const max = Math.max(1, document.documentElement.scrollHeight - innerHeight); st.uTarget = clamp(scrollY / max, 0, 1); }
  const uPrev = st.u;
  st.u += (st.uTarget - st.u) * (1 - Math.exp(-dt * (frozenU !== null ? 60 : 5.5)));
  st.dU = (st.u - uPrev) / Math.max(dt, 1e-4);
  st.v = LEN * Math.abs(st.dU);
  if (Math.abs(st.dU) > 2e-4) st.dir = Math.sign(st.dU);
  if (FREEZE) { st.v = forceV; st.dir = forceDir; }
  const snap = FREEZE ? 1 : 0;
  const ease = (rate) => (snap ? 1 : 1 - Math.exp(-dt * rate));

  // 2) position + heading
  const P = curve.getPointAt(st.u), Tn = curve.getTangentAt(st.u);
  pos.copy(P);
  const ft = Tn.clone().multiplyScalar(st.dir);
  const hPrev = st.h.clone();
  st.f.lerp(ft, snap ? 1 : 1 - Math.exp(-dt * 3.2)).normalize();
  const hz = new THREE.Vector3(st.f.x, 0, st.f.z);
  if (hz.lengthSq() > 1e-4) st.h.copy(hz.normalize());
  const dyaw = Math.atan2(hPrev.x * st.h.z - hPrev.z * st.h.x, hPrev.x * st.h.x + hPrev.z * st.h.z);
  st.yawRate += (dyaw / Math.max(dt, 1e-4) - st.yawRate) * (1 - Math.exp(-dt * 6));
  if (FREEZE) {                                              // analytic yaw rate from the path's curvature
    const t2 = curve.getTangentAt(clamp(st.u + 0.004, 0, 1)), t1 = curve.getTangentAt(clamp(st.u - 0.004, 0, 1));
    st.yawRate = Math.atan2(t1.x * t2.z - t1.z * t2.x, t1.x * t2.x + t1.z * t2.z) * forceDir / (0.008 * LEN / Math.max(forceV, 0.1));
  }
  const bankT = clamp(-st.yawRate * T.bank * Math.min(1, st.v / 1.2), -1.0, 1.0);
  st.bank += (bankT - st.bank) * ease(3.2);

  // 3) how she is flying (from the SHAPE of the path and the speed)
  const fy = st.f.y;
  const moving = sstep(st.v, 0.2, 0.7);
  const diveT = sstep(-fy, 0.38, 0.72) * moving;
  const climbT = sstep(fy, 0.28, 0.66) * moving;
  st.dive += (diveT - st.dive) * ease(2.6);
  st.climb += (climbT - st.climb) * ease(2.6);
  const wT = clamp(sstep(st.v, 0.35, 1.25) + 0.9 * st.dive + 0.5 * st.climb, 0, 1) * T.lay;
  st.w += (wT - st.w) * ease(2.4);
  const eT = clamp(0.18 + 0.26 * st.v + 0.55 * st.climb, 0, 1);
  st.e += (eT - st.e) * ease(2);
  const GT = sstep(st.v, 1.0, 1.8) * (1 - sstep(fy, 0.0, 0.25)) * (1 - st.dive) * sstep(-fy, -0.02, 0.2);
  st.G += (GT - st.G) * ease(1.6);
  const fT = clamp(0.35 + 0.55 * st.e + 0.4 * st.climb, 0, 1) * (1 - 0.7 * st.G);        // elbow/wrist flexion on the upstroke
  st.flex += (fT - st.flex) * ease(2);
  // QA overrides: pin a mode to inspect it in isolation (?G= ?dive= ?climb= ?w= ?e=)
  if (Q.has('G')) st.G = +Q.get('G');
  if (Q.has('dive')) st.dive = +Q.get('dive');
  if (Q.has('climb')) st.climb = +Q.get('climb');
  if (Q.has('w')) st.w = +Q.get('w');
  if (Q.has('e')) st.e = +Q.get('e');
  const freq = lerp(T.fMin, T.fMax, st.e) * lerp(1, 0.55, st.G) * (1 + 0.06 * Math.sin(st.t * 0.7) + 0.035 * Math.sin(st.t * 1.9 + 1));
  st.phase += freq * dt;
  if (Q.has('ph')) st.phase = +Q.get('ph');                  // QA: freeze the wing-beat phase

  // 4) attitude: body axis a (the sculpt's +y) goes from "up" (hover) to the direction of travel (cruise, climb, dive);
  //    the back u (+z) from "opposite the heading" (chest toward where she goes) to "world up" (belly down)
  const a = UP.clone().lerp(st.f, st.w * 0.94).normalize();
  const u0 = st.h.clone().multiplyScalar(-1).lerp(UP, st.w).normalize();
  const u = u0.sub(a.clone().multiplyScalar(u0.dot(a))).normalize();
  const x = new THREE.Vector3().crossVectors(a, u);
  m4.makeBasis(x, a, u);
  quat.setFromRotationMatrix(m4);
  // roll about the body axis; wing-beat pitch rocking (the body rises on the downstroke)
  tmpQ.setFromAxisAngle(a, st.bank); quat.premultiply(tmpQ);
  lat.set(1, 0, 0).applyQuaternion(quat);
  tmpQ.setFromAxisAngle(lat, 0.045 * (1 - st.G) * (1 - st.dive) * Math.sin(TAU * (st.phase - 0.18)) * st.w); quat.premultiply(tmpQ);
  const heave = 0.04 * (1 - 0.7 * st.G) * (1 - st.dive) * Math.sin(TAU * (st.phase - 0.12)) * (0.6 + 0.4 * st.e);
  pos.y += heave;

  // the wing on the INSIDE of the turn is the lower one in the world
  const bn = clamp(st.bank / 0.7, -1, 1);
  for (const [side, lx] of [['L', -1], ['R', 1]]) {
    lat.set(lx, 0, 0).applyQuaternion(quat);
    wingState.inner[side] = clamp(-lat.y * 1.6, -1, 1) * Math.abs(bn);
  }

  S.bird = { pos, quat };
  S.hover = 1;
  stage.clips && (stage.clips.Hover.timeScale = lerp(0.7, 1.5, st.e));

  // 5) camera: a fixed lens that follows her with lag; the sky pans and tilts with it
  const wantW = 0.62 + 0.14 * st.dive;
  const want = P.clone().multiplyScalar(wantW).add(camLook0.clone().multiplyScalar(1 - wantW));
  st.camTarget.lerp(want, 1 - Math.exp(-dt * (FREEZE ? 60 : 2.4)));
  // chase camera: keeps her at a readable distance (the dolly has a floor, so the crossing still passes close to the lens)
  const dist = +(Q.get('cdist') ?? 4.2);
  const camWant = new THREE.Vector3(P.x * 0.30, 0.2 + P.y * 0.20, clamp(P.z - dist, -2.6, 3.2));
  st.camPos.lerp(camWant, 1 - Math.exp(-dt * (FREEZE ? 60 : 1.5)));
  const camPos = st.camPos;
  S.cam = { pos: camPos, target: st.camTarget };
  if (QV) {                                                  // QA inspection cameras: ?view=side|front|top|q34|back, ?dist=
    const r = +(Q.get('dist') ?? 2.7);
    const right = new THREE.Vector3().crossVectors(UP, st.h).normalize();
    const off = { side: right.clone().multiplyScalar(r), front: st.h.clone().multiplyScalar(r).add(new THREE.Vector3(0, r * 0.15, 0)),
      back: st.h.clone().multiplyScalar(-r).add(new THREE.Vector3(0, r * 0.15, 0)), top: new THREE.Vector3(0, r, 0.001),
      q34: right.clone().multiplyScalar(r * 0.7).add(st.h.clone().multiplyScalar(r * 0.7)).add(new THREE.Vector3(0, r * 0.25, 0)) }[QV];
    S.cam = { pos: P.clone().add(off), target: P.clone() };
  }
  const fwd = st.camTarget.clone().sub(camPos).normalize();
  S.skyYaw = -0.54 + (Math.atan2(fwd.x, fwd.z) - yaw0);
  S.skyPitch = Math.asin(clamp(fwd.y, -1, 1)) - Math.asin(fwd0.y);
  S.camY = 0.1; S.camX = 0; S.camLook = 0;
}

// ───────── loop ─────────
const pointer = { x: 0, y: 0 };
await stage.load();
addEventListener('resize', () => stage.resize());
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  step(dt);
  stage.frame(dt, S, pointer);
  $('bar').style.width = `${st.u * 100}%`;
  if ((st.t * 10 | 0) % 2 === 0) {
    $('h-u').textContent = `path ${st.u.toFixed(3)}`;
    $('h-v').textContent = `speed ${st.v.toFixed(1)} · pitch ${(Math.asin(clamp(st.f.y, -1, 1)) / D).toFixed(0)}°`;
    $('h-b').textContent = `bank ${(st.bank / D).toFixed(0)}° · flap ${lerp(T.fMin, T.fMax, st.e).toFixed(1)} Hz · flex ${st.flex.toFixed(2)}`;
    $('h-m').textContent = `mode ${st.dive > 0.5 ? 'DIVE' : st.G > 0.5 ? 'glide' : st.climb > 0.5 ? 'CLIMB' : st.w > 0.6 ? 'cruise' : st.w > 0.15 ? 'transition' : 'hover'}`;
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
window.__fly = { S, st, T, stage, curve, wingState, get rig() { return rig; } };

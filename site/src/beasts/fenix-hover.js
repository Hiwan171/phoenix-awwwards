// Hover driver for the phoenix: she stays in the air, in place, beating her wings. It only writes the rig's inputs
// (fenix.params) and the pelvis; the rig (fenix.js) does the deformation. Everything is a function of time, so a frozen clock
// gives a frozen, repeatable frame (QA).
//
// The beat (one cycle = phase 0..1, phase 0 = wings at the top):
//   downstroke  phase 0 -> 0.5: wings opening and fanning, the body rises, the feathers drag UP behind the stroke
//   upstroke    phase 0.5 -> 1: wings flexing (arm folding, fan closing), the body sinks, the feathers drag DOWN
// Around it: the body heaves and rocks with the thrust, the head stays steady against the body (neck counter-rotation, with a
// slow look-around), the plume tips trail the body's acceleration, the legs dangle and sway.
import * as THREE from 'three';

const TAU = Math.PI * 2;
const { clamp, lerp } = THREE.MathUtils;

export const HOVER_DEFAULTS = {
  rate: 1.0,            // beats per second (a big, slow, majestic bird)
  flapAmp: 0.46,        // radians, half range of the up/down stroke
  openBase: 0.80, openAmp: 0.15,      // wing opening: mean and half range (downstroke wide, upstroke flexed)
  sweepBase: 0.10, sweepAmp: 0.12,    // wings sweep back a little on the downstroke
  heave: 0.034,         // body rise/fall (units, height = 1)
  rock: 0.04,           // body pitch rocking (rad)
  drift: 0.022,         // slow wander of the whole bird in the air (units)
  trail: 0.11,          // feather drag per rad/s of flap speed
  balance: 0.19,        // radians: evens out the sculpt's lopsided wings (right wing lower than left) so the beat reads symmetric
  intensity: 1,         // 0 = almost still ("breathing"), 1 = full beat
};

export function createHover(fenix, options = {}) {
  const H = { ...HOVER_DEFAULTS, ...options };
  const P = fenix.params, pelvis = fenix.pelvis;
  const rest = pelvis.position.clone();
  const root = pelvis.parent;                          // the glTF scene: drift is applied here
  const state = { phase: Math.random() * 0.2, t: 0, flapPrev: 0, vel: new THREE.Vector3(), posPrev: new THREE.Vector3(), acc: new THREE.Vector3(), first: true };
  const e = new THREE.Euler(), q = new THREE.Quaternion();

  function update(dt, clock = null) {
    dt = Math.min(dt, 1 / 20);
    state.t = clock ?? state.t + dt;
    const t = state.t, k = H.intensity;
    // the beat rate breathes a little (±4 %) so no two cycles are identical
    const rate = H.rate * (0.25 + 0.75 * k) * (1 + 0.04 * Math.sin(t * 0.37) + 0.03 * Math.sin(t * 0.91 + 1.0));
    if (clock === null) state.phase = (state.phase + rate * dt) % 1;
    else state.phase = ((clock * H.rate * (0.25 + 0.75 * k)) % 1 + 1) % 1;        // frozen / scrubbed clock: pure function of time
    const phi = state.phase;
    const w = phi + 0.05 * Math.sin(TAU * phi);        // a slightly slower upstroke than downstroke
    // wings
    const flap = H.flapAmp * k * (Math.cos(TAU * w) + 0.10 * Math.cos(2 * TAU * w + 0.8)) - 0.05 * k;
    const open = lerp(0.75, H.openBase + H.openAmp * Math.sin(TAU * w), 0.35 + 0.65 * k);
    const sweep = k * (H.sweepBase + H.sweepAmp * Math.sin(TAU * (w - 0.1)));
    const dFlap = clock === null ? (flap - state.flapPrev) / Math.max(dt, 1e-3) : -H.flapAmp * k * TAU * rate * Math.sin(TAU * w);
    state.flapPrev = flap;
    P.open = open; P.flap = flap; P.sweep = sweep; P.wingBalance = H.balance * k;
    P.featherTrail = clamp(H.trail * dFlap, -0.55, 0.55);
    // body: heave with the thrust (peaks at the bottom of the stroke), a little pitch rock, a slow drift of the whole bird
    const heave = -H.heave * k * Math.cos(TAU * (w - 0.06));
    const pitch = H.rock * k * Math.sin(TAU * w - 0.5);
    const roll = 0.03 * Math.sin(t * 0.6) * (0.4 + 0.6 * k);
    pelvis.position.set(rest.x, rest.y + heave, rest.z);
    pelvis.quaternion.setFromEuler(e.set(pitch, 0, roll, 'XYZ'));
    root.position.set(H.drift * Math.sin(t * 0.37), H.drift * 0.8 * Math.sin(t * 0.53 + 1.0), 0);
    // acceleration of the body (for the plume tips): finite difference of the body position, low-passed
    const cur = new THREE.Vector3(root.position.x, root.position.y + heave, 0);
    if (state.first) { state.posPrev.copy(cur); state.first = false; }
    const v = cur.clone().sub(state.posPrev).divideScalar(Math.max(dt, 1e-3));
    const a = v.clone().sub(state.vel).divideScalar(Math.max(dt, 1e-3));
    state.vel.copy(v); state.posPrev.copy(cur);
    state.acc.lerp(a, 1 - Math.exp(-dt * 12));
    P.bodyAccel = [state.acc.x, state.acc.y, state.acc.z];
    // head: steady against the body (counter-rotation) + a slow look-around
    P.lookPitch = -pitch * 0.9 + 0.05 * Math.sin(t * 0.43);
    P.lookRoll = -roll * 0.8;
    P.lookYaw = 0.16 * Math.sin(t * 0.21) + 0.06 * Math.sin(t * 0.67 + 0.5);
    // legs dangle and sway; tail plumes wave a little more as she beats
    P.legTuck = 0.34 + 0.06 * Math.sin(TAU * w - 0.7);
    P.plumeWave = 0.055 + 0.03 * k;
    P.plumeSpeed = 0.55;
  }

  return { params: H, state, update, rest };
}

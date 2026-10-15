// Dev helper for tools/rigs/scan-tears.mjs: drives the phoenix rig + hover driver at an exact clock so a script can skin the
// mesh in every pose of the beat (and some stress poses) and measure how much each triangle stretches.
import { createFenix } from './fenix.js';
import { createHover } from './fenix-hover.js';

export default async function create(THREE, gltf) {
  const fenix = createFenix(gltf.scene);
  const hover = createHover(fenix, { intensity: 1 });
  const P = fenix.params;
  const neutral = { open: 0.75, flap: 0, sweep: 0, wingBalance: 0, featherTrail: 0, lookYaw: 0, lookPitch: 0, lookRoll: 0, legTuck: 0, plumeWave: 0, bodyAccel: [0, 0, 0] };
  return {
    fenix, hover,
    /** viewer hook: { beat: seconds } or raw rig inputs */
    pose(o) { if (o.beat != null) this.beat(o.beat); else this.stress(o); },
    /** the sculpted pose (all inputs neutral) */
    rest() {
      Object.assign(P, neutral);
      fenix.pelvis.position.copy(hover.rest); fenix.pelvis.quaternion.identity(); gltf.scene.position.set(0, 0, 0);
      for (let i = 0; i < 4; i++) fenix.update(1 / 60);
      gltf.scene.updateMatrixWorld(true);
    },
    /** a pose of the hover beat at `clock` seconds, springs settled */
    beat(clock) {
      for (let i = 0; i < 24; i++) { hover.update(1 / 60, clock); fenix.update(1 / 60); }
      gltf.scene.updateMatrixWorld(true);
    },
    /** a stress pose: raw rig inputs on top of the neutral pose */
    stress(p) {
      Object.assign(P, neutral, p);
      fenix.pelvis.position.copy(hover.rest); fenix.pelvis.quaternion.identity(); gltf.scene.position.set(0, 0, 0);
      for (let i = 0; i < 90; i++) fenix.update(1 / 60);
      gltf.scene.updateMatrixWorld(true);
    },
  };
}

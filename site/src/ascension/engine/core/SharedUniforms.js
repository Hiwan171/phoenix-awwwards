// Global uniforms shared (by reference) between every shader of the world, so the sun,
// atmosphere, wind and camera are coherent across sky, terrain, clouds, phoenix and FX.
import * as THREE from 'three';

export const U = {
  uTime: { value: 0 },
  uFrame: { value: 0 },
  uResolution: { value: new THREE.Vector2(1, 1) },
  uCamPos: { value: new THREE.Vector3() },
  uInvProj: { value: new THREE.Matrix4() },
  uCamWorld: { value: new THREE.Matrix4() },
  uViewProj: { value: new THREE.Matrix4() },
  uPrevViewProj: { value: new THREE.Matrix4() },
  uNear: { value: 0.3 },
  uFar: { value: 90000 },
  // sun + atmosphere
  uSunDir: { value: new THREE.Vector3(-0.5, 0.06, -0.86).normalize() },
  uSunRadiance: { value: new THREE.Vector3(1, 0.6, 0.3) }, // transmitted sun colour × intensity (lighting)
  uSkyAmbient: { value: new THREE.Vector3(0.2, 0.25, 0.35) }, // zenith-ish sky irradiance
  uHorizonAmbient: { value: new THREE.Vector3(0.4, 0.3, 0.25) },
  uSkyLUT: { value: null },
  uBetaR: { value: new THREE.Vector3() },
  uBetaM: { value: new THREE.Vector3() },
  uObsAlt: { value: 3200 },
  uValleyFog: { value: new THREE.Vector4(1.5e-4, 380, -560, 0) },
  uAerialScale: { value: 1 },
  // wind
  uWindDir: { value: new THREE.Vector3(0.82, 0, 0.57) },
  uWindSpeed: { value: 6 },
  uWindGust: { value: 0 },
  uWindOffset: { value: new THREE.Vector3() }, // integrated advection (m)
  // phoenix fire light (single dynamic light shared with terrain / clouds)
  uFirePos: { value: new THREE.Vector3(0, 2, 0) },
  uFireColor: { value: new THREE.Vector3(1.0, 0.42, 0.12) },
  uFireIntensity: { value: 0 },
  // feature toggles
  uAtmosphereOn: { value: 1 },
};

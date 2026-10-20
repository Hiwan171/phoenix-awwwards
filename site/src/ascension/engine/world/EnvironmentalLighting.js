// EnvironmentalLighting — derives every light from the shared atmosphere: the sun
// (DirectionalLight, transmitted colour), sky/cloud-sea hemisphere, a PMREM environment
// rendered from the same sky model, and the single dynamic fire light of the phoenix.
import * as THREE from 'three';
import { U } from '../core/SharedUniforms.js';
import { ATMOSPHERE_GLSL } from './AtmosphereShader.js';

export class EnvironmentalLighting {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.sun = new THREE.DirectionalLight(0xffffff, 1); this.sun.name = 'Sun';
    this.sunTarget = new THREE.Object3D(); this.sun.target = this.sunTarget;
    this.hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 1); this.hemi.name = 'SkyAndCloudBounce';
    this.fill = new THREE.DirectionalLight(0xffffff, 0); this.fill.name = 'CloudSeaFill';
    this.fillTarget = new THREE.Object3D(); this.fill.target = this.fillTarget;
    scene.add(this.sun, this.sunTarget, this.hemi, this.fill, this.fillTarget);
    this.envMap = null;
  }

  // sun/sky colours come from the atmosphere model (uSunRadiance etc. already set)
  apply(focus = new THREE.Vector3()) {
    const sr = U.uSunRadiance.value, sk = U.uSkyAmbient.value, hz = U.uHorizonAmbient.value;
    const sunMax = Math.max(sr.x, sr.y, sr.z, 1e-4);
    this.sun.color.setRGB(sr.x / sunMax, sr.y / sunMax, sr.z / sunMax);
    this.sun.intensity = sunMax * Math.PI;
    this.sun.position.copy(focus).addScaledVector(U.uSunDir.value, 100);
    this.sunTarget.position.copy(focus);
    const skMax = Math.max(sk.x, sk.y, sk.z, 1e-4);
    this.hemi.color.setRGB(sk.x / skMax, sk.y / skMax, sk.z / skMax);
    const bounce = new THREE.Color(hz.x * 0.9 + sr.x * 0.1, hz.y * 0.9 + sr.y * 0.1, hz.z * 0.9 + sr.z * 0.1);
    const bMax = Math.max(bounce.r, bounce.g, bounce.b, 1e-4);
    this.hemi.groundColor.setRGB(bounce.r / bMax, bounce.g / bMax, bounce.b / bMax);
    this.hemi.intensity = (skMax + bMax) * 0.5 * Math.PI * 1.1;
    // warm bounce from the sunlit sea of clouds below/in front of the camera side
    this.fill.color.setRGB(1.0, 0.72, 0.52);
    this.fill.intensity = sunMax * 0.55;
    this.fill.position.copy(focus).add(new THREE.Vector3(0.35, -0.55, 1).normalize().multiplyScalar(100));
    this.fillTarget.position.copy(focus);
  }

  buildEnvironment() {
    const scene = new THREE.Scene();
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: { ...U },
      vertexShader: /* glsl */`varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`
        ${ATMOSPHERE_GLSL}
        varying vec3 vDir;
        void main(){
          vec3 rd = normalize(vDir);
          vec3 col = skyRadiance(normalize(vec3(rd.x, max(rd.y, 0.0), rd.z)));
          float mu = dot(rd, uSunDir);
          col += uSunRadiance * (hgPhase(mu, 0.9) * 0.08);
          if (rd.y < 0.0){
            // sunlit sea of clouds below the summit
            vec3 sea = uHorizonAmbient * 1.15 + uSunRadiance * (0.12 + 0.6 * hgPhase(mu, 0.6));
            col = mix(col, sea, smoothstep(0.0, -0.12, rd.y));
          }
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 48, 24), mat));
    const crt = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType });
    const cc = new THREE.CubeCamera(0.1, 100, crt);
    cc.update(this.renderer, scene);
    const pm = new THREE.PMREMGenerator(this.renderer);
    const env = pm.fromCubemap(crt.texture);
    if (this.envRT) this.envRT.dispose();
    this.envRT = env; this.envMap = env.texture;
    crt.dispose(); pm.dispose(); mat.dispose();
    return this.envMap;
  }
}

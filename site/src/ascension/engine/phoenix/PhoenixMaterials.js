// PhoenixMaterials — premium look built on the original PBR textures (base colour, normal,
// metallic-roughness are all kept): regional palette regrade from skin-derived anatomical
// masks, micro roughness variation, sheen + subtle anisotropy, controlled rim light,
// backlit feather translucency and localised incandescence (tips, veins, chest core).
import * as THREE from 'three';
import { NOISE_GLSL } from '../shaders/noise.glsl.js';
import { U } from '../core/SharedUniforms.js';

const lin = hex => new THREE.Color(hex); // THREE.Color(hex) converts sRGB → linear working space
export const PALETTE = {
  crimson: lin(0x7d1720), copper: lin(0xb74724), gold: lin(0xffb54a),
  molten: lin(0xff681f), ember: lin(0xffe39a), charcoal: lin(0x24191e),
};

export function createPhoenixMaterial(original, rig, envMap) {
  const mat = new THREE.MeshPhysicalMaterial({
    name: 'PhoenixPlumage',
    map: original.map, normalMap: original.normalMap, roughnessMap: original.roughnessMap,
    normalScale: new THREE.Vector2(1, 1),
    roughness: 0.78, metalness: 0.0,
    sheen: 0.6, sheenRoughness: 0.42, sheenColor: new THREE.Color(1.0, 0.55, 0.28),
    anisotropy: 0.22, anisotropyRotation: 0,
    specularIntensity: 0.6,
    envMap, envMapIntensity: 0.85,
    side: THREE.DoubleSide,
  });
  const chest = rig.rest.pos[rig.torso[Math.max(0, rig.torso.length - 3)]].clone();
  chest.x -= 0.08; // core sits in the breast, in front of the spine
  const uniforms = {
    uTime: U.uTime, uEnergy: { value: 0.4 }, uPremium: { value: 1 }, uEmission: { value: 1 },
    uCore: { value: chest }, uSunView: { value: new THREE.Vector3() }, uSunRadiance: U.uSunRadiance,
    uCrimson: { value: PALETTE.crimson }, uCopper: { value: PALETTE.copper }, uGold: { value: PALETTE.gold },
    uMolten: { value: PALETTE.molten }, uEmber: { value: PALETTE.ember }, uCharcoal: { value: PALETTE.charcoal },
    uRegionDebug: { value: 0 },
  };
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aRegion; attribute vec2 aFeather; attribute vec3 aRestPos;
        varying vec4 vRegion; varying vec2 vFeather; varying vec3 vRest;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vRegion = aRegion; vFeather = aFeather; vRest = aRestPos;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        ${NOISE_GLSL}
        uniform float uTime; uniform float uEnergy; uniform float uPremium; uniform float uEmission; uniform vec3 uCore;
        uniform vec3 uSunView; uniform vec3 uSunRadiance; uniform float uRegionDebug;
        uniform vec3 uCrimson; uniform vec3 uCopper; uniform vec3 uGold; uniform vec3 uMolten; uniform vec3 uEmber; uniform vec3 uCharcoal;
        varying vec4 vRegion; varying vec2 vFeather; varying vec3 vRest;
        vec3 heatRamp(float h){
          vec3 c = mix(vec3(0.0), uCrimson * 1.6, smoothstep(0.0, 0.22, h));
          c = mix(c, uMolten, smoothstep(0.18, 0.55, h));
          c = mix(c, uGold, smoothstep(0.5, 0.85, h));
          return mix(c, uEmber, smoothstep(0.82, 1.25, h));
        }
        float gHeat; float gLum;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          float lum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
          gLum = clamp(lum * 3.2, 0.0, 1.0);
          float wing = vRegion.x, tail = vRegion.y, head = vRegion.z, leg = vRegion.w;
          float tip = clamp(vFeather.x, 0.0, 1.0);
          float var1 = vnoise3(vRest * 6.0) * 0.5 + 0.5;
          vec3 ramp = mix(uCharcoal, uCrimson, smoothstep(0.0, 0.28, gLum));
          ramp = mix(ramp, uCopper, smoothstep(0.22, 0.62, gLum + (var1 - 0.5) * 0.25));
          ramp = mix(ramp, uGold * 0.82, smoothstep(0.58, 0.98, gLum));
          // regional language: wings warm toward gold at the tips, tail crimson→copper→gold,
          // head/crest copper-gold, legs and talons charcoal with gold scales
          ramp = mix(ramp, mix(ramp, uGold * 0.8, 0.6), wing * smoothstep(0.45, 1.0, tip));
          ramp = mix(ramp, mix(uCrimson, uCopper, smoothstep(0.2, 0.8, tip)) * (0.75 + gLum), tail * 0.55);
          ramp = mix(ramp, mix(ramp, uGold * 0.7, 0.35), head);
          ramp = mix(ramp, mix(uCharcoal * 1.4, uGold * 0.35, smoothstep(0.5, 0.9, gLum)), leg);
          vec3 detail = diffuseColor.rgb / max(lum, 0.02);
          vec3 premium = ramp * mix(vec3(1.0), clamp(detail * 0.45 + 0.55, 0.0, 2.0), 0.35);
          diffuseColor.rgb = mix(diffuseColor.rgb, premium, uPremium);
          if (uRegionDebug > 0.5){
            float body = clamp(1.0 - wing - tail - head - leg, 0.0, 1.0);
            diffuseColor.rgb = body*vec3(0.2,0.8,0.3) + wing*vec3(1.0,0.2,0.2) + tail*vec3(1.0,0.8,0.2) + head*vec3(0.9,0.3,1.0) + leg*vec3(0.2,0.8,1.0);
            diffuseColor.rgb *= 0.3 + 0.7*tip;
          }
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, clamp(roughnessFactor * (0.78 + 0.42 * (vnoise3(vRest * 38.0) * 0.5 + 0.5)) - gLum * 0.12, 0.25, 1.0), uPremium);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, smoothstep(0.62, 0.95, gLum) * 0.35 * (1.0 - vRegion.w * 0.5), uPremium);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          float wing = vRegion.x, tail = vRegion.y, head = vRegion.z, leg = vRegion.w;
          float tip = clamp(vFeather.x, 0.0, 1.0);
          float n1 = vnoise3(vRest * 7.5 + vec3(0.0, -uTime * 1.3, uTime * 0.2)) * 0.5 + 0.5;
          float n2 = vnoise3(vRest * 21.0 + vec3(uTime * 0.6, -uTime * 2.1, 0.0)) * 0.5 + 0.5;
          float veins = smoothstep(0.58, 0.96, n1 * 0.68 + n2 * 0.45);
          float tipHeat = pow(tip, 2.1) * (0.35 + 0.65 * vFeather.y);
          vec3 dc = vRest - uCore; float core = exp(-dot(dc, dc) * 34.0);
          float edge = smoothstep(0.62, 0.95, gLum);
          float flick = 0.86 + 0.14 * sin(uTime * 13.0 + vRest.x * 40.0) * sin(uTime * 7.3 + vRest.y * 25.0);
          float h = tipHeat * (1.1 * wing + 0.9 * tail + 0.75 * head) + veins * (0.28 + 0.4 * wing + 0.2 * tail) + core * 1.1 + edge * 0.38;
          h *= (1.0 - leg * 0.92) * uEnergy * flick;
          gHeat = h;
          vec3 E = heatRamp(h) * (h * h * 8.0 + h * 2.2);
          totalEmissiveRadiance += E * uPremium * uEmission;
        }`)
      .replace('#include <opaque_fragment>', `
        {
          vec3 Vv = normalize(vViewPosition);
          vec3 Nn = normalize(normal);
          float fres = pow(1.0 - abs(dot(Nn, Vv)), 3.0);
          float back = pow(max(dot(-Vv, uSunView), 0.0), 2.5);
          vec3 rim = uSunRadiance * fres * (0.18 + 1.25 * back);
          float thin = vFeather.y * (0.35 + 0.65 * clamp(vFeather.x, 0.0, 1.0));
          vec3 trans = uSunRadiance * diffuseColor.rgb * thin * (0.15 + back * 1.6) * (0.5 + 0.5 * max(0.0, -dot(Nn, uSunView)));
          outgoingLight += (rim * 0.3 + trans * 0.9) * uPremium;
        }
        #include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => 'phoenix-premium-v1';
  return mat;
}

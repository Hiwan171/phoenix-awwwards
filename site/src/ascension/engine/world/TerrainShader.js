// TerrainShader — shared procedural height field + materials for the summit and the range.
//   coarse:  warped eroded fbm + ridged multifractal range ⊕ analytic summit (smooth max)
//   detail:  additive ridged rock octaves with analytic derivatives, split by LOD between
//            geometry (baked per vertex) and fragment (normal-only, pixel-footprint filtered)
//   bake:    height, gradient, soft sun shadow (height-field ray march) and horizon AO,
//            evaluated once on the GPU per vertex of the radial meshes
import * as THREE from 'three';
import { U } from '../core/SharedUniforms.js';
import { NOISE_GLSL } from '../shaders/noise.glsl.js';
import { ATMOSPHERE_GLSL } from './AtmosphereShader.js';
import { SUMMIT_GLSL, SUMMIT } from './MountainSummit.js';

export const TERRAIN_PARAMS = {
  waterLevel: -1035,
  detail: new THREE.Vector4(256, 0.28, 15, 0),
  range: new THREE.Vector4(-1180, 760, 1080, 6500),
  snow: new THREE.Vector4(-700, 0.62, 0, 0),
};

export const TERRAIN_GLSL = /* glsl */`
${NOISE_GLSL}
uniform vec4 uGrid;      // mode, a, b, segments
uniform vec4 uDetail;    // lambda0, roughness, octaves, -
uniform vec4 uRange;     // base, massif amp, ridge amp, macro scale
uniform float uWaterLevel;
${SUMMIT_GLSL}
float smax(float a, float b, float k){ float h = max(k - abs(a - b), 0.0) / k; return max(a, b) + h*h*k*0.25; }
vec2 gridToWorld(vec2 ji){
  float r = uGrid.x < 0.5 ? uGrid.y*(exp(uGrid.z*ji.y) - 1.0) : uGrid.y*exp(uGrid.z*ji.y);
  float t = ji.x / uGrid.w * 6.283185307;
  return vec2(cos(t), sin(t)) * r;
}
float gridSpacing(float r){ float radial = uGrid.z * (uGrid.x < 0.5 ? r + uGrid.y : r); return max(radial, 6.283185307*r/uGrid.w); }
float rangeHeight(vec2 p){
  vec2 q = p / uRange.w + vec2(13.7, -7.3);
  vec2 w = vec2(fbm2(q*0.9 + vec2(2.3, 7.1), 4), fbm2(q*0.9 + vec2(5.9, 1.3), 4));
  q += 0.5 * w;
  float e = erodedFbm(q*1.3, 8);
  float rr = ridgedMF(q*2.1 + w, 7);
  float massif = smoothstep(-0.6, 0.7, e);
  float h = uRange.x + uRange.y*massif + uRange.z*rr*(0.35 + 0.65*massif);
  float d = length(p);
  h -= 520.0 * (1.0 - smoothstep(500.0, 4500.0, d));
  // keep the hero peak alone above the cloud sea: a smooth ceiling that relaxes with distance
  float ceil_ = -175.0 + 0.11 * max(d - 1300.0, 0.0);
  float hk = max(90.0 - abs(h - ceil_), 0.0) / 90.0;
  h = min(h, ceil_) - hk*hk*90.0*0.25;
  h += 520.0 * smoothstep(9000.0, 26000.0, d) * rr;
  return h;
}
float terrainCoarse(vec2 p, out float ridge){ return smax(summitHeight(p, ridge), rangeHeight(p), 95.0); }
// additive ridged rock detail with analytic gradient; mode 0 = geometry LOD, 1 = fragment LOD
vec3 rockDetail(vec2 p, float r, float spacing, float footprint, float mode){
  vec3 acc = vec3(0.0);
  float lambda = uDetail.x;
  mat2 R = mat2(1.0);
  float perch = mix(0.22, 1.0, smoothstep(0.6, 3.5, r));
  for (int k = 0; k < 16; k++){
    if (float(k) >= uDetail.z) break;
    float wGeo = smoothstep(2.0, 4.0, lambda / max(spacing, 1e-4));
    float w = mode < 0.5 ? wGeo : (1.0 - wGeo) * smoothstep(1.0, 2.6, lambda / max(footprint, 1e-5));
    w *= smoothstep(0.0, 1.0, r / (lambda * 0.38 + 1e-3)) * perch;
    if (w > 0.002){
      vec2 q = R * p / lambda + vec2(float(k)*7.13, float(k)*3.71);
      vec3 n = noised(q);
      float v = 1.0 - abs(n.x);
      float amp = uDetail.y * lambda * w;
      acc.x += amp * (v*v - 0.35);
      acc.yz += amp * (-2.0 * v * sign(n.x)) * (transpose(R) * n.yz) / lambda;
    }
    lambda *= 0.5;
    R = M2 * R;
  }
  return acc;
}
float terrainFull(vec2 p, float spacing){ float rg; float h = terrainCoarse(p, rg); return h + rockDetail(p, length(p), spacing, 0.0, 0.0).x; }
`;

const HM_GLSL = /* glsl */`
uniform sampler2D tHMNear; uniform vec4 uHMNearRect; uniform vec2 uHMNearRes;
uniform sampler2D tHMFar; uniform vec4 uHMFarRect; uniform vec2 uHMFarRes;
float hmFetch(sampler2D t, vec2 uv, vec2 res){
  vec2 q = uv * res - 0.5; vec2 i = floor(q); vec2 f = q - i;
  ivec2 c = ivec2(clamp(i, vec2(0.0), res - 2.0));
  float a = texelFetch(t, c, 0).r, b = texelFetch(t, c + ivec2(1, 0), 0).r, cc = texelFetch(t, c + ivec2(0, 1), 0).r, d = texelFetch(t, c + ivec2(1, 1), 0).r;
  return mix(mix(a, b, f.x), mix(cc, d, f.x), f.y);
}
float hmHeight(vec2 xz){
  vec2 un = (xz - uHMNearRect.xy) / uHMNearRect.zw;
  if (un.x > 0.003 && un.y > 0.003 && un.x < 0.997 && un.y < 0.997) return hmFetch(tHMNear, un, uHMNearRes);
  return hmFetch(tHMFar, clamp((xz - uHMFarRect.xy) / uHMFarRect.zw, 0.0, 1.0), uHMFarRes);
}
`;

const baseUniforms = gridParams => ({
  uGrid: { value: gridParams }, uDetail: { value: TERRAIN_PARAMS.detail }, uRange: { value: TERRAIN_PARAMS.range },
  uWaterLevel: { value: TERRAIN_PARAMS.waterLevel }, uSummitA: { value: new THREE.Vector4(SUMMIT.steepFaces, SUMMIT.steepRidges, SUMMIT.exponent, SUMMIT.twist) },
  uSunDir: U.uSunDir,
});
const FSV = /* glsl */`void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// height tile: one procedural evaluation per texel (coarse + detail resolvable at the texel size)
export function heightTileMaterial(rect, res) {
  return new THREE.ShaderMaterial({
    name: 'TerrainHeightTile', depthTest: false, depthWrite: false,
    uniforms: { ...baseUniforms(new THREE.Vector4(1, 1, 0.01, 512)), uRect: { value: rect }, uRes: { value: new THREE.Vector2(res, res) } },
    vertexShader: FSV,
    fragmentShader: /* glsl */`
      precision highp float;
      ${TERRAIN_GLSL}
      uniform vec4 uRect; uniform vec2 uRes;
      void main(){
        vec2 p = uRect.xy + (gl_FragCoord.xy - 0.5) / (uRes - 1.0) * uRect.zw;
        float texel = uRect.z / uRes.x;
        float rg; float h = terrainCoarse(p, rg) + rockDetail(p, length(p), texel, 0.0, 0.0).x;
        gl_FragColor = vec4(max(h, uWaterLevel), 0.0, 0.0, 1.0);
      }`,
  });
}

// cloud map: terrain height + sun shadow height (marched through the far tile)
export function heightMapMaterial(rect, res, far) {
  return new THREE.ShaderMaterial({
    name: 'TerrainCloudMap', depthTest: false, depthWrite: false,
    uniforms: { uSunDir: U.uSunDir, uRect: { value: rect }, uRes: { value: new THREE.Vector2(res, res) }, tHMFar: { value: far.texture }, uHMFarRect: { value: far.rect }, uHMFarRes: { value: far.res },
      tHMNear: { value: far.texture }, uHMNearRect: { value: new THREE.Vector4(1e9, 1e9, 1, 1) }, uHMNearRes: { value: far.res } },
    vertexShader: FSV,
    fragmentShader: /* glsl */`
      precision highp float;
      ${HM_GLSL}
      uniform vec3 uSunDir; uniform vec4 uRect; uniform vec2 uRes;
      void main(){
        vec2 p = uRect.xy + gl_FragCoord.xy / uRes * uRect.zw;
        float h = hmHeight(p);
        vec2 sd = normalize(uSunDir.xz); float tanE = uSunDir.y / length(uSunDir.xz);
        float hs = h; float t = 25.0;
        for (int i = 0; i < 48; i++){ float hh = hmHeight(p + sd*t) - t*tanE; hs = max(hs, hh); t *= 1.15; if (t > 12000.0) break; }
        gl_FragColor = vec4(h, hs, 0.0, 1.0);
      }`,
  });
}

// per-vertex bake. pass 0: height + gradient (procedural). pass 1: soft sun shadow and
// horizon AO marched through the height tiles (texture fetches only: fast to compile/run)
export function bakeMaterial(gridParams, tiles) {
  return new THREE.ShaderMaterial({
    name: 'TerrainBake',
    depthTest: false, depthWrite: false,
    uniforms: {
      ...baseUniforms(gridParams), uPass: { value: 0 }, uBakeA: { value: null }, uShadowSteps: { value: 40 },
      tHMNear: { value: tiles.near.texture }, uHMNearRect: { value: tiles.near.rect }, uHMNearRes: { value: tiles.near.res },
      tHMFar: { value: tiles.far.texture }, uHMFarRect: { value: tiles.far.rect }, uHMFarRes: { value: tiles.far.res },
    },
    vertexShader: FSV,
    fragmentShader: /* glsl */`
      precision highp float;
      ${TERRAIN_GLSL}
      ${HM_GLSL}
      uniform vec3 uSunDir; uniform float uPass; uniform sampler2D uBakeA; uniform float uShadowSteps;
      void main(){
        vec2 ji = floor(gl_FragCoord.xy);
        vec2 p = gridToWorld(ji);
        float r = length(p);
        float sp = gridSpacing(r);
        if (uPass < 0.5){
          float e = max(sp * 0.5, 0.004);
          float h = terrainFull(p, sp);
          float hx = terrainFull(p + vec2(e, 0.0), sp), hz = terrainFull(p + vec2(0.0, e), sp);
          vec2 g = vec2(hx - h, hz - h) / e;
          float hg = h;
          if (h < uWaterLevel){ hg = uWaterLevel; g = vec2(0.0); }
          gl_FragColor = vec4(hg, g, 0.0);
        } else {
          vec4 A = texelFetch(uBakeA, ivec2(ji), 0);
          float h0 = A.x;
          // soft shadow toward the shared sun
          float sh = 1.0;
          vec3 ro = vec3(p.x, max(h0, hmHeight(p)) + 0.6 + sp*0.2, p.y);
          float t = max(sp * 2.0, 3.0);
          for (int i = 0; i < 64; i++){
            if (float(i) >= uShadowSteps) break;
            vec3 q = ro + uSunDir * t;
            if (q.y > 900.0) break;
            sh = min(sh, 12.0 * (q.y - hmHeight(q.xz)) / t);
            if (sh < -0.3) break;
            t = t * 1.17 + 0.6;
          }
          // horizon-based ambient occlusion
          float occ = 0.0;
          for (int k = 0; k < 7; k++){
            float an = float(k) * 0.8975979 + 0.37;
            vec2 dir = vec2(cos(an), sin(an));
            float maxS = 0.0; float d = max(sp * 2.0, 2.5);
            for (int m = 0; m < 7; m++){ maxS = max(maxS, (hmHeight(p + dir*d) - h0) / d); d *= 2.15; if (d > 700.0) break; }
            occ += maxS / sqrt(1.0 + maxS*maxS);
          }
          float ao = clamp(1.0 - occ / 7.0, 0.0, 1.0);
          float rg; summitHeight(p, rg);
          gl_FragColor = vec4(smoothstep(-0.1, 1.0, sh), ao, h0 <= uWaterLevel + 0.01 ? 1.0 : 0.0, rg);
        }
      }`,
  });
}

export function terrainMaterial(gridParams, bakeA, bakeB) {
  return new THREE.ShaderMaterial({
    name: 'TerrainShader',
    uniforms: {
      ...U,
      uGrid: { value: gridParams }, uDetail: { value: TERRAIN_PARAMS.detail }, uRange: { value: TERRAIN_PARAMS.range },
      uWaterLevel: { value: TERRAIN_PARAMS.waterLevel }, uSummitA: { value: new THREE.Vector4(SUMMIT.steepFaces, SUMMIT.steepRidges, SUMMIT.exponent, SUMMIT.twist) },
      uBakeA: { value: bakeA }, uBakeB: { value: bakeB }, uSnow: { value: TERRAIN_PARAMS.snow },
      uDetailOn: { value: 1 }, uShadowOn: { value: 1 }, uAOOn: { value: 1 },
    },
    vertexShader: /* glsl */`
      uniform sampler2D uBakeA; uniform sampler2D uBakeB;
      attribute vec2 aGrid;
      varying vec3 vWorld; varying vec2 vGrad; varying float vShadow; varying float vAO; varying float vWater; varying float vRidge;
      void main(){
        ivec2 c = ivec2(aGrid + 0.5);
        vec4 A = texelFetch(uBakeA, c, 0);
        vec4 B = texelFetch(uBakeB, c, 0);
        vec3 pos = vec3(position.x, A.x, position.z);
        vWorld = pos; vGrad = A.yz; vShadow = B.x; vAO = B.y; vWater = B.z; vRidge = B.w;
        gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
      }`,
    fragmentShader: /* glsl */`
      ${TERRAIN_GLSL}
      ${ATMOSPHERE_GLSL}
      uniform vec3 uCamPos; uniform float uTime; uniform vec4 uSnow;
      uniform float uDetailOn; uniform float uShadowOn; uniform float uAOOn;
      uniform vec3 uFirePos; uniform vec3 uFireColor; uniform float uFireIntensity;
      varying vec3 vWorld; varying vec2 vGrad; varying float vShadow; varying float vAO; varying float vWater; varying float vRidge;
      void main(){
        vec3 P = vWorld;
        vec3 V = P - uCamPos; float dist = length(V); vec3 rd = V / dist;
        vec3 L = uSunDir;
        vec3 col;
        if (vWater > 0.5){
          vec2 wq = P.xz * 0.045;
          vec3 n1 = noised(wq + vec2(uTime*0.05, uTime*0.03));
          vec3 n2 = noised(wq*2.7 - vec2(uTime*0.07, -uTime*0.04));
          vec3 N = normalize(vec3(-(n1.y + 0.5*n2.y)*0.06, 1.0, -(n1.z + 0.5*n2.z)*0.06));
          vec3 R = reflect(rd, N); R.y = abs(R.y);
          float fres = 0.02 + 0.98 * pow(1.0 - max(dot(-rd, N), 0.0), 5.0);
          vec3 refl = skyRadiance(R) + uSunRadiance * pow(max(dot(R, L), 0.0), 700.0) * 160.0 * vShadow;
          col = mix(vec3(0.006, 0.012, 0.016), refl, fres);
        } else {
          float r = length(P.xz);
          float sp = gridSpacing(r);
          float fp = max(length(dFdx(P)), length(dFdy(P)));
          vec3 det = uDetailOn > 0.5 ? rockDetail(P.xz, r, sp, fp, 1.0) : vec3(0.0);
          vec2 g = vGrad + det.yz;
          vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
          float hF = P.y + det.x;
          // rock: dark granite, petrol-blue shadows, warm minerals, strata bands
          float m1 = vnoise(P.xz*0.0019 + 3.0)*0.5 + 0.5;
          float strata = sin(hF*0.13 + vnoise(P.xz*0.0045)*7.0 + vnoise(P.xz*0.035)*2.4 + vnoise(P.xz*0.2));
          vec3 rock = mix(vec3(0.030, 0.033, 0.040), vec3(0.020, 0.031, 0.040), m1);
          rock = mix(rock, vec3(0.082, 0.056, 0.040), smoothstep(0.45, 0.95, strata*0.5 + 0.5) * 0.3);
          float micro = vnoise(P.xz*1.3) * (1.0 - smoothstep(0.2, 1.2, fp*3.0));
          rock *= 0.82 + 0.3*(vnoise(P.xz*0.11)*0.5 + 0.5) + 0.12*micro;
          // snow: altitude + slope + ledges, broken up by noise
          float sn = vnoise(P.xz*0.045)*0.6 + vnoise(P.xz*0.31)*0.3 + micro*0.1;
          float alt = smoothstep(uSnow.x - 140.0, uSnow.x + 90.0, hF + sn*110.0);
          float flat_ = smoothstep(uSnow.y, uSnow.y + 0.16, N.y + sn*0.22 + (vAO - 0.65)*0.3);
          float snow = alt * flat_;
          vec3 albedo = mix(rock, vec3(0.78, 0.82, 0.88), snow);
          // lighting (shared sun, sky, cloud-sea bounce, phoenix fire)
          float ndl = dot(N, L);
          float wrap = snow * 0.3;
          float diff = max((ndl + wrap) / (1.0 + wrap), 0.0);
          float shadow = mix(1.0, vShadow, uShadowOn);
          float ao = mix(1.0, vAO, uAOOn) * clamp(0.78 + det.x * 0.35, 0.45, 1.0);
          vec3 sun = uSunRadiance * diff * shadow;
          vec3 amb = uSkyAmbient * (0.62 + 0.38*N.y) * ao;
          vec3 bounce = (uHorizonAmbient * 0.55 + uSunRadiance * 0.04) * clamp(0.55 - 0.45*N.y, 0.0, 1.0) * ao;
          col = albedo * (sun + amb * 1.15 + bounce * 0.8);
          vec3 H = normalize(L - rd);
          col += uSunRadiance * pow(max(dot(N, H), 0.0), 80.0) * (0.04 + 0.5*snow) * shadow;
          vec3 fl = uFirePos - P; float fd = length(fl);
          col += albedo * uFireColor * uFireIntensity * max(dot(N, fl / max(fd, 1e-3)) * 0.8 + 0.2, 0.0) / (1.0 + fd*fd*0.05);
        }
        col = aerial(col, uCamPos, rd, dist);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

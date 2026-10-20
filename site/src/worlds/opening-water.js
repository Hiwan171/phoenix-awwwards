import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';

// A clipped planar reflection of the actual world, in linear HDR. The bed texture is
// sampled from the same CPU heightfield as the terrain and the phoenix's contacts.
export function createValleyWater({ scene, heightAt, sunDirection, lite, reducedMotion, rockDetail, level = 0.8 }) {
  const size = 180, resolution = 384, heights = new Float32Array(resolution * resolution);
  for (let z = 0; z < resolution; z++) for (let x = 0; x < resolution; x++) {
    heights[z * resolution + x] = heightAt((x / (resolution - 1) - 0.5) * size - 6, (z / (resolution - 1) - 0.5) * size - 20);
  }
  const bed = new THREE.DataTexture(heights, resolution, resolution, THREE.RedFormat, THREE.FloatType);
  // Nearest requires no optional floating-point linear-filter extension. Four taps below interpolate explicitly.
  bed.minFilter = bed.magFilter = THREE.NearestFilter; bed.needsUpdate = true;
  const shader = {
    name: 'Valley lake / reflected world and wind ripples',
    uniforms: {
      ...THREE.UniformsLib.fog,
      color: { value: new THREE.Color(0xffffff) }, tDiffuse: { value: null }, textureMatrix: { value: new THREE.Matrix4() },
      uTime: { value: 0 }, uBed: { value: bed }, uSun: { value: sunDirection }, uLevel: { value: level },
    },
    vertexShader: /* glsl */`
      uniform mat4 textureMatrix;
      varying vec4 vReflection;
      varying vec3 vWorld;
      #include <fog_pars_vertex>
      void main() {
        vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        vReflection = textureMatrix * vec4(position, 1.0);
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D tDiffuse, uBed;
      uniform float uTime, uLevel;
      uniform vec3 uSun;
      varying vec4 vReflection;
      varying vec3 vWorld;
      #include <fog_pars_fragment>
      float bedAt(vec2 uv) {
        vec2 p = clamp(uv, 0.0, 1.0)*383.0, i = floor(p), f = fract(p);
        vec2 a = (i + 0.5)/384.0, b = (i + 1.5)/384.0;
        return mix(mix(texture2D(uBed, a).r, texture2D(uBed, vec2(b.x,a.y)).r,f.x),
                   mix(texture2D(uBed, vec2(a.x,b.y)).r, texture2D(uBed,b).r,f.x),f.y);
      }
      void main() {
        vec2 bedUV = (vWorld.xz + vec2(6.0,20.0))/180.0 + 0.5;
        float depth = uLevel - bedAt(bedUV);
        if (depth < 0.006) discard;
        vec2 p = vWorld.xz;
        float a = dot(p,vec2(0.92,-0.39))*3.5-uTime*0.95;
        float b = dot(p,vec2(0.45,0.89))*6.6+uTime*0.7;
        float c = dot(p,vec2(-0.6,0.8))*15.0-uTime*1.3;
        vec2 slope = cos(a)*vec2(0.92,-0.39)*0.065 + cos(b)*vec2(0.45,0.89)*0.032 + cos(c)*vec2(-0.6,0.8)*0.014;
        slope *= smoothstep(0.0,0.5,depth);
        vec3 N = normalize(vec3(-slope.x,1.0,-slope.y));
        vec3 V = normalize(cameraPosition-vWorld);
        float fresnel = 0.035+0.965*pow(1.0-max(dot(N,V),0.0),5.0);
        vec2 reflectionUV = vReflection.xy/vReflection.w + slope*0.12;
        vec3 reflection = texture2D(tDiffuse, clamp(reflectionUV,0.001,0.999),1.0).rgb;
        vec3 submerged = mix(vec3(0.055,0.048,0.036),vec3(0.009,0.019,0.024),1.0-exp(-depth*0.75));
        // Even at the overhead reveal, the sunset remains legible on a dark surface.
        vec3 waterColor = mix(submerged,reflection,0.22+0.78*fresnel);
        vec3 H = normalize(V+uSun);
        float sunGlint = pow(max(dot(N,H),0.0),720.0);
        waterColor += vec3(1.0,0.55,0.23)*sunGlint*4.5;
        float shore = exp(-depth*24.0) * (0.65+0.35*sin(a*0.5+b));
        waterColor = mix(waterColor,vec3(0.19,0.14,0.10),shore*0.25);
        gl_FragColor = vec4(waterColor,1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  };
  // Keep only cells close to actual water. The full square would trigger a
  // reflection even when every wet part of the valley is behind the camera.
  const grid = new THREE.PlaneGeometry(size,size,90,90), positions = grid.attributes.position;
  const index = grid.index.array, wetPositions = [];
  for (let i=0;i<index.length;i+=3) {
    const tri=[index[i],index[i+1],index[i+2]];
    if(tri.some(j=>heightAt(positions.getX(j)-6,-positions.getY(j)-20)<level+1.0)) {
      for(const j of tri) wetPositions.push(positions.getX(j),positions.getY(j),0);
    }
  }
  const lakeGeometry = new THREE.BufferGeometry();
  lakeGeometry.setAttribute('position',new THREE.Float32BufferAttribute(wetPositions,3));
  lakeGeometry.computeBoundingSphere(); grid.dispose();
  const water = new Reflector(lakeGeometry, {
    textureWidth: lite ? 256 : 512, textureHeight: lite ? 256 : 512, multisample: 0,
    clipBias: 0.002, shader,
  });
  water.name = 'Valley lake'; water.rotation.x = -Math.PI/2; water.position.set(-6,level,-20);
  water.material.fog = true;
  water.getRenderTarget().texture.generateMipmaps = true;
  water.getRenderTarget().texture.minFilter = THREE.LinearMipmapLinearFilter;
  // UniformsUtils clones texture uniforms. Keep just the actual bed owned here.
  const clonedBed = water.material.uniforms.uBed.value;
  if (clonedBed !== bed) clonedBed.dispose();
  water.material.uniforms.uBed.value = bed;
  scene.add(water);
  let reflectionRenders = 0;
  const reflect = water.onBeforeRender;
  water.onBeforeRender = function(renderer, world, camera) {
    if (world.overrideMaterial) return;
    if(rockDetail) rockDetail.value=0;
    try { reflect.call(this, renderer, world, camera); reflectionRenders++; }
    finally { if(rockDetail) rockDetail.value=1; }
  };
  return {
    mesh: water, level,
    update(time) { water.material.uniforms.uTime.value = reducedMotion ? 0 : time; },
    diagnostics() { return { level, reflectionSize: water.getRenderTarget().width, reflectionRenders, time: water.material.uniforms.uTime.value }; },
    dispose() { scene.remove(water); water.geometry.dispose(); water.dispose(); bed.dispose(); },
  };
}

import * as THREE from 'three';

// Rock Face: Dario Barresi / Greg Zaal, Poly Haven, CC0. See public/textures/opening-rock/CREDITS.md.
// Photographic albedo, tangent normals, and packed roughness / relief / AO.
export async function createGeologyMaterial({lite = false} = {}) {
  const loader = new THREE.TextureLoader(), suffix = lite ? '1k' : '2k';
  const [albedo, normalMap, surface] = await Promise.all([
    loader.loadAsync(`/textures/opening-rock/color-${suffix}.webp`),
    loader.loadAsync(`/textures/opening-rock/normal-${suffix}.webp`),
    loader.loadAsync('/textures/opening-rock/surface.png'),
  ]);
  albedo.colorSpace = THREE.SRGBColorSpace;
  for (const texture of [albedo, normalMap, surface]) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.anisotropy = 2;
  }
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.94, metalness: 0, envMapIntensity: 0.1 });
  material.name = 'Weathered rock / triplanar PBR in world metres';
  const detail = { value: 1 };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uRockColor: {value:albedo}, uRockNormal: {value:normalMap}, uRockSurface: {value:surface}, uRockDetail: detail });
    shader.vertexShader = 'varying vec3 vRockWorld, vRockNormal;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <defaultnormal_vertex>', `#include <defaultnormal_vertex>
      #ifdef USE_INSTANCING
      vRockNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
      #else
      vRockNormal = normalize(mat3(modelMatrix) * objectNormal);
      #endif`);
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
      vRockWorld = (modelMatrix * instanceMatrix * vec4(position,1.0)).xyz;
      #else
      vRockWorld = (modelMatrix * vec4(position,1.0)).xyz;
      #endif`);
    shader.fragmentShader = `uniform sampler2D uRockColor, uRockNormal, uRockSurface;
      uniform float uRockDetail;
      varying vec3 vRockWorld, vRockNormal;
      vec3 triplanar(sampler2D map, vec3 p, vec3 w) {
        return texture2D(map,p.yz).rgb*w.x + texture2D(map,p.xz).rgb*w.y + texture2D(map,p.xy).rgb*w.z;
      }
      ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      vec3 rockWeights = pow(abs(normalize(vRockNormal)), vec3(4.0));
      rockWeights /= max(dot(rockWeights,vec3(1.0)),0.001);
      vec3 rockP = vRockWorld / 2.4;
      float rockFade = (1.0-smoothstep(18.0,30.0,length(vViewPosition)))*uRockDetail;
      bool rockClose = rockFade > 0.001;
      vec3 rockSurface = vec3(0.93,0.5,1.0);
      vec3 rockColor = triplanar(uRockColor,rockP,rockWeights);
      // A second geological scale breaks the visible tile repetition on distant faces.
      float broadLuma = 0.25;
      if (rockClose) {
        rockSurface = mix(rockSurface,triplanar(uRockSurface,rockP,rockWeights),rockFade);
        vec3 broadColor = triplanar(uRockColor,vRockWorld/19.7,rockWeights);
        broadLuma = mix(broadLuma,dot(broadColor,vec3(0.2126,0.7152,0.0722)),rockFade);
      }
      rockColor *= 0.67 + broadLuma*0.8;
      float rockWet = 1.0-smoothstep(0.82,1.5,vRockWorld.y);
      diffuseColor.rgb *= rockColor * (0.7+rockSurface.b*0.3) * mix(1.0,0.52,rockWet);
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = mix(clamp(rockSurface.r,0.68,1.0),0.4,rockWet);`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
      if (rockClose) {
      vec3 nx = texture2D(uRockNormal,rockP.yz).xyz*2.0-1.0;
      vec3 ny = texture2D(uRockNormal,rockP.xz).xyz*2.0-1.0;
      vec3 nz = texture2D(uRockNormal,rockP.xy).xyz*2.0-1.0;
      vec3 perturb = vec3(0.0,nx.x,nx.y)*rockWeights.x + vec3(ny.x,0.0,ny.y)*rockWeights.y + vec3(nz.x,nz.y,0.0)*rockWeights.z;
      vec3 worldRockNormal = normalize(normalize(vRockNormal)+perturb*0.75*rockFade);
      normal = normalize(mat3(viewMatrix)*worldRockNormal);
      }
    `);
  };
  material.customProgramCacheKey = () => 'opening-photographic-rock-v3';
  return { material, detail, dispose() { for(const texture of [albedo,normalMap,surface]) texture.dispose(); material.dispose(); } };
}

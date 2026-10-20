import * as THREE from 'three';
import { createGeologyMaterial } from './opening-rock.js';
import { createValleyWater } from './opening-water.js';

export async function createOpeningLandscape({ scene, sunDirection, lite = false, reducedMotion = false, water = true }) {
  const LAYER_OCCLUDER = 2;
  const PEAK = { x: 0, z: 0, top: 13.0 }, LEDGE = { x: -12, z: -40, top: 7.0 };
  const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
  const vnoise = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; };
  const ridged = (x, y) => { let s = 0, amp = 0.5, f = 1; for (let i = 0; i < 5; i++) { const n = 1 - Math.abs(vnoise(x * f, y * f) * 2 - 1); s += n * n * amp; amp *= 0.5; f *= 2.07; } return s; };
  const smin = (a, b, k) => { const h = Math.max(0, Math.min(1, 0.5 + 0.5 * (b - a) / k)); return b + (a - b) * h - k * h * (1 - h); };   // smooth min (rounded summit)
  function spire(x, z, m, r, top, seed) {
    const d = Math.hypot(x - m.x, z - m.z), p = Math.exp(-Math.pow(d / r, 1.05));
    const ang = Math.atan2(z - m.z, x - m.x);
    // flanks: ridges and gullies running down the mountain (angular noise), crags, fine rock grain; strongest mid-slope
    const gully = ridged(Math.cos(ang) * 2.2 + seed, Math.sin(ang) * 2.2 + d * 0.35);
    const crag = ridged(x * 0.33 + seed, z * 0.33 - seed);
    const mid = 4 * p * (1 - p);
    const body = top * 1.08 * p + 2.4 * mid * (gully - 0.35) + 1.4 * crag * p + 0.35 * vnoise(x * 1.7 + seed, z * 1.7) * p;
    return smin(body, top + 0.35 * vnoise(x * 2.5 + seed, z * 2.5) + 0.2 * vnoise(x * 6, z * 6 + seed), 0.5);
  }
  function pilotHeightAt(x, z) {
    let h = 1.6 * ridged(x * 0.035 + 3.1, z * 0.035 - 1.7) + 0.5 * vnoise(x * 0.25, z * 0.25);
    h = Math.max(h, spire(x, z, PEAK, 4.4, PEAK.top, 7.3));      // the perch: a rocky spire with a rough, roughly flat summit
    h = Math.max(h, spire(x, z, LEDGE, 6.0, LEDGE.top, 2.1));    // the landing crag across the valley
    // far ranges all around, for a horizon
    const ring = Math.hypot(x + 6, z + 20);
    h += Math.max(0, ring - 50) * 0.16 * (0.5 + ridged(x * 0.05, z * 0.05));      // lower than the perch: from up there she looks DOWN on the world
    return h;
  }

  // The two calibrated perches retain their exact original triangles. Valleys are
  // excavated away from them; neighbouring ranges form drainage into the lake.
  const smooth = THREE.MathUtils.smoothstep;
  const ranges = [
    {x:-40,z:-22,h:23,r:15,stretch:1.8,a:-0.3,seed:11},
    {x:45,z:-33,h:21,r:15,stretch:2.0,a:0.35,seed:23},
    {x:-65,z:-70,h:44,r:21,stretch:1.5,a:-0.6,seed:34},
    {x:65,z:20,h:35,r:22,stretch:1.5,a:0.5,seed:48},
    {x:-14,z:-100,h:46,r:19,stretch:1.8,a:1.1,seed:62},
    {x:-48,z:46,h:40,r:17,stretch:1.5,a:0.8,seed:81},
    {x:15,z:75,h:33,r:19,stretch:1.8,a:-0.4,seed:97},
  ];
  function rangeHeight(x,z,q) {
    const dx=x-q.x,dz=z-q.z,cs=Math.cos(q.a),sn=Math.sin(q.a);
    const rx=dx*cs-dz*sn, rz=(dx*sn+dz*cs)/q.stretch;
    const d=Math.hypot(rx,rz)/q.r;
    if(d>4.5) return 0;
    const ribs=ridged(x*0.035+q.seed,z*0.035-q.seed);
    const mass=Math.exp(-Math.pow(d,1.4));
    const erosion=ridged(x*0.085+q.seed,z*0.085-q.seed);
    const angle=Math.atan2(rz,rx), mid=4*mass*(1-mass);
    const gullies=ridged(Math.cos(angle)*2.8+q.seed,Math.sin(angle)*2.8+Math.hypot(rx,rz)*.1);
    return q.h*mass*(.84+.20*ribs)+q.h*.22*mid*(gullies-.42)+mass*(erosion-.35)*2.5;
  }
  function heightAt(x,z) {
    const original=pilotHeightAt(x,z);
    const protect=smooth(Math.hypot(x-PEAK.x,z-PEAK.z),6,11)*smooth(Math.hypot(x-LEDGE.x,z-LEDGE.z),8,14);
    if(protect===0) return original;
    const riverX=3.0+Math.sin((z+12)*0.075)*5.0;
    const basin=Math.exp(-Math.pow(Math.abs(x-riverX)/16,3)-Math.pow(Math.abs(z+21)/42,4));
    let land=original-basin*3.8;
    for(const q of ranges) land=Math.max(land,rangeHeight(x,z,q)-basin*3.8);
    const distance=Math.hypot(x+6,z+20);
    const remote=smooth(distance,95,170);
    land+=remote*(4+ridged(x*0.018+27,z*0.018)*42+ridged(x*0.055,z*0.055+9)*12);
    return THREE.MathUtils.lerp(original,land,protect);
  }
  const geology=await createGeologyMaterial({lite});
  const meshes=[];
  // the base terrain (coarse) + two fine patches over the mountains (0.1 unit cells: no facets close to her). Inside a patch the base is
  // pushed 4 cm down so the fine surface covers it.
  const PATCHES = [{ x: PEAK.x, z: PEAK.z, size: 16, seg: 180 }, { x: LEDGE.x, z: LEDGE.z, size: 20, seg: 180 }];
  const inPatch = (x, z) => PATCHES.some((q) => Math.abs(x - q.x) < q.size / 2 - 0.2 && Math.abs(z - q.z) < q.size / 2 - 0.2);
  function terrainMesh(size, seg, cx, cz, lowerInPatches) {
    const geo = new THREE.PlaneGeometry(size, size, seg, seg); geo.rotateX(-Math.PI / 2); geo.translate(cx, 0, cz);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), z = pos.getZ(i); pos.setY(i, heightAt(x, z) - (lowerInPatches && inPatch(x, z) ? 0.04 : 0)); }
    if (lowerInPatches) {
      // Fine patches own their interior, including depth and shadows: a coarse
      // triangle must never poke through the rock supporting a toe.
      const index = geo.index.array, retained = [];
      for (let i = 0; i < index.length; i += 3) {
        const x = (pos.getX(index[i]) + pos.getX(index[i+1]) + pos.getX(index[i+2])) / 3;
        const z = (pos.getZ(index[i]) + pos.getZ(index[i+1]) + pos.getZ(index[i+2])) / 3;
        if (!inPatch(x,z)) retained.push(index[i],index[i+1],index[i+2]);
      }
      geo.setIndex(retained);
    }
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, geology.material);
    mesh.name = lowerInPatches ? 'Valley terrain' : 'Calibrated rock perch';
    mesh.receiveShadow = true; mesh.layers.enable(LAYER_OCCLUDER); scene.add(mesh); meshes.push(mesh); return mesh;
  }
  const valleySegments = lite ? 220 : 260;
  terrainMesh(180, valleySegments, -6, -20, true);
  for (const q of PATCHES) terrainMesh(q.size, q.seg, q.x, q.z, false);
  // Contact samples the actual triangles of the rendered rock, including the coarse mesh's drop below each summit patch.
  // Cache the static cell corners: evaluating fractal heightAt for every toe in every frame would be needlessly expensive.
  const surfaces = [...PATCHES.map((q) => ({ cx: q.x, cz: q.z, size: q.size, seg: q.seg, patch: true })),
    { cx: -6, cz: -20, size: 180, seg: valleySegments, patch: false }];
  const surfaceCorners = surfaces.map(() => new Map());
  function surfaceAt(x, z) {
    let k = surfaces.length - 1;
    for (let i = 0; i < PATCHES.length; i++) {
      const q = surfaces[i];
      if (Math.abs(x - q.cx) < q.size / 2 && Math.abs(z - q.cz) < q.size / 2) { k = i; break; }
    }
    const q = surfaces[k], cell = q.size / q.seg;
    const gx = (x - q.cx + q.size / 2) / cell, gz = (z - q.cz + q.size / 2) / cell;
    const ix = Math.min(q.seg - 1, Math.max(0, Math.floor(gx))), iz = Math.min(q.seg - 1, Math.max(0, Math.floor(gz)));
    const fx = gx - ix, fz = gz - iz;
    const h = (a, b) => {
      const key = a * (q.seg + 1) + b, cache = surfaceCorners[k];
      if (!cache.has(key)) {
        const px = q.cx - q.size / 2 + a * cell, pz = q.cz - q.size / 2 + b * cell;
        cache.set(key, heightAt(px, pz) - (!q.patch && inPatch(px, pz) ? 0.04 : 0));
      }
      return cache.get(key);
    };
    const a = h(ix, iz), b = h(ix, iz + 1), c = h(ix + 1, iz + 1), d = h(ix + 1, iz);
    return fx + fz <= 1 ? a + (d - a) * fx + (b - a) * fz : c + (b - c) * (1 - fx) + (d - c) * (1 - fz);
  }

  // A separate outer mesh extends beyond the valley without overdrawing its centre.
  const farSize=620, farSeg=lite?140:180;
  const distant=new THREE.PlaneGeometry(farSize,farSize,farSeg,farSeg);
  distant.rotateX(-Math.PI/2); distant.translate(-6,0,-20);
  const dp=distant.attributes.position;
  for(let i=0;i<dp.count;i++) dp.setY(i,heightAt(dp.getX(i),dp.getZ(i))-.3);
  const oldIndex=distant.index.array, outside=[];
  for(let i=0;i<oldIndex.length;i+=3) {
    const tri=[oldIndex[i],oldIndex[i+1],oldIndex[i+2]];
    if(tri.some(j=>Math.abs(dp.getX(j)+6)>88 || Math.abs(dp.getZ(j)+20)>88)) outside.push(...tri);
  }
  distant.setIndex(outside); distant.computeVertexNormals();
  const farMesh=new THREE.Mesh(distant,geology.material); farMesh.name='Distant cordilleras';
  scene.add(farMesh); meshes.push(farMesh);
  // Broken talus provides actual parallax and silhouettes beyond the feet's clear support area.
  const stoneGeometry=new THREE.IcosahedronGeometry(1,1);
  const sp=stoneGeometry.attributes.position;
  for(let i=0;i<sp.count;i++){
    const x=sp.getX(i),y=sp.getY(i),z=sp.getZ(i),r=.75+hash(Math.round(x*100)+Math.round(y*193),Math.round(z*137))*.35;
    sp.setXYZ(i,x*r,y*r,z*r);
  }
  stoneGeometry.computeVertexNormals();
  const stoneMaterial=geology.material;
  const count=lite?480:950, stones=new THREE.InstancedMesh(stoneGeometry,stoneMaterial,count);
  stones.name='Valley scree'; stones.receiveShadow=true; stones.layers.enable(LAYER_OCCLUDER);
  const transform=new THREE.Object3D(); let placed=0;
  for(let i=0;placed<count && i<count*12;i++) {
    const x=(hash(i,73)-.5)*110-6,z=(hash(i,91)-.5)*125-20;
    const y=heightAt(x,z);
    if(y<.85 || Math.hypot(x,z)<3.2 || Math.hypot(x+12,z+40)<3.4) continue;
    const slope=Math.hypot(heightAt(x+.2,z)-heightAt(x-.2,z),heightAt(x,z+.2)-heightAt(x,z-.2))/.4;
    if(slope>1.0) continue;
    const scale=.035+Math.pow(hash(i,38),3)*.32;
    transform.position.set(x,surfaceAt(x,z)-scale*.30,z); transform.rotation.set(hash(i,13)*3,hash(i,14)*6,hash(i,15)*3);
    transform.scale.set(scale*(.8+hash(i,16)),scale*(.55+hash(i,17)),scale*(.8+hash(i,18)));
    transform.updateMatrix(); stones.setMatrixAt(placed++,transform.matrix);
  }
  stones.count=placed; stones.instanceMatrix.needsUpdate=true; scene.add(stones);
  const lake=water?createValleyWater({scene,heightAt,sunDirection,lite,reducedMotion,rockDetail:geology.detail}):null;
  return {
    PEAK,LEDGE,heightAt,surfaceAt,hash,meshes,lake,
    update(time) { lake?.update(time); },
    diagnostics() { return { terrainMeshes:meshes.length,terrainVertices:meshes.reduce((n,m)=>n+m.geometry.attributes.position.count,0),stones:placed,water:lake?.diagnostics()??null }; },
    dispose() { lake?.dispose(); for(const mesh of meshes){scene.remove(mesh);mesh.geometry.dispose();} scene.remove(stones);stoneGeometry.dispose();geology.dispose(); },
  };
}

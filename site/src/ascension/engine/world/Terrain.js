// Terrain system: dense summit mesh + far range mesh (shared height function), GPU bake
// (height tiles → per-vertex height/gradient → shadow/AO) and a CPU height query.
import * as THREE from 'three';
import { radialGrid, SUMMIT } from './MountainSummit.js';
import { bakeMaterial, terrainMaterial, heightMapMaterial, heightTileMaterial } from './TerrainShader.js';
import { fullscreenGeometry } from './AtmosphereShader.js';

const floatRT = (w, h, filter = THREE.NearestFilter) => new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: filter, magFilter: filter, depthBuffer: false, generateMipmaps: false, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping });

export class TerrainSystem {
  constructor(renderer, q) {
    this.renderer = renderer;
    this.group = new THREE.Group(); this.group.name = 'Terrain';
    const farR = 52000;
    const farRings = q.farRings, segs = q.terrainSegments;
    const bFar = Math.log(farR / SUMMIT.nearRadius) / (farRings - 1);
    this.parts = [
      { name: 'MountainSummit', grid: radialGrid({ r0: 0, r1: SUMMIT.nearRadius, rings: q.summitRings, segments: segs, b: bFar }) },
      { name: 'TerrainRange', grid: radialGrid({ r0: SUMMIT.nearRadius, r1: farR, rings: farRings, segments: segs }) },
    ];
    const quad = new THREE.Mesh(fullscreenGeometry()); quad.frustumCulled = false;
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const draw = (mat, rt, band = 64) => {
      quad.material = mat;
      for (let y = 0; y < rt.height; y += band) {
        const hgt = Math.min(band, rt.height - y);
        rt.viewport.set(0, y, rt.width, hgt); rt.scissor.set(0, y, rt.width, hgt); rt.scissorTest = true;
        renderer.setRenderTarget(rt); renderer.render(quad, cam);
      }
      rt.scissorTest = false; rt.viewport.set(0, 0, rt.width, rt.height); rt.scissor.set(0, 0, rt.width, rt.height);
    };
    const t0 = performance.now();
    // 1 · height tiles
    const tile = (half, res) => { const rt = floatRT(res, res); const rect = new THREE.Vector4(-half, -half, half * 2, half * 2); const m = heightTileMaterial(rect, res); draw(m, rt); m.dispose(); return { rt, texture: rt.texture, rect, res: new THREE.Vector2(res, res) }; };
    this.tiles = { near: tile(1200, q.tileRes || 1024), far: tile(48000, q.tileRes || 1024) };
    // 2 · per-vertex bake
    for (const part of this.parts) {
      const { rings, segments } = part.grid;
      part.bakeA = floatRT(segments, rings); part.bakeB = floatRT(segments, rings);
      const bm = bakeMaterial(part.grid.params, this.tiles);
      bm.uniforms.uShadowSteps.value = q.terrainShadowSteps;
      bm.uniforms.uPass.value = 0; bm.uniforms.uBakeA.value = null; // never sample the target being written
      draw(bm, part.bakeA, 48);
      bm.uniforms.uPass.value = 1; bm.uniforms.uBakeA.value = part.bakeA.texture;
      draw(bm, part.bakeB, 48);
      bm.dispose();
      part.material = terrainMaterial(part.grid.params, part.bakeA.texture, part.bakeB.texture);
      part.mesh = new THREE.Mesh(part.grid.geometry, part.material);
      part.mesh.name = part.name; part.mesh.frustumCulled = false; part.mesh.matrixAutoUpdate = false;
      this.group.add(part.mesh);
      part.heights = new Float32Array(segments * rings * 4);
      renderer.readRenderTargetPixels(part.bakeA, 0, 0, segments, rings, part.heights);
    }
    // 3 · low-res height + sun-shadow-height map shared with the volumetric clouds
    const HM = 512, half = 15000;
    this.cloudHeightRect = new THREE.Vector4(-half, -half, half * 2, half * 2);
    this.cloudHeightMap = new THREE.WebGLRenderTarget(HM, HM, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping });
    const hm = heightMapMaterial(this.cloudHeightRect, HM, this.tiles.far);
    draw(hm, this.cloudHeightMap); hm.dispose();
    renderer.setRenderTarget(null);
    this.bakeMs = performance.now() - t0;
    this.triangles = this.parts.reduce((a, p) => a + p.grid.geometry.index.count / 3, 0);
    this.vertices = this.parts.reduce((a, p) => a + p.grid.rings * p.grid.segments, 0);
  }

  heightAt(x, z) {
    const r = Math.hypot(x, z);
    const part = r <= SUMMIT.nearRadius ? this.parts[0] : this.parts[1];
    const { params, rings, segments } = part.grid;
    const mode = params.x, a = params.y, b = params.z;
    let fi = mode === 0 ? Math.log(r / a + 1) / b : Math.log(Math.max(r, a) / a) / b;
    fi = Math.min(Math.max(fi, 0), rings - 1.001);
    let th = Math.atan2(z, x); if (th < 0) th += Math.PI * 2;
    const fj = th / (Math.PI * 2) * segments;
    const i0 = Math.floor(fi), j0 = Math.floor(fj) % segments, j1 = (j0 + 1) % segments;
    const ti = fi - i0, tj = fj - Math.floor(fj);
    const H = (i, j) => part.heights[(i * segments + j) * 4];
    const h0 = H(i0, j0) * (1 - tj) + H(i0, j1) * tj;
    const h1 = H(i0 + 1, j0) * (1 - tj) + H(i0 + 1, j1) * tj;
    return h0 * (1 - ti) + h1 * ti;
  }

  setToggle(key, on) {
    const map = { detail: 'uDetailOn', shadows: 'uShadowOn', ao: 'uAOOn' };
    for (const p of this.parts) if (map[key]) p.material.uniforms[map[key]].value = on ? 1 : 0;
    if (key === 'terrain') this.group.visible = on;
  }

  dispose() {
    for (const p of this.parts) { p.bakeA.dispose(); p.bakeB.dispose(); p.material.dispose(); p.grid.geometry.dispose(); }
    this.tiles.near.rt.dispose(); this.tiles.far.rt.dispose(); this.cloudHeightMap.dispose();
  }
}

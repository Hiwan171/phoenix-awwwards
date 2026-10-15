// Inspect a GLB before rigging: structure, size, bbox, textures, existing skin, and where the mass is.
// usage: node inspect.mjs ../model/model.glb
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(process.argv[2]);
const root = doc.getRoot();
const f = (v, d = 3) => v.map((x) => x.toFixed(d)).join(', ');

console.log('scenes', root.listScenes().length, '| nodes', root.listNodes().length, '| meshes', root.listMeshes().length,
  '| skins', root.listSkins().length, '| animations', root.listAnimations().length, '| materials', root.listMaterials().length);
console.log('extensionsUsed', root.listExtensionsUsed().map((e) => e.extensionName).join(', ') || '-');
for (const n of root.listNodes()) {
  const m = n.getMesh();
  console.log(`  node "${n.getName()}" mesh=${m ? m.getName() : '-'} T=[${f(n.getTranslation())}] S=[${f(n.getScale())}] R=[${f(n.getRotation())}] children=${n.listChildren().length}`);
}
for (const t of root.listTextures()) {
  const img = t.getImage();
  console.log(`  texture "${t.getName()}" ${t.getMimeType()} ${(img?.byteLength / 1e6).toFixed(1)} MB size=${t.getSize()?.join('x')}`);
}
for (const m of root.listMaterials()) {
  console.log(`  material "${m.getName()}" base=[${f(m.getBaseColorFactor(), 2)}] metal=${m.getMetallicFactor()} rough=${m.getRoughnessFactor()} alphaMode=${m.getAlphaMode()} doubleSided=${m.getDoubleSided()}`
    + ` maps: base=${!!m.getBaseColorTexture()} normal=${!!m.getNormalTexture()} mr=${!!m.getMetallicRoughnessTexture()} emissive=${!!m.getEmissiveTexture()} occlusion=${!!m.getOcclusionTexture()}`);
}

let totalV = 0, totalT = 0;
const all = [];
for (const mesh of root.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION').getArray();
    const idx = prim.getIndices()?.getArray();
    const nV = pos.length / 3, nT = idx ? idx.length / 3 : nV / 3;
    totalV += nV; totalT += nT;
    const attrs = prim.listSemantics().join(',');
    console.log(`  mesh "${mesh.getName()}" prim: verts=${nV} tris=${nT} attrs=[${attrs}] mode=${prim.getMode()}`);
    all.push({ pos, nV });
  }
}
console.log('TOTAL verts', totalV, 'tris', totalT);

// bounds + centre of mass + extreme points, per primitive combined
const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9], c = [0, 0, 0];
for (const { pos, nV } of all) for (let i = 0; i < nV; i++) for (let k = 0; k < 3; k++) {
  const v = pos[i * 3 + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; c[k] += v;
}
const nAll = all.reduce((a, b) => a + b.nV, 0);
console.log('bbox min', f(mn), '| max', f(mx), '| size', f(mx.map((v, k) => v - mn[k])), '| mean', f(c.map((v) => v / nAll)));

// left/right symmetry about X=0 and about the bbox centre (rough: counts of vertices on each side)
let left = 0, right = 0;
const cx = (mn[0] + mx[0]) / 2;
for (const { pos, nV } of all) for (let i = 0; i < nV; i++) { if (pos[i * 3] < cx) left++; else right++; }
console.log('vertices left/right of bbox centre X:', left, right, '(ratio', (left / right).toFixed(2) + ')');

// slabs along each axis: where the mass is, and the lateral extent of each slab
for (const [axisName, a, b1, b2] of [['Y (up?)', 1, 0, 2], ['X', 0, 1, 2], ['Z', 2, 0, 1]]) {
  console.log(`\nslabs along ${axisName}: range of other axes per slab`);
  const steps = 14, lo = mn[a], hi = mx[a], h = (hi - lo) / steps;
  const cnt = new Array(steps).fill(0), r1 = Array.from({ length: steps }, () => [1e9, -1e9]), r2 = Array.from({ length: steps }, () => [1e9, -1e9]);
  for (const { pos, nV } of all) for (let i = 0; i < nV; i++) {
    const s = Math.min(steps - 1, Math.floor((pos[i * 3 + a] - lo) / h));
    cnt[s]++;
    r1[s][0] = Math.min(r1[s][0], pos[i * 3 + b1]); r1[s][1] = Math.max(r1[s][1], pos[i * 3 + b1]);
    r2[s][0] = Math.min(r2[s][0], pos[i * 3 + b2]); r2[s][1] = Math.max(r2[s][1], pos[i * 3 + b2]);
  }
  for (let s = steps - 1; s >= 0; s--) {
    const v = (lo + h * (s + 0.5)).toFixed(2);
    console.log(`  ${axisName[0]}=${v.padStart(6)}  n=${String(cnt[s]).padStart(7)}  ${['X', 'Y', 'Z'][b1]}[${r1[s][0].toFixed(2)}, ${r1[s][1].toFixed(2)}]  ${['X', 'Y', 'Z'][b2]}[${r2[s][0].toFixed(2)}, ${r2[s][1].toFixed(2)}]`);
  }
}

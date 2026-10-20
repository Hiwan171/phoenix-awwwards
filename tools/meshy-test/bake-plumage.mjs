// Recover the opening's back-feather membership before rig-spine intentionally moved those weights to the spine.
// Does not modify either GLB. Run from the repo: node tools/meshy-test/bake-plumage.mjs
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const source = await io.read(path.join(root, 'model/meshy-test/Fenix_rig.glb'));
const primitive = source.getRoot().listMeshes()[0].listPrimitives()[0];
const sourceSkin = source.getRoot().listSkins()[0];
const names = sourceSkin.listJoints().map((j) => j.getName());
const positions = primitive.getAttribute('POSITION'), joints = primitive.getAttribute('JOINTS_0'), weights = primitive.getAttribute('WEIGHTS_0');
const chainLengths = new Map();
for (const name of names) {
  const match = /^F_back_(\d+)_(\d+)$/.exec(name);
  if (match) chainLengths.set(+match[1], Math.max(chainLengths.get(+match[1]) ?? 0, +match[2] + 1));
}
const cell = 0.001, grid = new Map(), point = [], js = [], ws = [];
const key = (x, y, z) => x + ',' + y + ',' + z;
for (let i = 0; i < positions.getCount(); i++) {
  joints.getElement(i, js); weights.getElement(i, ws);
  let mass = 0, along = 0, best = 0, chain = -1;
  for (let k = 0; k < 4; k++) {
    const match = /^F_back_(\d+)_(\d+)$/.exec(names[js[k]]);
    if (!match) continue;
    mass += ws[k]; along += ws[k] * (+match[2] / Math.max(1, chainLengths.get(+match[1]) - 1));
    if (ws[k] > best) { best = ws[k]; chain = +match[1]; }
  }
  if (mass < 0.65) continue;
  positions.getElement(i, point);
  const record = { x: point[0], y: point[1], z: point[2], chain, along: along / mass };
  const id = key(Math.floor(record.x / cell), Math.floor(record.y / cell), Math.floor(record.z / cell));
  if (!grid.has(id)) grid.set(id, []);
  grid.get(id).push(record);
}

const transform = (p, m) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
const multiply = (a, b) => Array.from({ length: 16 }, (_, i) => { const row = i % 4, col = Math.floor(i / 4); let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + row] * b[col * 4 + k]; return s; });
for (const variant of ['web', 'lite']) {
  const doc = await io.read(path.join(root, 'site/public/models/fenix-flight-' + variant + '.glb'));
  const node = doc.getRoot().listNodes().find((n) => n.getMesh());
  const prim = node.getMesh().listPrimitives()[0], pos = prim.getAttribute('POSITION');
  // Meshopt quantization stores the position decode transform in the inverse bind matrices for a skinned mesh.
  const skin = doc.getRoot().listSkins()[0], inverse = skin.getInverseBindMatrices().getElement(0, []);
  const matrix = multiply(skin.listJoints()[0].getWorldMatrix(), inverse);
  const records = []; let maxError = 0;
  for (let i = 0; i < pos.getCount(); i++) {
    pos.getElement(i, point);
    const p = transform(point, matrix), cx = Math.floor(p[0] / cell), cy = Math.floor(p[1] / cell), cz = Math.floor(p[2] / cell);
    let best = null, bestD = 0.00035 ** 2;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      for (const r of grid.get(key(cx + dx, cy + dy, cz + dz)) ?? []) {
        const d = (p[0] - r.x) ** 2 + (p[1] - r.y) ** 2 + (p[2] - r.z) ** 2;
        if (d < bestD) { bestD = d; best = r; }
      }
    }
    if (!best) continue;
    // A chain's first third stays attached. Only the free distal edge catches the breeze.
    const x = Math.min(1, Math.max(0, (best.along - 0.35) / 0.65));
    const weight = x * x * (3 - 2 * x);
    if (weight < 0.001) continue;
    records.push([i, best.chain, Math.round(weight * 65535)]); maxError = Math.max(maxError, Math.sqrt(bestD));
  }
  const bytes = new Uint8Array(12 + records.length * 8), view = new DataView(bytes.buffer);
  view.setUint32(0, 0x504c4d31, true); view.setUint32(4, pos.getCount(), true); view.setUint32(8, records.length, true);
  records.forEach(([i, chain, weight], n) => { const o = 12 + n * 8; view.setUint32(o, i, true); view.setUint16(o + 4, chain, true); view.setUint16(o + 6, weight, true); });
  const output = path.join(root, 'site/public/models/fenix-plumage-' + variant + '.bin');
  await fs.writeFile(output, bytes);
  console.log(JSON.stringify({ variant, vertices: pos.getCount(), selected: records.length, chains: new Set(records.map((r) => r[1])).size, maxMatchError: maxError, bytes: bytes.length }));
}

// Rigged + animated Meshy GLB (~590k tris, 694 bones, 4096 textures)  ->  a web GLB for the site.
//   node tools/meshy-test/to-web.mjs <in.glb> <out.glb> [ratio=0.2] [error=0.01] [base=2048] [normal=2048] [mr=1024]
// weld + meshopt simplify (vertices are never moved or interpolated, so skin indices/weights stay valid), then WebP textures and
// Meshopt-compressed quantised geometry (tools/optimize.mjs). Skeleton, skin and animation are untouched.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplify, textureCompress, prune, dedup, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'node:fs';

const [, , input, output, ratio = '0.2', error = '0.01', base = '2048', normal = '2048', mr = '1024'] = process.argv;
await MeshoptEncoder.ready; await MeshoptDecoder.ready; await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(input);
const count = () => doc.getRoot().listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((k, p) => k + (p.getIndices()?.getCount() ?? 0) / 3, 0), 0);
console.log('triangles in', count());
const tex = (slots, size, q) => textureCompress({ encoder: sharp, targetFormat: 'webp', slots, resize: [size, size], quality: q });
await doc.transform(
  weld({ tolerance: 0 }),
  simplify({ simplifier: MeshoptSimplifier, ratio: +ratio, error: +error, lockBorder: false }),
  tex(/baseColor/, +base, 85), tex(/normal/, +normal, 90), tex(/metallicRoughness/, +mr, 82),
  prune(), dedup(),
  meshopt({ encoder: MeshoptEncoder, level: 'high' }),
);
console.log('triangles out', count());
await io.write(output, doc);
console.log('wrote', output, (fs.statSync(output).size / 1048576).toFixed(2), 'MB');

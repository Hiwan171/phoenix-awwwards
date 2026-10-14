// Web optimisation of the rigged phoenix: WebP textures (resized) + quantised, Meshopt-compressed geometry.
// Rig, skin weights and animations are untouched.   usage: node optimize.mjs in.glb out.glb [baseSize] [normalSize] [mrSize]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { textureCompress, prune, dedup, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';

const [,, input, output, base = '2048', normal = '2048', mr = '1024'] = process.argv;
await MeshoptEncoder.ready; await MeshoptDecoder.ready;

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

const doc = await io.read(input);
const tex = (slots, size, quality) => textureCompress({
  encoder: sharp, targetFormat: 'webp', slots, resize: [size, size], quality,
});

await doc.transform(
  tex(/baseColor/, +base, 85),
  tex(/normal/, +normal, 90),
  tex(/metallicRoughness/, +mr, 82),
  prune(),
  dedup(),
  meshopt({ encoder: MeshoptEncoder, level: 'high' }),
);
await io.write(output, doc);
console.log('wrote', output);

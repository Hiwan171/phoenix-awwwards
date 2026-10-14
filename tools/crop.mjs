import { NodeIO } from '@gltf-transform/core';
import { render } from './render.mjs';
const [,, input, out, view, ...c] = process.argv;
const doc = await new NodeIO().read(input);
const pos = doc.getRoot().listMeshes()[0].listPrimitives()[0].getAttribute('POSITION').getArray();
render(pos, out, view, { crop: c.map(Number) });

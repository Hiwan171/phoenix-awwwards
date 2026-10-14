import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
for (const f of process.argv.slice(2)) {
  const d = await io.read(f), r = d.getRoot();
  const p = r.listMeshes()[0].listPrimitives()[0];
  const node = r.listNodes().find((n) => n.getMesh());
  console.log(f.split(/[\/]/).pop(), {
    skins: r.listSkins().length, joints: r.listSkins()[0]?.listJoints().length, meshNodeHasSkin: !!node.getSkin(),
    anims: r.listAnimations().map((a) => `${a.getName()}(${a.listChannels().length}ch)`),
    attrs: p.listSemantics(), ext: r.listExtensionsUsed().map((e) => e.extensionName),
    nodeScale: node.getScale(), nodeTrans: node.getTranslation(),
    tex: r.listTextures().map((t) => `${t.getMimeType()} ${t.getSize()?.join('x')}`),
  });
}

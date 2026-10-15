// Gives every tail strip of the Meshy rig test its OWN bone chain, so each strip can move on its own.
//   node tools/meshy-test/rig-tail.mjs [in.glb] [out.glb]          DRY=1 only prints the strips found
//
// Meshy rigged the whole tail with three chains (Bone_014 / 020 / 026, six bones each): every strip near a chain moves in
// lockstep with the others on it. Here:
//   1. strips = connected components (welded by position) whose vertices are >= 80 % weighted to the tail chains;
//   2. for each strip, surface distance from its root end (the vertex nearest the tail base) gives a parameter s in 0..1;
//   3. K joints are placed at the centroids of s-bins (the strip's own centre line, curved as the strip is curved), parented to
//      the original bone that owns the strip's base, with identity world rest rotation (same convention as the other rigs);
//   4. the strip is skinned to its own chain only: smooth blend between neighbouring joints along s (two influences);
//   5. small loose pieces near a strip (leaf ornaments etc.) copy the weights of the nearest strip vertex.
// Everything that is not a tail strip keeps Meshy's weights untouched.
import { NodeIO, Accessor } from '@gltf-transform/core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPrep, adjacency, components, geodesic } from '../rigs/lib/mesh.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '../..');
const [, , inArg, outArg] = process.argv;
const input = inArg ?? path.join(REPO, 'model/fenix/Fenix-RIG.glb');
const output = outArg ?? path.join(REPO, 'model/meshy-test/Meshy_rig.glb');
const CFG = { tailFrac: 0.8, minStrip: 500, minPiece: 40, boneSpacing: 0.16, kMin: 4, kMax: 9, smooth: true };

const { io, doc, root, prim, pos, idx, nV } = await loadPrep(input);
const skin = root.listSkins()[0];
const joints = skin.listJoints();
const names = joints.map((j) => j.getName());
const num = (s) => +s.replace('Bone_', '');
const isTailBone = (name) => { const k = num(name); return k >= 14 && k <= 31; };
const tailJoint = names.map(isTailBone);
const J = prim.getAttribute('JOINTS_0').getArray(), Wt = prim.getAttribute('WEIGHTS_0').getArray();

// ── graph and per-vertex tail ownership ──
// NOT welded by position: the tail is made of many pieces (strips, barbs, leaves) that touch each other, and welding by position
// fuses them into 4 components. The index components (one per piece) are the units; where pieces touch, the weights are blended
// at the end so the surface stays closed.
const nW = nV, weld = Int32Array.from({ length: nV }, (_, i) => i), rep = weld, p = pos;
const adj = adjacency(weld, idx, nW);
const comps = components(adj);
const tail = new Float32Array(nW), domJoint = new Int16Array(nW);
for (let w = 0; w < nW; w++) {
  const v = rep[w]; let t = 0, bw = -1, bj = 0;
  for (let k = 0; k < 4; k++) { const wt = Wt[v*4+k], j = J[v*4+k]; if (tailJoint[j]) t += wt; if (wt > bw) { bw = wt; bj = j; } }
  tail[w] = t; domJoint[w] = bj;
}
const agg = Array.from({ length: comps.count }, () => ({ n: 0, tail: 0 }));
for (let w = 0; w < nW; w++) { const c = agg[comps.comp[w]]; c.n++; c.tail += tail[w] > 0.5 ? 1 : 0; }
const isTailComp = (c) => agg[c].tail / agg[c].n >= CFG.tailFrac;
const strips = [], pieces = [];
agg.forEach((c, i) => { if (!isTailComp(i)) return; (c.n >= CFG.minStrip ? strips : pieces).push(i); });
const stripVerts = strips.reduce((s, c) => s + agg[c].n, 0), pieceVerts = pieces.reduce((s, c) => s + agg[c].n, 0);
console.log(`welded verts ${nW}, components ${comps.count}; tail strips ${strips.length} (${stripVerts} verts), loose tail pieces ${pieces.length} (${pieceVerts} verts)`);
console.log('strip sizes', strips.map((c) => agg[c].n).sort((a, b) => b - a).join(' '));
if (process.env.DRY) process.exit(0);

// ── geometry helpers ──
const meshNodeWorld = doc.getRoot().listNodes().find((n) => n.getMesh())?.getWorldMatrix();
const isIdentity = (m) => m && m.every((x, i) => Math.abs(x - (i % 5 === 0 ? 1 : 0)) < 1e-5);
if (!isIdentity(meshNodeWorld)) console.warn('WARNING: the mesh node is not at the origin; joint positions assume mesh space == world space', meshNodeWorld);
const byName = new Map(joints.map((j) => [j.getName(), j]));
const matQuat = (m) => { // column-major 4x4, no scale
  const t = m[0] + m[5] + m[10]; let x, y, z, w;
  if (t > 0) { const s = Math.sqrt(t + 1) * 2; w = s / 4; x = (m[6] - m[9]) / s; y = (m[8] - m[2]) / s; z = (m[1] - m[4]) / s; }
  else if (m[0] > m[5] && m[0] > m[10]) { const s = Math.sqrt(1 + m[0] - m[5] - m[10]) * 2; w = (m[6] - m[9]) / s; x = s / 4; y = (m[4] + m[1]) / s; z = (m[8] + m[2]) / s; }
  else if (m[5] > m[10]) { const s = Math.sqrt(1 + m[5] - m[0] - m[10]) * 2; w = (m[8] - m[2]) / s; x = (m[4] + m[1]) / s; y = s / 4; z = (m[9] + m[6]) / s; }
  else { const s = Math.sqrt(1 + m[10] - m[0] - m[5]) * 2; w = (m[1] - m[4]) / s; x = (m[8] + m[2]) / s; y = (m[9] + m[6]) / s; z = s / 4; }
  const l = Math.hypot(x, y, z, w); return [x / l, y / l, z / l, w / l];
};
const qmul = (a, b) => [a[3]*b[0] + a[0]*b[3] + a[1]*b[2] - a[2]*b[1], a[3]*b[1] - a[0]*b[2] + a[1]*b[3] + a[2]*b[0], a[3]*b[2] + a[0]*b[1] - a[1]*b[0] + a[2]*b[3], a[3]*b[3] - a[0]*b[0] - a[1]*b[1] - a[2]*b[2]];
const qinv = (q) => [-q[0], -q[1], -q[2], q[3]];
const qrot = (q, v) => { const r = qmul(qmul(q, [v[0], v[1], v[2], 0]), qinv(q)); return [r[0], r[1], r[2]]; };
const smooth = (t) => t * t * (3 - 2 * t);

// ── per strip: parameter s, joint centres, parent bone ──
const baseRef = byName.get('Bone_001').getWorldTranslation();          // the body bone the tail hangs from
const members = new Map(); for (const c of [...strips, ...pieces]) members.set(c, []);
for (let w = 0; w < nW; w++) { const m = members.get(comps.comp[w]); if (m) m.push(w); }
const newJoints = [];                                                    // { node, pos, name }
const wJ = new Int32Array(nW * 2).fill(-1), wW = new Float32Array(nW * 2);   // new influences per welded vertex (joint index into newJoints + offset later)
const stripOf = new Int32Array(nW).fill(-1);
const stripInfo = [];
strips.forEach((c, si) => {
  const list = members.get(c);
  // root end: the vertex nearest the tail base
  let best = list[0], bd = Infinity;
  for (const w of list) { const d = Math.hypot(p[w*3] - baseRef[0], p[w*3+1] - baseRef[1], p[w*3+2] - baseRef[2]); if (d < bd) { bd = d; best = w; } }
  const dist = geodesic(adj, p, [best]);
  let dmax = 0; for (const w of list) if (Number.isFinite(dist[w]) && dist[w] > dmax) dmax = dist[w];
  const K = Math.max(CFG.kMin, Math.min(CFG.kMax, Math.ceil(dmax / CFG.boneSpacing) + 1));
  // joint centres: triangular-window centroids over s
  const acc = Array.from({ length: K }, () => ({ x: 0, y: 0, z: 0, w: 0 }));
  for (const w of list) {
    const s = Math.min(1, dist[w] / dmax), u = s * (K - 1), i0 = Math.min(K - 2, Math.floor(u)), t = u - i0;
    for (const [i, wt] of [[i0, 1 - t], [i0 + 1, t]]) { const a = acc[i]; a.x += p[w*3] * wt; a.y += p[w*3+1] * wt; a.z += p[w*3+2] * wt; a.w += wt; }
  }
  const centres = acc.map((a) => [a.x / a.w, a.y / a.w, a.z / a.w]);
  // the strip's own start is its root vertex neighbourhood, not the centroid of the first bin (avoids a pivot floating off the base)
  centres[0] = [p[best*3], p[best*3+1], p[best*3+2]];
  // Surface distance is a poor parameter on a feather with barbs (a barb's tip is "farther" than its base, so one cross-section
  // gets several different weights and shears). Re-parametrise by the closest point on the centre line, and re-centre twice.
  const sProj = new Float32Array(list.length);
  const project = () => {
    for (let n = 0; n < list.length; n++) {
      const w = list[n], x = p[w*3], y = p[w*3+1], z = p[w*3+2];
      let bestD = Infinity, bestS = 0;
      for (let i = 0; i < K - 1; i++) {
        const a = centres[i], b = centres[i+1], dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
        const l2 = dx*dx + dy*dy + dz*dz || 1e-9;
        const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy + (z - a[2]) * dz) / l2));
        const d = (x - a[0] - dx * t) ** 2 + (y - a[1] - dy * t) ** 2 + (z - a[2] - dz * t) ** 2;
        if (d < bestD) { bestD = d; bestS = (i + t) / (K - 1); }
      }
      sProj[n] = bestS;
    }
  };
  for (let it = 0; it < 3; it++) {
    project();
    if (it === 2) break;
    const acc2 = Array.from({ length: K }, () => ({ x: 0, y: 0, z: 0, w: 0 }));
    list.forEach((w, n) => {
      const u = sProj[n] * (K - 1), i0 = Math.min(K - 2, Math.floor(u)), t = u - i0;
      for (const [i, wt] of [[i0, 1 - t], [i0 + 1, t]]) { const a = acc2[i]; a.x += p[w*3] * wt; a.y += p[w*3+1] * wt; a.z += p[w*3+2] * wt; a.w += wt; }
    });
    acc2.forEach((a, i) => { if (a.w > 1e-6 && i > 0) centres[i] = [a.x / a.w, a.y / a.w, a.z / a.w]; });
  }
  // parent: the original bone dominating the root end
  const votes = new Map();
  for (const w of list) if (dist[w] / dmax < 0.12) votes.set(domJoint[w], (votes.get(domJoint[w]) ?? 0) + 1);
  let parentJ = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? names.indexOf('Bone_025');
  if (!tailJoint[parentJ]) parentJ = names.indexOf('Bone_025');
  const parent = joints[parentJ];
  // nodes: identity world rotation; first joint hangs from the parent bone
  const pw = parent.getWorldMatrix(), pq = matQuat(pw), ppos = [pw[12], pw[13], pw[14]];
  let prev = parent, prevPos = ppos, prevQ = pq;
  const chain = [];
  for (let i = 0; i < K; i++) {
    const node = doc.createNode(`Strip_${String(si).padStart(2, '0')}_${i}`);
    const rel = [centres[i][0] - prevPos[0], centres[i][1] - prevPos[1], centres[i][2] - prevPos[2]];
    node.setTranslation(qrot(qinv(prevQ), rel));
    node.setRotation(i === 0 ? qinv(pq) : [0, 0, 0, 1]);                 // world rest rotation = identity for every joint of the chain
    prev.addChild(node);
    prev = node; prevPos = centres[i]; prevQ = [0, 0, 0, 1];
    chain.push(newJoints.length); newJoints.push({ node, pos: centres[i], name: node.getName() });
  }
  // skin weights: smooth blend of two neighbouring joints
  if (process.env.DIAG) {
    const loc = new Map(list.map((w, n) => [w, n])); let jump = 0, maxJ = 0, geoJump = 0;
    for (const w of list) for (let e = adj.start[w]; e < adj.start[w+1]; e++) {
      const v = adj.nb[e], n2 = loc.get(v); if (n2 === undefined || v < w) continue;
      const du = Math.abs(sProj[loc.get(w)] - sProj[n2]) * (K - 1); if (du > 1) jump++; if (du > maxJ) maxJ = du;
      const dg = Math.abs(dist[w] - dist[v]) / dmax * (K - 1); if (dg > 1) geoJump++;
    }
    console.log(`DIAG strip ${si} v${list.length} K${K} L${dmax.toFixed(2)}: edges with |du|>1 bone: ${jump} (max ${maxJ.toFixed(1)}), geodesic jumps ${geoJump}`);
  }
  list.forEach((w, n) => {
    const u = Math.min(1, Math.max(0, sProj[n])) * (K - 1), i0 = Math.min(K - 2, Math.floor(u)), t = CFG.smooth ? smooth(u - i0) : u - i0;
    wJ[w*2] = chain[i0]; wW[w*2] = 1 - t; wJ[w*2+1] = chain[i0 + 1]; wW[w*2+1] = t;
    stripOf[w] = si;
  });
  stripInfo.push({ si, verts: list.length, K, length: +dmax.toFixed(2), parent: names[parentJ] });
});
// loose pieces: each piece moves with ONE host strip (a piece torn between two strips would be stretched between them).
// Host = the strip owning most of the piece's vertices' nearest strip vertices; then every vertex copies the weights of the
// nearest vertex of that host.
{
  const cell = 0.05, grid = new Map(), key = (x, y, z) => `${x},${y},${z}`;
  const cellOf = (v) => [Math.floor(p[v*3] / cell), Math.floor(p[v*3+1] / cell), Math.floor(p[v*3+2] / cell)];
  for (let w = 0; w < nW; w++) if (stripOf[w] >= 0) { const [cx, cy, cz] = cellOf(w); const k = key(cx, cy, cz); (grid.get(k) ?? grid.set(k, []).get(k)).push(w); }
  const nearest = (w, only) => {
    const [cx, cy, cz] = cellOf(w); let bw = -1, bd = Infinity;
    for (let r = 1; r <= 6 && bw < 0; r++) for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
      const l = grid.get(key(cx + dx, cy + dy, cz + dz)); if (!l) continue;
      for (const q of l) { if (only !== undefined && stripOf[q] !== only) continue; const d = (p[q*3]-p[w*3])**2 + (p[q*3+1]-p[w*3+1])**2 + (p[q*3+2]-p[w*3+2])**2; if (d < bd) { bd = d; bw = q; } }
    }
    return [bw, bd];
  };
  let copied = 0, orphan = 0;
  for (const c of pieces) {
    const list = members.get(c), votes = new Map();
    const step = Math.max(1, Math.floor(list.length / 12));                   // a dozen samples are enough to elect the host
    for (let i = 0; i < list.length; i += step) { const [q] = nearest(list[i]); if (q >= 0) votes.set(stripOf[q], (votes.get(stripOf[q]) ?? 0) + 1); }
    const host = [...votes.entries()].sort((a2, b2) => b2[1] - a2[1])[0]?.[0];
    if (host === undefined) { orphan += list.length; continue; }
    for (const w of list) {
      const [q, d2] = nearest(w, host);
      if (q >= 0 && d2 < 0.3 * 0.3) { wJ[w*2] = wJ[q*2]; wW[w*2] = wW[q*2]; wJ[w*2+1] = wJ[q*2+1]; wW[w*2+1] = wW[q*2+1]; stripOf[w] = -2; copied++; } else orphan++;
    }
  }
  console.log(`loose pieces: ${copied} verts follow a host strip, ${orphan} left on the original rig`);
}

// ── write skin ──
const buffer = root.listBuffers()[0];
const nOld = joints.length;
newJoints.forEach((j) => skin.addJoint(j.node));
const oldIBM = skin.getInverseBindMatrices().getArray();
const ibm = new Float32Array((nOld + newJoints.length) * 16); ibm.set(oldIBM);
newJoints.forEach((j, i) => { const o = (nOld + i) * 16; ibm.set([1,0,0,0, 0,1,0,0, 0,0,1,0, -j.pos[0], -j.pos[1], -j.pos[2], 1], o); });
skin.setInverseBindMatrices(doc.createAccessor('ibm').setType('MAT4').setArray(ibm).setBuffer(buffer));
const nJ = new Uint16Array(nV * 4), nWt = new Float32Array(nV * 4);
let replaced = 0;
for (let v = 0; v < nV; v++) {
  const w = weld[v];
  if (wJ[w*2] >= 0 && stripOf[w] !== -1) {
    nJ[v*4] = nOld + wJ[w*2]; nWt[v*4] = wW[w*2]; nJ[v*4+1] = nOld + wJ[w*2+1]; nWt[v*4+1] = wW[w*2+1]; replaced++;
  } else for (let k = 0; k < 4; k++) { nJ[v*4+k] = J[v*4+k]; nWt[v*4+k] = Wt[v*4+k]; }
}
// BLEND=1 (off by default): where two pieces touch (same position), give the shared vertices the blended weights of all the
// vertices at that position. It closes cracks, but it makes the neighbours of the shared vertices stretch (measured: 12k edges
// stretched more than 4x vs 270 without it), so it is off.
{
  const groups = new Map();
  for (let v = 0; v < nV; v++) {
    const k = `${Math.round(pos[v*3] * 1e5)},${Math.round(pos[v*3+1] * 1e5)},${Math.round(pos[v*3+2] * 1e5)}`;
    let g = groups.get(k); if (!g) groups.set(k, g = []); g.push(v);
  }
  let blended = 0;
  for (const g of groups.values()) {
    if (!process.env.BLEND || g.length < 2 || !g.some((v) => stripOf[weld[v]] !== -1 && wJ[weld[v]*2] >= 0)) continue;
    const acc = new Map();
    for (const v of g) for (let k = 0; k < 4; k++) { const wt = nWt[v*4+k]; if (wt > 0) acc.set(nJ[v*4+k], (acc.get(nJ[v*4+k]) ?? 0) + wt / g.length); }
    const top = [...acc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4), sum = top.reduce((s2, e) => s2 + e[1], 0);
    for (const v of g) for (let k = 0; k < 4; k++) { nJ[v*4+k] = top[k]?.[0] ?? 0; nWt[v*4+k] = top[k] ? top[k][1] / sum : 0; }
    blended += g.length;
  }
  console.log(`blended ${blended} vertices at contact positions`);
}
prim.setAttribute('JOINTS_0', doc.createAccessor('joints').setType('VEC4').setArray(nJ).setBuffer(buffer));
prim.setAttribute('WEIGHTS_0', doc.createAccessor('weights').setType('VEC4').setArray(nWt).setBuffer(buffer));
await io.write(output, doc);
console.log(`re-skinned ${replaced} of ${nV} vertices to ${newJoints.length} new joints (${strips.length} strips); wrote ${output}`);
console.log(stripInfo.map((s) => `#${s.si} v${s.verts} K${s.K} L${s.length} <- ${s.parent}`).join('\n'));

// CPU linear-blend skinning of the rigged GLB at a given clip/time -> PNG previews (front/side/top).
// usage: node verify.mjs <rigged.glb> <outPrefix> <clip|rest> <phi 0..1> [weights]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import fs from 'fs';
import { render } from './render.mjs';

const [,, input, prefix, clipName = 'rest', phiArg = '0', mode = 'depth'] = process.argv;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(input);
const root = doc.getRoot();
const mesh = root.listMeshes()[0], prim = mesh.listPrimitives()[0];
const skin = root.listSkins()[0];
const joints = skin.listJoints();
const dense = (acc, n) => { const o = new Float32Array(acc.getCount() * n), t = new Array(n); for (let i = 0; i < acc.getCount(); i++) { acc.getElement(i, t); for (let k = 0; k < n; k++) o[i*n+k] = t[k]; } return o; };
const pos = dense(prim.getAttribute('POSITION'), 3);
const J0 = dense(prim.getAttribute('JOINTS_0'), 4), W0 = dense(prim.getAttribute('WEIGHTS_0'), 4);
const ibm = skin.getInverseBindMatrices().getArray();
const nV = pos.length / 3;

// ---- mat4 helpers (column-major) ----
const mul = (a, b) => { const o = new Float64Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k*4+r] * b[c*4+k]; o[c*4+r] = s; } return o; };
const fromTRS = (t, q, s = [1,1,1]) => { const [x,y,z,w] = q; const o = new Float64Array(16);
  o[0] = (1-2*(y*y+z*z))*s[0]; o[1] = 2*(x*y+z*w)*s[0]; o[2] = 2*(x*z-y*w)*s[0];
  o[4] = 2*(x*y-z*w)*s[1]; o[5] = (1-2*(x*x+z*z))*s[1]; o[6] = 2*(y*z+x*w)*s[1];
  o[8] = 2*(x*z+y*w)*s[2]; o[9] = 2*(y*z-x*w)*s[2]; o[10] = (1-2*(x*x+y*y))*s[2];
  o[12] = t[0]; o[13] = t[1]; o[14] = t[2]; o[15] = 1; return o; };
const slerp = (a, b, t) => { let d = a[0]*b[0]+a[1]*b[1]+a[2]*b[2]+a[3]*b[3]; let bb = b;
  if (d < 0) { d = -d; bb = b.map((v) => -v); }
  if (d > 0.9995) { const r = a.map((v, i) => v + (bb[i]-v)*t); const l = Math.hypot(...r); return r.map((v) => v/l); }
  const th = Math.acos(d), s = Math.sin(th), wa = Math.sin((1-t)*th)/s, wb = Math.sin(t*th)/s;
  return a.map((v, i) => v*wa + bb[i]*wb); };

// ---- local TRS (rest, then animation override) ----
const local = new Map(joints.map((n) => [n, { t: [...n.getTranslation()], q: [...n.getRotation()] }]));
if (clipName !== 'rest') {
  const anim = root.listAnimations().find((a) => a.getName() === clipName);
  if (!anim) throw new Error('no clip ' + clipName);
  for (const ch of anim.listChannels()) {
    const s = ch.getSampler(), times = s.getInput().getArray(), out = s.getOutput().getArray();
    const T = times[times.length-1] * parseFloat(phiArg);
    let i = 0; while (i < times.length - 2 && times[i+1] <= T) i++;
    const u = Math.min(1, Math.max(0, (T - times[i]) / (times[i+1] - times[i])));
    const n = ch.getTargetNode(); const L = local.get(n); if (!L) continue;
    if (ch.getTargetPath() === 'rotation') {
      const a = [0,1,2,3].map((k) => out[i*4+k]), b = [0,1,2,3].map((k) => out[(i+1)*4+k]);
      L.q = slerp(a, b, u);
    } else if (ch.getTargetPath() === 'translation') {
      L.t = [0,1,2].map((k) => out[i*3+k] + (out[(i+1)*3+k] - out[i*3+k]) * u);
    }
  }
}
// world matrices
const world = new Map();
const worldOf = (n) => {
  if (world.has(n)) return world.get(n);
  const L = local.get(n) ?? { t: n.getTranslation(), q: n.getRotation() };
  let m = fromTRS(L.t, L.q);
  const p = n.getParentNode?.() ?? null;
  if (p && local.has(p)) m = mul(worldOf(p), m);
  world.set(n, m); return m;
};
const skinM = joints.map((n, i) => mul(worldOf(n), ibm.subarray(i*16, i*16+16)));

// ---- LBS ----
const out = new Float32Array(nV * 3);
for (let v = 0; v < nV; v++) {
  const x = pos[v*3], y = pos[v*3+1], z = pos[v*3+2];
  let ox = 0, oy = 0, oz = 0;
  for (let k = 0; k < 4; k++) {
    const w = W0[v*4+k]; if (!w) continue; const m = skinM[J0[v*4+k]];
    ox += w * (m[0]*x + m[4]*y + m[8]*z + m[12]);
    oy += w * (m[1]*x + m[5]*y + m[9]*z + m[13]);
    oz += w * (m[2]*x + m[6]*y + m[10]*z + m[14]);
  }
  out[v*3] = ox; out[v*3+1] = oy; out[v*3+2] = oz;
}

// colour by dominant bone group (weights check) or depth tint
let rgb = null;
if (mode === 'weights') {
  const pal = { Root:[220,40,40], Spine:[220,90,40], Neck:[240,160,0], Head:[230,0,200], Beak:[255,0,120], Crest:[160,0,160],
    Wing_L:[0,150,0], Wing_R:[0,190,190], Tail_A:[20,20,20], Tail_B:[130,0,220], Tail_C:[0,100,255], Ribbon_L:[180,150,0], Ribbon_R:[0,160,160] };
  const col = joints.map((n) => { const nm = n.getName(); for (const k of Object.keys(pal)) if (nm.startsWith(k)) return pal[k]; return [128,128,128]; });
  rgb = new Uint8Array(nV * 3);
  for (let v = 0; v < nV; v++) { const c = col[J0[v*4]]; rgb[v*3] = c[0]; rgb[v*3+1] = c[1]; rgb[v*3+2] = c[2]; }
}
// shared framing so animated frames are comparable: use fixed crop
const crop = process.env.CROP ? process.env.CROP.split(',').map(Number) : null;
for (const view of ['front', 'side']) render(out, `${prefix}-${view}.png`, view, { rgb, step: 2, crop: crop ?? [-0.45, 0.45, -0.55, 0.55] });
if (process.env.DUMP) fs.writeFileSync(process.env.DUMP, Buffer.from(out.buffer));
console.log('ok', clipName, phiArg);

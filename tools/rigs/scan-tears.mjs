// Finds the triangles that stretch too much in any pose of a rig and writes them as a CUT LIST for the rig builder.
//   node rigs/scan-tears.mjs <rig.glb> <ctrl module under site/> <cuts.json> [--ratio 4] [--minlen 0.04] [--phases 24]
//        [--stress '[{"open":1.2,"flap":0.45},...]']
// The mesh is skinned on the CPU in a headless Chrome (the same code as the site: three.js + the controller), once in the
// sculpted pose and then in every pose to test. A triangle is cut when one of its edges is longer than `minlen` AND more than
// `ratio` times its rest length in any of them. The builder (rigs/<name>.mjs) removes the listed triangles (indices of the
// PREPPED mesh, so the list stays valid as long as prep-model.mjs is run with the same arguments).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '../..');
const args = process.argv.slice(2);
const [rigGlb, ctrl, outJson] = args;
const opt = {}; for (let i = 3; i < args.length; i += 2) opt[args[i].replace(/^--/, '')] = args[i + 1];
const RATIO = +(opt.ratio ?? 4), MINLEN = +(opt.minlen ?? 0.04), PHASES = +(opt.phases ?? 24);
const STRESS = opt.stress ? JSON.parse(opt.stress) : [
  { open: 1.25, flap: 0.45 }, { open: 1.25, flap: -0.45 }, { open: 0.5, flap: 0.4 }, { open: 0.5, flap: -0.4 },
  { open: 1.0, sweep: 0.6 }, { open: 0.9, flap: 0.3, lookYaw: 0.9 }, { open: 0.75, legTuck: 1 },
];

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary', '.json': 'application/json' };
const srv = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  const p = u.startsWith('/repo/') ? path.join(REPO, u.slice(6)) : null;
  if (!p || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] ?? 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
}).listen(0);
await new Promise((r) => srv.on('listening', r));

const chromeCandidates = [process.env.CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].filter(Boolean);
const executablePath = chromeCandidates.find((c) => fs.existsSync(c));
const pw = await import(pathToFileURL(path.join(here, '../node_modules/playwright-core/index.mjs')).href);
const { chromium } = pw.default ?? pw;
const browser = await chromium.launch({ executablePath, headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await (await browser.newContext({ viewport: { width: 320, height: 240 } })).newPage();
page.on('pageerror', (e) => console.log('pageerror', String(e).slice(0, 300)));
const rel = (p) => '/repo/' + path.relative(REPO, path.resolve(p)).replace(/\\/g, '/');
const q = new URLSearchParams({ f: rel(rigGlb), ctrl: '/repo/' + ctrl.replace(/^\/+/, ''), v: 'side', ortho: '1' });
await page.goto(`http://localhost:${srv.address().port}/repo/tools/rigs/lib/viewer.html?${q}`, { waitUntil: 'commit' });
await page.waitForFunction('window.__done', null, { timeout: 180000 });

const result = await page.evaluate(([PH, RATIO, MINLEN, STRESS]) => {
  const { ctrl, gltf } = window.__rig;
  let mesh = null; gltf.scene.traverse((o) => { if (o.isSkinnedMesh) mesh = o; });
  const g = mesh.geometry, n = g.attributes.position.count, idx = g.index.array, nTri = idx.length / 3;
  const v = new (mesh.position.constructor)();
  const skin = () => { const out = new Float32Array(n * 3); for (let i = 0; i < n; i++) { mesh.getVertexPosition(i, v); out[i*3] = v.x; out[i*3+1] = v.y; out[i*3+2] = v.z; } return out; };
  const bad = new Uint8Array(nTri), worst = new Float32Array(nTri);
  const poses = [];
  ctrl.rest(); gltf.scene.updateMatrixWorld(true); mesh.skeleton.update();
  const rest = skin();
  const test = (label) => {
    gltf.scene.updateMatrixWorld(true); mesh.skeleton.update();
    const pos = skin(); let c = 0;
    for (let t = 0; t < nTri; t++) {
      for (let k = 0; k < 3; k++) {
        const a = idx[t*3 + k], b = idx[t*3 + (k + 1) % 3];
        const l1 = Math.hypot(pos[a*3] - pos[b*3], pos[a*3+1] - pos[b*3+1], pos[a*3+2] - pos[b*3+2]);
        if (l1 < MINLEN) continue;
        const l0 = Math.max(0.004, Math.hypot(rest[a*3] - rest[b*3], rest[a*3+1] - rest[b*3+1], rest[a*3+2] - rest[b*3+2]));
        const r = l1 / l0;
        if (r > RATIO) { if (!bad[t]) c++; bad[t] = 1; if (r > worst[t]) worst[t] = r; }
      }
    }
    poses.push(`${label}: +${c}`);
  };
  for (let p = 0; p < PH; p++) { ctrl.beat(20 + p / PH); test('beat ' + (p / PH).toFixed(2)); }
  for (const s of STRESS) { ctrl.stress(s); test('stress ' + JSON.stringify(s)); }
  const list = []; for (let t = 0; t < nTri; t++) if (bad[t]) list.push(t);
  return { nTri, list, poses };
}, [PHASES, RATIO, MINLEN, STRESS]);

await browser.close(); srv.close();
fs.mkdirSync(path.dirname(outJson), { recursive: true });
fs.writeFileSync(outJson, JSON.stringify({ rig: path.basename(rigGlb), ratio: RATIO, minlen: MINLEN, triangles: result.nTri, cut: result.list }));
console.log(`triangles ${result.nTri}, cut ${result.list.length} (${(100 * result.list.length / result.nTri).toFixed(3)} %)  ratio>${RATIO}, edge>${MINLEN}`);
console.log(result.poses.join('\n'));
console.log('wrote', outJson);

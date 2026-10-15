// Static server for the Meshy rig test viewer.   node tools/meshy-test/serve.mjs [port=5180]
//   http://localhost:5180/                  the viewer (animated GLB from model/meshy-test/Meshy_flap.glb)
//   http://localhost:5180/?f=/model/x.glb   any other GLB under model/meshy-test/
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '../..');
const PORT = +(process.argv[2] ?? 5180);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary', '.json': 'application/json', '.wasm': 'application/wasm' };
const ROUTES = [
  ['/three/', path.join(REPO, 'site/node_modules/three/')],
  ['/model/', path.join(REPO, 'model/meshy-test/')],
];
http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  let p = null;
  if (u === '/' || u === '/index.html') p = path.join(here, 'index.html');
  for (const [prefix, dir] of ROUTES) if (u.startsWith(prefix)) { const f = path.resolve(dir, u.slice(prefix.length)); if (f.startsWith(dir)) p = f; }
  if (!p || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] ?? 'application/octet-stream', 'content-length': fs.statSync(p).size });
  fs.createReadStream(p).pipe(res);
}).listen(PORT, () => console.log(`Meshy viewer: http://localhost:${PORT}/`));

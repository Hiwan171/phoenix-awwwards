import http from 'http'; import fs from 'fs'; import path from 'path';
const repo = path.resolve(import.meta.dirname, '../..');      // phoenix-awwwards/
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.png': 'image/png' };
export function serve(port = 0, modelPath = path.join(repo, 'model/model.glb')) {
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    let p;
    if (u === '/' || u === '/viewer.html') p = path.join(import.meta.dirname, 'viewer.html');
    else if (u.startsWith('/three/')) p = path.join(repo, 'site/node_modules/three', u.slice(7));
    else if (u === '/model.glb') p = modelPath;
    else { res.writeHead(404); return res.end(); }
    if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': MIME[path.extname(p)] ?? 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  }).listen(port);
  return new Promise((r) => srv.on('listening', () => r({ srv, port: srv.address().port })));
}

// usage: node qa.mjs outPrefix W H p1 p2 p3 ...   (serves ./dist, freezes the timeline at each p)
import { chromium } from 'playwright-core';
import http from 'http'; import fs from 'fs'; import path from 'path';
const ROOT = path.resolve('../site/dist');
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.glb':'model/gltf-binary', '.woff2':'font/woff2', '.woff':'font/woff', '.svg':'image/svg+xml' };
const srv = http.createServer((req, res) => {
  let p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0])); if (p.endsWith(path.sep) || !path.extname(p)) p = path.join(ROOT, 'index.html');
  if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] ?? 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
}).listen(0);
await new Promise((r) => srv.on('listening', r));
const port = srv.address().port;
const [,, out, W = '1280', H = '720', ...ps] = process.argv;
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const logs = [];
for (const p of ps) {
  const page = await browser.newPage({ viewport: { width: +W, height: +H } });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`.slice(0, 500)); });
  page.on('pageerror', (e) => logs.push('[pageerror] ' + String(e).slice(0, 500)));
  await page.goto(`http://localhost:${port}/${process.env.PAGE ?? ""}?p=${p}${process.env.EXTRA ?? ''}`, { waitUntil: 'load' });
  try { await page.waitForFunction('window.__phoenix?.ready === true || window.__sky?.ready === true', null, { timeout: 150000 }); } catch { logs.push('[timeout] not ready at p=' + p); }
  await page.waitForTimeout(+(process.env.WAIT ?? 2500));
  await page.screenshot({ path: `${out}-${p}.png`, timeout: 180000 });
  await page.close();
}
console.log([...new Set(logs)].filter((l) => !/GPU stall|swiftshader|Automatic fallback|ReadPixels/i.test(l)).join('\n') || 'no console errors');
await browser.close(); srv.close();

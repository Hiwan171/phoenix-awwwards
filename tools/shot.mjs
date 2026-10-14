// usage: node shot.mjs "<query>" out.png [waitMs] [w] [h]
import { chromium } from 'playwright-core';
import http from 'http'; import fs from 'fs'; import path from 'path';
const ROOT = path.resolve('..');
const MIME = { '.html':'text/html', '.glb':'model/gltf-binary', '.js':'text/javascript', '.mjs':'text/javascript' };
const srv = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] ?? 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
}).listen(0);
await new Promise((r) => srv.on('listening', r));
const port = srv.address().port;
const [,, query = '', out = 'shot.png', wait = '6000', W = '1280', H = '800'] = process.argv;
const exe = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({ executablePath: exe, headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: +W, height: +H } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`.slice(0, 600)));
page.on('pageerror', (e) => logs.push('[pageerror] ' + String(e).slice(0, 600)));
await page.goto(`http://localhost:${port}/fire-test.html?${query}`, { waitUntil: 'load' });
try { await page.waitForFunction('window.__ready === true', null, { timeout: 120000 }); } catch { logs.push('[timeout] __ready never set'); }
await page.waitForTimeout(+wait);
await page.screenshot({ path: out, timeout: 180000 });
console.log(logs.filter((l) => !/GPU stall|swiftshader|Automatic fallback/i.test(l)).join('\n') || 'no console errors');
console.log('err box:', JSON.stringify(await page.$eval('#err', (e) => e.textContent)));
await browser.close(); srv.close();

// real (non-frozen) run: loader -> title -> wheel scroll. usage: node live.mjs outPrefix W H [mobile]
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
const [,, out, W = '1280', H = '720', mobile = ''] = process.argv;
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const ctx = await browser.newContext({ viewport: { width: +W, height: +H }, isMobile: !!mobile, hasTouch: !!mobile, deviceScaleFactor: mobile ? 2 : 1 });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text()}`.slice(0, 400)); });
page.on('pageerror', (e) => logs.push('[pageerror] ' + String(e).slice(0, 400)));
await page.goto(`http://localhost:${srv.address().port}/`, { waitUntil: 'commit' });
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}-1-loader.png`, timeout: 120000 });
try { await page.waitForFunction('window.__phoenix?.ready === true', null, { timeout: 120000 }); } catch { logs.push('[timeout] ready'); }
await page.waitForTimeout(6500);
await page.screenshot({ path: `${out}-2-title.png`, timeout: 120000 });
const pageH = await page.evaluate(() => document.documentElement.scrollHeight);
console.log('scrollHeight', pageH);
// scroll with the wheel (desktop) or touch-like scrollBy (mobile)
const steps = 8;
for (let i = 0; i < steps; i++) {
  if (mobile) await page.evaluate((y) => window.scrollBy(0, y), 260); else await page.mouse.wheel(0, 260);
  await page.waitForTimeout(450);
}
await page.waitForTimeout(2500);
console.log('intro-locked?', await page.evaluate(() => document.documentElement.classList.contains('is-intro')), 'S', JSON.stringify(await page.evaluate(() => { const s = window.__phoenix.S; return { form: +s.form.toFixed(2), reveal: +s.reveal.toFixed(2), ignite: +s.ignite.toFixed(2), dolly: +s.dolly.toFixed(2) }; })));
await page.screenshot({ path: `${out}-3-scrolled.png`, timeout: 120000 });
console.log([...new Set(logs)].filter((l) => !/GPU stall|swiftshader|Automatic fallback|ReadPixels/i.test(l)).join('\n') || 'no console errors');
await browser.close(); srv.close();

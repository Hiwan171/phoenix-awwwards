import { chromium } from 'playwright-core';
import { PNG } from 'pngjs';
import fs from 'fs';
import { serve } from './serve.mjs';
// Inspection renders of a GLB (clay or colour) -> contact sheet, 3 tiles per row. Needs tools/node_modules (npm install).
// usage: node shots.mjs out.png modelPath VIEW...        (env BONES=skeleton.json overlays bones, WEIGHTS=1 colours skin weights)
//   VIEW = "az,el,clay,dist[,tx,ty]"            orbit view (az 180 = the bird's front)
//        | "o:front|side,cx,cy,half"              orthographic with a 0.1 grid (use to read coordinates)
//        | "p:Clip,t,az,el,clay,dist,tx,ty"       a clip frozen at time t (needs a rigged GLB)
// Edge path below is the Windows default; change `executablePath` for Chrome/Chromium elsewhere.
const [,, out, modelPath, ...views] = process.argv;
const { srv, port } = await serve(0, modelPath);
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true,
  args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 640, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));
await page.goto(`http://localhost:${port}/`);
await page.waitForFunction('window.READY === true', null, { timeout: 240000 });
console.log('bbox', JSON.stringify(await page.evaluate(() => window.INFO)), 'clips', JSON.stringify(await page.evaluate(() => window.CLIPS)));
if (process.env.BONES) await page.evaluate((j) => window.setBones(j), JSON.parse(fs.readFileSync(process.env.BONES, 'utf8')));
if (process.env.WEIGHTS) await page.evaluate(() => window.weightMode(true));
if (process.env.MARKS) await page.evaluate((m) => window.marks(m), JSON.parse(process.env.MARKS));
const tiles = [];
for (const v of views) {
  if (v.startsWith('p:')) {            // p:Clip,t,az,el,clay,dist,tx,ty
    const a = v.slice(2).split(',');
    await page.evaluate(([c, t, az, el, clay, dist, tx, ty]) => { window.pose(c, t); window.view(az, el, clay, dist, tx, ty); },
      [a[0], +a[1], +(a[2] ?? 180), +(a[3] ?? 6), (a[4] ?? '1') === '1', +(a[5] ?? 5.2), +(a[6] ?? 0), +(a[7] ?? 0)]);
  } else if (v.startsWith('o:')) {            // o:front|side,cx,cy,half
    const [kind, cx = 0, cy = 0, half = 1.15] = v.slice(2).split(',').map((x, i) => (i === 0 ? x : +x));
    await page.evaluate(([k, cx, cy, h]) => window.ortho(k, cx, cy, h), [kind, cx, cy, half]);
  } else {
    const [az, el, clay, dist, tx, ty] = v.split(',').map((x, i) => (i === 2 ? x === '1' : +x));
    await page.evaluate(([az, el, clay, dist, tx, ty]) => window.view(az, el, clay, dist ?? 5.2, tx ?? 0, ty ?? 0), [az, el, clay, dist, tx, ty]);
  }
  tiles.push(PNG.sync.read(await page.screenshot()));
}
await browser.close(); srv.close();
const cols = Math.min(3, tiles.length), rows = Math.ceil(tiles.length / cols);
const sheet = new PNG({ width: 640 * cols, height: 720 * rows });
tiles.forEach((t, k) => PNG.bitblt(t, sheet, 0, 0, 640, 720, (k % cols) * 640, Math.floor(k / cols) * 720));
fs.writeFileSync(out, PNG.sync.write(sheet));
console.log('wrote', out);

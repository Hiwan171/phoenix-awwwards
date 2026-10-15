import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';
// usage: node pick.mjs model.glb "az,el,dist,tx,ty:px,py" ...   -> prints the 3D point under each pixel (tile is 640x720)
const [,, modelPath, ...jobs] = process.argv;
const { srv, port } = await serve(0, modelPath);
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true,
  args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 640, height: 720 } });
await page.goto(`http://localhost:${port}/`);
await page.waitForFunction('window.READY === true', null, { timeout: 240000 });
for (const j of jobs) {
  const [view, px] = j.split(':'); const [az, el, dist, tx, ty] = view.split(',').map(Number); const pts = px.split(';').map((s) => s.split(',').map(Number));
  await page.evaluate(([az, el, dist, tx, ty]) => window.view(az, el, true, dist, tx, ty), [az, el, dist, tx, ty]);
  for (const [x, y] of pts) console.log(`${view} pixel (${x},${y}) ->`, JSON.stringify((await page.evaluate(([x, y]) => window.pick(x, y), [x, y]))?.map((v) => +v.toFixed(3))));
}
await browser.close(); srv.close();

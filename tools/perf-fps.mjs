// REAL frame rate of the page: vsync on (default flags), presented rAF frames over a long window, after the page settles.
// usage: node perf-fps.mjs [url=http://localhost:5173/?qa=1] [W=1920] [H=1080] [seconds=6]
//   env: CHROME=<path>   DSF=<deviceScaleFactor>   RUNS=<repeats, default 3: the median is the number to quote>
//        CSS=<css injected after load, to A/B page layers, e.g. ".grain{display:none}">
// Do NOT use a free-running rAF (--disable-gpu-vsync): in headless it comes in bursts and over-reports the fps ~2.5x.
// ?qa=1 pins the quality governor to tier 0; add &gov=1 to let it work, or &q=N to pin another tier.
import { chromium } from 'playwright-core';

const [, , URL = 'http://localhost:5173/?qa=1', W = '1920', H = '1080', SECS = '6'] = process.argv;
const RUNS = +(process.env.RUNS ?? 3);
const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const out = [];
for (let i = 0; i < RUNS; i++) {
  const ctx = await browser.newContext({ viewport: { width: +W, height: +H }, deviceScaleFactor: +(process.env.DSF ?? 1) });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'commit' });
  await page.waitForFunction('window.__phoenix?.ready === true', null, { timeout: 180000 });
  if (process.env.CSS) await page.addStyleTag({ content: process.env.CSS });
  await page.waitForTimeout(3500);
  const r = await page.evaluate((secs) => new Promise((res) => {
    const t = []; let last = performance.now(); const t0 = last, end = last + secs * 1000;
    const step = (n) => { t.push(n - last); last = n; n < end ? requestAnimationFrame(step) : res({ t, dur: n - t0 }); };
    requestAnimationFrame(step);
  }), +SECS);
  await ctx.close();
  const t = r.t.slice(2).sort((a, b) => a - b), q = (p) => t[Math.min(t.length - 1, Math.floor(t.length * p))];
  out.push({ fps: r.t.length / (r.dur / 1000), p50: q(0.5), p95: q(0.95), p99: q(0.99) });
  console.log(`run ${i + 1}: ${out[i].fps.toFixed(1)} fps   frame ms p50 ${out[i].p50.toFixed(1)}  p95 ${out[i].p95.toFixed(1)}  p99 ${out[i].p99.toFixed(1)}`);
}
const med = (k) => [...out].map((o) => o[k]).sort((a, b) => a - b)[out.length >> 1];
console.log(`median: ${med('fps').toFixed(1)} fps   (p95 frame ${med('p95').toFixed(1)} ms)`);
await browser.close();

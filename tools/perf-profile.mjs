// GPU time per render pass of the live hero (EXT_disjoint_timer_query_webgl2 around every renderer.render() of one frame).
// usage: node perf-profile.mjs [url=http://localhost:5173/?qa=1] [W=1920] [H=1080] [frames=40]
//   env: CHROME=<path to chrome.exe>   DSF=<deviceScaleFactor, e.g. 0.65 to see the resolution-independent cost>
// Needs the dev server running. Read the table as "ms of GPU work per pass"; the total is the sum of the passes (the real
// frame is ~1.2-1.5x that: driver + presentation). Compare runs INTERLEAVED: other GPU users (an IDE!) move times up to ~2x.
import { chromium } from 'playwright-core';

const [, , URL = 'http://localhost:5173/?qa=1', W = '1920', H = '1080', FRAMES = '40'] = process.argv;
const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await (await browser.newContext({ viewport: { width: +W, height: +H }, deviceScaleFactor: +(process.env.DSF ?? 1) })).newPage();
await page.goto(URL, { waitUntil: 'commit' });
await page.waitForFunction('window.__phoenix?.ready === true', null, { timeout: 150000 });

const res = await page.evaluate(async (FRAMES) => {
  const { stage, S } = window.__phoenix;
  const r = stage.renderer, gl = r.getContext();
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  if (!ext) throw new Error('EXT_disjoint_timer_query_webgl2 is not available in this browser');
  const orig = r.render.bind(r);
  let cur = [];
  const describe = (scene, rt) => {
    const what = scene.isScene
      ? `scene(${scene.overrideMaterial ? 'override ' + scene.overrideMaterial.constructor.name : 'main'})`
      : `quad ${scene.material.constructor.name}[${Object.keys(scene.material.uniforms ?? {}).filter((k) => !/^(uTime|iTime)/.test(k)).slice(0, 3).join(',')}]`;
    return `${what} -> ${rt ? rt.width + 'x' + rt.height : 'canvas ' + r.domElement.width + 'x' + r.domElement.height}`;
  };
  r.render = function (scene, camera) {
    const rt = r.getRenderTarget();
    const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    orig(scene, camera);
    gl.endQuery(ext.TIME_ELAPSED_EXT);
    cur.push({ q, label: describe(scene, rt) });
  };
  const px = new Uint8Array(4), ptr = { x: 0, y: 0 }, frames = [];
  const frame = () => { cur = []; stage.frame(1 / 60, S, ptr); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
  for (let i = 0; i < 12; i++) frame();                                  // warm-up
  for (let i = 0; i < FRAMES; i++) { frame(); frames.push(cur); }
  r.render = orig;
  await new Promise((rs) => setTimeout(rs, 200));
  const labels = frames[0].map((c) => c.label);
  const rows = labels.map((label, k) => {
    const v = frames.map((f) => (f[k] ? gl.getQueryParameter(f[k].q, gl.QUERY_RESULT) / 1e6 : NaN)).filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
    return { label, ms: v.length ? v[v.length >> 1] : NaN };
  });
  return { rows, stable: frames.every((f) => f.length === labels.length) };
}, +FRAMES);

let total = 0;
res.rows.forEach((x, i) => { total += x.ms; console.log(String(i).padStart(2), x.ms.toFixed(2).padStart(7), 'ms  ', x.label); });
console.log('   ', total.toFixed(2).padStart(7), 'ms   total of passes', res.stable ? '' : '(the number of passes varies between frames!)');
await browser.close();

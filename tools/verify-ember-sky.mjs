// Visual/runtime checks for the opening's celestial layer. Requires the Vite server.
// node tools/verify-ember-sky.mjs [http://localhost:5173]
import { chromium } from 'playwright-core';
import { PNG } from 'pngjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const origin = process.argv[2] ?? 'http://localhost:5173';
const out = fileURLToPath(new URL('./_out/sky-quality/', import.meta.url));
await fs.mkdir(out, { recursive: true });
const report = { failures: [], errors: [], models: [] };
const check = (ok, label, value) => { if (!ok) report.failures.push({ label, value }); };
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true, args: ['--use-angle=d3d11'] });

async function open(query, viewport = { width: 1440, height: 810 }, reducedMotion = 'no-preference') {
  const page = await browser.newPage({ viewport, reducedMotion });
  page.on('pageerror', (e) => report.errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') report.errors.push(m.text()); });
  page.on('requestfailed', (r) => report.errors.push(`${r.url()}: ${r.failure()?.errorText}`));
  page.on('response', (r) => { if (r.status() >= 400) report.errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(`${origin}/opening-lab.html?ui=0&msaa=0&${query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__op?.ready, null, { timeout: 120000 });
  await page.evaluate(() => { window.requestAnimationFrame = () => 0; });
  await page.waitForTimeout(100);
  return page;
}

function diff(a, b, region = null) {
  const first = PNG.sync.read(a), second = PNG.sync.read(b);
  const [x, y, width, height] = region ?? [0, 0, first.width, first.height];
  let changed = 0, max = 0;
  for (let py = y; py < y + height; py++) for (let px = x; px < x + width; px++) {
    const i = (py * first.width + px) * 4;
    const d = Math.max(...[0, 1, 2].map((k) => Math.abs(first.data[i + k] - second.data[i + k])));
    if (d > 3) changed++;
    max = Math.max(max, d);
  }
  return { changed, max, fraction: changed / (width * height) };
}

try {
  for (const variant of ['web', 'lite']) {
    const page = await open(`m=${variant}`);
    const states = await page.evaluate(() => {
      const op = window.__op;
      return [0, 3, 5, 7, 14, 26, 60, 123].map((time) => {
        op.setU(0, time);
        const d = op.skyEffects.diagnostics();
        return { ...d, bird: op.bird.position.toArray(), finite: op.skyEffects.group.children.every((o) =>
          [...o.position, ...o.quaternion, ...o.scale].every(Number.isFinite)) };
      });
    });
    check(states.every((s) => s.finite), `${variant}: finite celestial transforms`, states);
    check(states.find((s) => s.time === 5).comets.length > 0, `${variant}: first comet is alive`);
    check(states.find((s) => s.time === 3).comets[0].position.join() !== states.find((s) => s.time === 7).comets[0].position.join(), `${variant}: comets cross the sky while scroll rests`);
    check(states.every((s) => s.bird.every((v, i) => Math.abs(v - states[0].bird[i]) < 1e-8)), `${variant}: sky animation does not move the planted bird`);
    const rewind = await page.evaluate(() => {
      __op.setU(0, 5); const first = JSON.stringify(__op.skyEffects.diagnostics());
      __op.setU(1, 45); __op.setU(0, 5);
      return first === JSON.stringify(__op.skyEffects.diagnostics());
    });
    check(rewind, `${variant}: deterministic sky when time is revisited`);
    await page.evaluate(() => { __op.skyEffects.group.visible = false; __op.setU(0, 5); __op.render(5); });
    const baseline = await page.screenshot({ path: path.join(out, `${variant}-original-sky.png`) });
    await page.evaluate(() => { __op.skyEffects.group.visible = true; __op.render(5); });
    const enhanced = await page.screenshot({ path: path.join(out, `${variant}-living-sky.png`) });
    const addedLight = diff(baseline, enhanced);
    // A solid central plumage patch must occlude the sky; halos in the empty surrounding sky are allowed.
    const bodyOcclusion = diff(baseline, enhanced, [850, 430, 35, 50]);
    check(addedLight.changed > 300, `${variant}: celestial light reaches the rendered image`, addedLight);
    check(addedLight.fraction < 0.12, `${variant}: approved background palette remains intact`, addedLight);
    check(bodyOcclusion.max < 8, `${variant}: celestial effects stay behind opaque plumage`, bodyOcclusion);
    for (const [name, u, time] of [['early', 0, 3], ['late', 0, 7], ['flight', 0.48, 14], ['landing', 1, 26]]) {
      await page.evaluate(({ u, time }) => __op.setU(u, time), { u, time });
      await page.screenshot({ path: path.join(out, `${variant}-${name}.png`) });
    }
    const runtime = await page.evaluate(() => {
      const op = __op, start = performance.now();
      for (let i = 0; i < 3000; i++) op.skyEffects.update(i / 60, op.camera);
      return { cpuMsPerUpdate: (performance.now() - start) / 3000,
        contextLost: op.renderer.getContext().isContextLost() };
    });
    check(!runtime.contextLost, `${variant}: WebGL context remains live`);
    report.models.push({ variant, stars: states[0].stars, rewind, addedLight, bodyOcclusion, runtime });
    console.log(variant, JSON.stringify(report.models.at(-1)));
    await page.close();
  }
  const stars = await open('comets=0');
  await stars.evaluate(() => { __op.setU(0, 0); __op.render(0); });
  const dark = await stars.screenshot({ path: path.join(out, 'stars-time-0.png') });
  await stars.evaluate(() => __op.setU(0, 3));
  const bright = await stars.screenshot({ path: path.join(out, 'stars-time-3.png') });
  report.twinkle = diff(dark, bright, [0, 0, 600, 300]);
  check(report.twinkle.changed > 50, 'Stars visibly pulse independently across a fixed clear sky patch', report.twinkle);
  await stars.close();
  const mobile = await open('m=lite', { width: 390, height: 844 });
  await mobile.evaluate(() => __op.setU(0, 5));
  await mobile.screenshot({ path: path.join(out, 'mobile-sky.png') });
  check(await mobile.evaluate(() => !__op.renderer.getContext().isContextLost()), 'Celestial layer renders in a portrait viewport');
  await mobile.close();
  const reduced = await open('m=lite', { width: 800, height: 600 }, 'reduce');
  report.reducedMotion = await reduced.evaluate(() => { __op.setU(0, 26); return __op.skyEffects.diagnostics(); });
  check(report.reducedMotion.time === 0 && report.reducedMotion.comets.length === 0, 'Reduced motion keeps the celestial layer still', report.reducedMotion);
  await reduced.close();
} catch (error) { report.failures.push({ label: 'Verification did not complete', value: error.stack }); }
finally {
  await browser.close();
  check(report.errors.length === 0, 'No JavaScript, shader, or resource errors', report.errors);
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ failures: report.failures, twinkle: report.twinkle, report: path.join(out, 'report.json') }, null, 2));
process.exitCode = report.failures.length ? 1 : 0;

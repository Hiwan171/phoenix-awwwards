// Deterministic guard against cracks introduced by the opening-only back-feather wind patch.
// Vite must already be running on localhost:5173. Does not modify source or GLBs.
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--use-angle=d3d11'] });
try {
  for (const variant of ['web', 'lite']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text()); });
    await page.goto(`http://localhost:5173/opening-lab.html?ui=0&msaa=0&m=${variant}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__op?.ready === true);
    const result = await page.evaluate(async (variant) => {
      const op = window.__op, mesh = op.skinned, g = mesh.geometry, T = op.THREE, pos = g.attributes.position;
      const before = pos.array.slice(), skinBefore = g.attributes.skinWeight.array.slice();
      const { createFenixPlumage } = await import('/src/beasts/fenix-plumage.js');
      const plumage = await createFenixPlumage({ mesh, variant });
      op.setU(0.1, 0);
      plumage.update({ time: 0, wind: 1, direction: new T.Vector3(0.82, 0.08, -0.56) });
      op.post?.setMaskMaterial(plumage.createMaskMaterial()); op.render(0);
      let positionsChanged = 0, weightsChanged = 0, restDelta = 0;
      const a = new T.Vector3(), b = new T.Vector3(), p = new T.Vector3();
      for (let i = 0; i < before.length; i++) positionsChanged = Math.max(positionsChanged, Math.abs(before[i] - pos.array[i]));
      for (let i = 0; i < skinBefore.length; i++) weightsChanged = Math.max(weightsChanged, Math.abs(skinBefore[i] - g.attributes.skinWeight.array[i]));
      for (let i = 0; i < pos.count; i++) { p.fromBufferAttribute(pos, i); plumage.sample(i, a, { time: 7, wind: 0 }); restDelta = Math.max(restDelta, p.distanceTo(a)); }
      const attr = g.attributes.aPlumage, index = g.index.array, unique = new Set(), edges = [], used = new Set();
      for (let i = 0; i < index.length; i += 3) for (let k = 0; k < 3; k++) {
        let v = index[i + k], w = index[i + (k + 1) % 3];
        if (!attr.getY(v) && !attr.getY(w)) continue;
        if (v > w) [v, w] = [w, v];
        const key = v * pos.count + w; if (unique.has(key)) continue; unique.add(key);
        a.fromBufferAttribute(pos, v); b.fromBufferAttribute(pos, w); const length = a.distanceTo(b);
        if (length > 0.00001) { edges.push([v, w, length]); used.add(v); used.add(w); }
      }
      let maxStrain = 0, maxOffset = 0, worst = null;
      const coordinates = new Map();
      for (const direction of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
        plumage.uniforms.uPlumageAir.value.fromArray(direction);
        for (let time = 0; time <= 8; time += 0.5) {
          coordinates.clear();
          for (const i of used) {
            plumage.sample(i, a, { time, wind: 1 }); coordinates.set(i, a.clone()); p.fromBufferAttribute(pos, i);
            maxOffset = Math.max(maxOffset, p.distanceTo(a));
          }
          for (const [v, w, length] of edges) {
            const strain = Math.abs(coordinates.get(v).distanceTo(coordinates.get(w)) / length - 1);
            if (strain > maxStrain) { maxStrain = strain; worst = { v, w, length, time, direction, strain }; }
          }
        }
      }
      return { variant, ...plumage.diagnostics, positionsChanged, weightsChanged, restDelta, edges: edges.length, maxStrain, maxOffset, worst };
    }, variant);
    await page.waitForTimeout(200);
    console.log(JSON.stringify({ ...result, errors }));
    await page.close();
    if (errors.length || result.positionsChanged || result.weightsChanged || result.restDelta || result.maxStrain > 0.03) throw new Error(`Plumage verification failed: ${variant}`);
  }
} finally { await browser.close(); }

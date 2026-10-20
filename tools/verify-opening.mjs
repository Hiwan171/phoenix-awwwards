// Physical and visual checks for the red opening scene. Run against a stable Vite server:
// node tools/verify-opening.mjs [http://localhost:5173]
// EDGE=<executable> OUT=<directory> VARIANTS=web,lite SKIP_IMAGES=1
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const origin = process.argv[2] ?? 'http://localhost:5173';
const out = path.resolve(process.env.OUT ?? path.join(here, '_out/opening-quality'));
const variants = (process.env.VARIANTS ?? 'web,lite').split(',');
await mkdir(out, { recursive: true });
const report = { origin, browser: 'Edge / ANGLE D3D11', viewport: [1280, 720], models: [], failures: [] };
const browser = await chromium.launch({
  executablePath: process.env.EDGE ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const check = (ok, message, metrics) => {
  if (!ok) report.failures.push({ message, metrics });
};
const distance = (a, b) => Math.hypot(...a.map((x, i) => x - b[i]));
const maxArrayDelta = (a, b) => Math.max(0, ...a.map((x, i) => Math.abs(x - b[i])));

async function open(variant, wind, errors) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(180000);
  page.on('pageerror', (e) => errors.push(`page: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  page.on('response', (r) => {
    if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) errors.push(`resource: ${r.status()} ${r.url()}`);
  });
  page.on('requestfailed', (r) => errors.push(`request: ${r.failure()?.errorText} ${r.url()}`));
  const url = new URL('/opening-lab.html', origin);
  for (const [k, v] of Object.entries({ m: variant, ui: 0, msaa: 0, wind })) url.searchParams.set(k, v);
  await page.goto(url.href, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__op?.ready === true);
  const clockStart = await page.evaluate(() => ({ u: window.__op.u, t: window.__op.lifeT }));
  await page.waitForTimeout(300);
  const clockEnd = await page.evaluate(() => ({ u: window.__op.u, t: window.__op.lifeT }));
  page.openingLife = { progressDelta: clockEnd.u - clockStart.u, elapsed: clockEnd.t - clockStart.t };
  // Drain the one pending animation frame, then drive every frame explicitly. This also keeps detail cameras stable.
  await page.evaluate(() => { window.requestAnimationFrame = () => 0; });
  await page.waitForTimeout(100);
  await page.evaluate(() => {
    const op = window.__op, mesh = op.skinned, geometry = mesh.geometry;
    const gl = op.renderer.getContext(), debugRenderer = gl.getExtension('WEBGL_debug_renderer_info');
    const indices = geometry.getAttribute('skinIndex'), weights = geometry.getAttribute('skinWeight');
    const pos = geometry.getAttribute('position');
    const boneIndex = new Map(mesh.skeleton.bones.map((b, i) => [b.name, i]));
    // One genuinely deformed vertex per feather tip, rather than only checking the animation controls.
    const terminal = new Map();
    for (const b of mesh.skeleton.bones) {
      const m = /^F_(\w+?)_(\d+)_(\d+)$/.exec(b.name);
      if (!m) continue;
      const key = `${m[1]}_${m[2]}`;
      if (!terminal.has(key) || +m[3] > terminal.get(key).joint) terminal.set(key, { name: b.name, region: m[1], joint: +m[3] });
    }
    const tips = new Map([...terminal.values()].map((v) => [boneIndex.get(v.name), { ...v, index: -1, weight: 0 }]));
    let invalidWeights = 0, maxWeightError = 0, invalidIndices = 0;
    // Four independently rounded normalized integer components can accumulate up to two quantization steps.
    const weightQuantum = weights.normalized ? (weights.array.BYTES_PER_ELEMENT === 1 ? 1 / 255 : 1 / 65535) : 0;
    for (let i = 0; i < pos.count; i++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        const w = weights.getComponent(i, k), b = indices.getComponent(i, k);
        if (!Number.isFinite(w) || w < 0 || w > 1) invalidWeights++;
        if (!Number.isInteger(b) || b < 0 || b >= mesh.skeleton.bones.length) invalidIndices++;
        sum += w;
        const tip = tips.get(b);
        if (tip && w > tip.weight) { tip.weight = w; tip.index = i; }
      }
      maxWeightError = Math.max(maxWeightError, Math.abs(sum - 1));
    }
    const selected = [...tips.values()].filter((v) => v.index >= 0);
    const v = new op.THREE.Vector3();
    const worldVertex = (i) => mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld).toArray();
    const worldBone = (name) => mesh.skeleton.bones[boneIndex.get(name)]?.getWorldPosition(v).toArray();
    const toeRig = op.feet?.rig ?? op.feet;
    const toeVertices = (toeRig?.feet ?? []).map((foot, fi) => ({
      name: foot.name ?? foot.spec?.side ?? foot.ankle?.name ?? `foot${fi}`,
      toes: foot.toes.map((toe, ti) => ({ name: toe.name ?? `toe${ti}`, indices: toe.vertices.map((p) => p.index) })),
    }));
    window.__openingQA = {
      setup: { gpu: debugRenderer ? gl.getParameter(debugRenderer.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), vertices: pos.count, bones: mesh.skeleton.bones.length, invalidWeights, maxWeightError, weightQuantum, invalidIndices, featherVertices: selected.length, toeVertices: toeVertices.map((f) => f.toes.map((t) => t.indices.length)) },
      sample(u, t) {
        const state = op.setU(u, t);
        mesh.updateWorldMatrix(true, true); mesh.skeleton.update();
        const matrices = mesh.skeleton.bones.flatMap((b) => b.matrixWorld.toArray());
        const feathers = selected.map((tip) => ({ name: tip.name, region: tip.region, p: worldVertex(tip.index) }));
        const toes = toeVertices.map((foot) => ({ name: foot.name, toes: foot.toes.map((toe) => {
          const samples = toe.indices.map((i) => {
            const p = worldVertex(i); return { p, gap: p[1] - op.surfaceAt(p[0], p[2]) };
          });
          return { name: toe.name, minGap: Math.min(...samples.map((s) => s.gap)), samples };
        }) }));
        const diagnostic = typeof op.feet?.diagnostics === 'function' ? op.feet.diagnostics() : typeof toeRig?.diagnostics === 'function' ? toeRig.diagnostics() : null;
        return { u, t, actualU: op.u, actualT: op.lifeT, ground: state.k.ground, bird: op.bird.position.toArray(), birdQuaternion: op.bird.quaternion.toArray(), root: worldBone('Bone_000'), hip: worldBone('Bone_001'), feet: [worldBone('Bone_002'), worldBone('Bone_009')], matrices, finite: matrices.every(Number.isFinite) && feathers.every((f) => f.p.every(Number.isFinite)), feathers, toes, diagnostic };
      },
      closeup() {
        const centre = new op.THREE.Vector3();
        const points = toeVertices.flatMap((foot) => foot.toes.flatMap((toe) => toe.indices.slice(0, 2).map(worldVertex)));
        if (points.length) for (const p of points) centre.add(new op.THREE.Vector3(...p).multiplyScalar(1 / points.length));
        else for (const name of ['Bone_002', 'Bone_009']) centre.add(new op.THREE.Vector3(...worldBone(name)).multiplyScalar(0.5));
        const angle = op.camera.position.clone().sub(op.bird.position); angle.y = 0; angle.normalize();
        op.camera.position.copy(centre).addScaledVector(angle, 0.9).add(new op.THREE.Vector3(0, 0.32, 0));
        op.camera.fov = 30; op.camera.updateProjectionMatrix(); op.camera.lookAt(centre.clone().add(new op.THREE.Vector3(0, 0.07, 0)));
        op.camera.updateMatrixWorld(true);
        if (op.post) op.post.render(op.lifeT); else op.renderer.render(op.scene, op.camera);
      },
    };
  });
  return page;
}

try {
  for (const variant of variants) {
    const errors = [], page = await open(variant, 1, errors);
    const result = { variant, setup: await page.evaluate(() => window.__openingQA.setup), naturalIdleClock: page.openingLife, errors };
    report.models.push(result);
    console.log(`[${variant}] ${result.setup.vertices} vertices, ${result.setup.bones} bones, ${result.setup.featherVertices} feather tips`);
    check(Math.abs(result.naturalIdleClock.progressDelta) < 0.00001 && result.naturalIdleClock.elapsed > 0.05, `${variant}: live idle clock advances while scroll is stopped`, result.naturalIdleClock);
    check(result.setup.invalidWeights === 0 && result.setup.maxWeightError <= 2 * result.setup.weightQuantum + 0.000001, `${variant}: skin weights normalized within component precision`, result.setup);
    check(result.setup.invalidIndices === 0, `${variant}: valid joint indices`, result.setup);
    check(result.setup.toeVertices.length === 2 && result.setup.toeVertices.every((f) => f.length >= 3), `${variant}: independent toe geometry on both feet`, result.setup.toeVertices);
    const idleTimes = [0, 1.3, 2.6, 4, 6.1, 8];
    result.perches = [];
    for (const u of [0, 1]) {
      const samples = await page.evaluate(({ u, times }) => times.map((t) => window.__openingQA.sample(u, t)), { u, times: idleTimes });
      const first = samples[0], metrics = {
        u,
        maxRootDrift: Math.max(...samples.map((s) => distance(s.root, first.root))),
        maxHipDrift: Math.max(...samples.map((s) => distance(s.hip, first.hip))),
        maxBirdDrift: Math.max(...samples.map((s) => distance(s.bird, first.bird))),
        maxFootDrift: Math.max(...samples.flatMap((s) => s.feet.map((p, i) => distance(p, first.feet[i])))),
        maxToeVertexDrift: Math.max(0, ...samples.flatMap((s) => s.toes.flatMap((foot, fi) => foot.toes.flatMap((toe, ti) => toe.samples.map((v, vi) => distance(v.p, first.toes[fi].toes[ti].samples[vi].p)))))),
        feet: first.toes.map((f) => ({ name: f.name, toeMinGaps: f.toes.map((t) => t.minGap) })),
        diagnostics: samples.map((s) => ({ t: s.t, value: s.diagnostic })),
      };
      result.perches.push(metrics);
      check(samples.every((s) => s.finite), `${variant} u=${u}: finite world pose`);
      check(metrics.maxRootDrift < 0.00005 && metrics.maxHipDrift < 0.00005 && metrics.maxBirdDrift < 0.00005, `${variant} u=${u}: support does not sway with idle life`, metrics);
      check(metrics.maxFootDrift < 0.001, `${variant} u=${u}: feet remain planted across eight seconds`, metrics.maxFootDrift);
      check(metrics.maxToeVertexDrift < 0.001, `${variant} u=${u}: actual toe skin stays planted across eight seconds`, metrics.maxToeVertexDrift);
      for (const [fi, f] of first.toes.entries()) {
        const gaps = f.toes.map((t) => t.minGap);
        const minimumAcrossTime = Math.min(...samples.flatMap((s) => s.toes[fi].toes.map((toe) => toe.minGap)));
        check(minimumAcrossTime >= -0.018, `${variant} u=${u} ${f.name}: toe geometry stays outside rock`, minimumAcrossTime);
        check(Math.min(...gaps) < 0.035, `${variant} u=${u} ${f.name}: at least one toe makes contact`, gaps);
        check(gaps.filter((g) => g < 0.045).length >= Math.min(3, gaps.length), `${variant} u=${u} ${f.name}: multiple digits support the perch`, gaps);
      }
      if (!process.env.SKIP_IMAGES) {
        for (const t of [0, 4]) {
          await page.evaluate(({ u, t }) => window.__openingQA.sample(u, t), { u, t });
          await page.screenshot({ path: path.join(out, `${variant}-perch-${u}-idle-${t}.png`) });
        }
        // The next sample restores the story camera.
        await page.evaluate(({ u }) => { window.__openingQA.sample(u, 4); window.__openingQA.closeup(); }, { u });
        await page.screenshot({ path: path.join(out, `${variant}-perch-${u}-feet.png`) });
      }
    }
    result.transitions = await page.evaluate(() => {
      const windows = [[0.10, 0.18], [0.84, 0.97]], result = [];
      for (const [a, b] of windows) {
        const samples = [];
        for (let u = a; u <= b + 0.0001; u += 0.002) {
          const s = window.__openingQA.sample(u, 3);
          samples.push({ u: s.u, bird: s.bird, ground: s.ground, finite: s.finite });
        }
        result.push(samples);
      }
      return result;
    });
    const jumpMetrics = result.transitions.map((samples) => ({ range: [samples[0].u, samples.at(-1).u], maxStep: Math.max(...samples.slice(1).map((s, i) => distance(s.bird, samples[i].bird))) }));
    result.transitionMetrics = jumpMetrics;
    check(result.transitions.flat().every((s) => s.finite), `${variant}: finite takeoff and landing poses`);
    check(jumpMetrics.every((m) => m.maxStep < 0.35), `${variant}: no large takeoff/landing position discontinuity`, jumpMetrics);
    delete result.transitions;
    result.takeoffJointMotion = await page.evaluate(() => {
      const op = window.__op, originalRender = op.post.render;
      const bones = op.feet.rig.feet.flatMap((foot) => [...foot.leg, foot.ankle, ...foot.toes.flatMap((toe) => toe.bones)]);
      let maxDegrees = 0, worst = null;
      // Sample the actual limb rotations densely: smooth body motion alone does not catch an IK bend flipping at release.
      op.post.render = () => {};
      try {
        for (const time of [0, 4, 8]) {
          let previous = null;
          for (let step = 0; step <= 160; step++) {
            const u = 0.12 + step * 0.00025;
            op.setU(u, time);
            const current = bones.map((bone) => bone.quaternion.clone());
            if (previous) for (let i = 0; i < bones.length; i++) {
              const degrees = previous[i].angleTo(current[i]) * 180 / Math.PI;
              if (degrees > maxDegrees) { maxDegrees = degrees; worst = { u, time, bone: bones[i].name }; }
            }
            previous = current;
          }
        }
      } finally { op.post.render = originalRender; }
      return { progressStep: 0.00025, maxDegrees, worst };
    });
    check(result.takeoffJointMotion.maxDegrees < 3, `${variant}: legs release the perch without an IK spring or joint flip`, result.takeoffJointMotion);
    result.tailClearance = await page.evaluate((times) => {
      if (!window.__op.clearance?.tailGap) return [];
      return [0, 0.12, 0.155, 0.87, 0.905, 1].map((u) => ({
        u,
        samples: times.map((t) => {
          window.__openingQA.sample(u, t);
          return { t, gap: window.__op.clearance.tailGap() };
        }),
      }));
    }, idleTimes);
    check(result.tailClearance.flatMap((s) => s.samples).every((s) => Number.isFinite(s.gap) && s.gap >= 0), `${variant}: tail clears the mountain at takeoff and landing`, result.tailClearance);
    const reversal = await page.evaluate(() => {
      const samples = [0, 0.12, 0.15, 0.40, 0.87, 0.905, 1];
      const before = samples.map((u) => window.__openingQA.sample(u, 2.6));
      window.__openingQA.sample(0.48, 8);
      const after = [...samples].reverse().map((u) => window.__openingQA.sample(u, 2.6)).reverse();
      return before.map((s, i) => ({ u: s.u, first: s.matrices, second: after[i].matrices, birdFirst: s.bird, birdSecond: after[i].bird }));
    });
    result.maxReversalDelta = Math.max(...reversal.map((s) => Math.max(maxArrayDelta(s.first, s.second), maxArrayDelta(s.birdFirst, s.birdSecond))));
    check(result.maxReversalDelta < 0.00002, `${variant}: scrolling backward reproduces the same pose`, result.maxReversalDelta);
    result.contextLost = await page.evaluate(() => window.__op.renderer.getContext().isContextLost());
    check(!result.contextLost, `${variant}: WebGL context remains live`);
    const withWind = await page.evaluate(() => [0, 4].map((t) => window.__openingQA.sample(0, t).feathers));
    if (!process.env.SKIP_IMAGES) {
      for (const u of [0.15, 0.42, 0.87, 0.905]) {
        await page.evaluate((u) => window.__openingQA.sample(u, 3), u);
        await page.screenshot({ path: path.join(out, `${variant}-story-${u}.png`) });
      }
    }
    await page.close();
    const reference = await open(variant, 0, errors);
    const withoutWind = await reference.evaluate(() => [0, 4].map((t) => window.__openingQA.sample(0, t).feathers));
    const regions = [...new Set(withWind[0].map((f) => f.region))];
    result.wind = regions.map((region) => {
      const perVertex = withWind[0].flatMap((f, i) => f.region !== region ? [] : [{
        movement: distance(f.p, withWind[1][i].p),
        windDifference: distance(withWind[1][i].p, withoutWind[1][i].p),
      }]);
      return { region, vertices: perVertex.length, maxMovement: Math.max(...perVertex.map((v) => v.movement)), maxWindDifference: Math.max(...perVertex.map((v) => v.windDifference)) };
    });
    for (const region of ['wingA', 'wingB']) {
      const metrics = result.wind.find((r) => r.region === region);
      check(metrics?.maxMovement > 0.0005 && metrics?.maxWindDifference > 0.00015, `${variant}: ${region} feather vertices respond to wind while progress is fixed`, metrics);
    }
    await reference.close();
    result.errors = [...new Set(errors)];
    check(result.errors.length === 0, `${variant}: shader, JavaScript, and resource errors`, result.errors);
    console.log(`[${variant}] foot drift ${Math.max(...result.perches.map((p) => p.maxFootDrift)).toExponential(2)}, reverse delta ${result.maxReversalDelta.toExponential(2)}, ${result.errors.length} browser errors`);
  }
} catch (error) {
  report.failures.push({ message: 'Harness did not complete', detail: error.stack });
} finally {
  await browser.close();
  await writeFile(path.join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
}
console.log(`${report.failures.length ? 'FAIL' : 'PASS'}: ${report.failures.length} failed checks. ${path.join(out, 'report.json')}`);
for (const failure of report.failures) console.log(failure.message, failure.metrics ?? failure.detail ?? '');
process.exitCode = report.failures.length ? 1 : 0;

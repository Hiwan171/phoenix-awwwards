// End-to-end landscape checks, including actual rendered triangles and lake pixels.
// node tools/verify-opening-landscape.mjs [http://localhost:5173]
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { fileURLToPath } from 'node:url';

const origin = process.argv[2] ?? 'http://localhost:5173';
const out = fileURLToPath(new URL('./_out/landscape-quality/', import.meta.url));
await mkdir(out, { recursive: true });
const report = { models: [], failures: [] };
const check = (ok, message, value) => { if (!ok) report.failures.push({ message, value }); };
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--use-angle=d3d11'] });
function changedPixels(a, b) {
  const first = PNG.sync.read(a), second = PNG.sync.read(b);
  let changed = 0;
  for (let i = 0; i < first.data.length; i += 4) {
    if (Math.max(...[0,1,2].map(k => Math.abs(first.data[i+k]-second.data[i+k]))) > 3) changed++;
  }
  return changed;
}
try {
  for (const variant of ['web','lite']) {
    const errors = [], page = await browser.newPage({ viewport: {width:1280,height:720} });
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if(m.type() === 'error') errors.push(m.text()); });
    page.on('response', r => { if(r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
    await page.goto(`${origin}/opening-lab.html?m=${variant}&ui=0&msaa=0`);
    await page.waitForFunction(() => window.__op?.ready, null, {timeout:180000});
    await page.evaluate(() => { window.requestAnimationFrame = () => 0; });
    await page.waitForTimeout(100);
    const metrics = await page.evaluate(() => {
      const op = window.__op, {THREE,landscape} = op;
      const ray = new THREE.Raycaster(), down = new THREE.Vector3(0,-1,0);
      let maxSurfaceError = 0, comparisons = 0, missingGround = 0;
      const points = [];
      for(const [cx,cz] of [[0,0],[-12,-40]]) for(let x=-1.2;x<=1.21;x+=.3) for(let z=-1.2;z<=1.21;z+=.3) points.push([cx+x,cz+z]);
      for(let x=-8;x<=16;x+=4) for(let z=-12;z>=-48;z-=4) points.push([x,z]);
      op.scene.updateMatrixWorld(true);
      for(const [x,z] of points) {
        ray.set(new THREE.Vector3(x,200,z),down);
        const hit = ray.intersectObjects(landscape.meshes,false)[0];
        if(!hit) { missingGround++; continue; }
        maxSurfaceError = Math.max(maxSurfaceError,Math.abs(hit.point.y-op.surfaceAt(x,z))); comparisons++;
      }
      let minFlightGap = Infinity, minCameraGap = Infinity, length = 0, previous = null;
      const render = op.post.render; op.post.render = () => {};
      try {
        for(let i=0;i<=200;i++) {
          const u=i/200;op.setU(u,8);
          if(previous) length += previous.distanceTo(op.bird.position);
          previous=op.bird.position.clone();
          if(u>.17 && u<.83) minFlightGap=Math.min(minFlightGap,op.bird.position.y-op.heightAt(op.bird.position.x,op.bird.position.z));
          ray.set(op.camera.position,down);
          const hit=ray.intersectObjects(landscape.meshes,false)[0];
          if(hit) minCameraGap=Math.min(minCameraGap,op.camera.position.y-hit.point.y);
        }
      } finally { op.post.render=render; }
      let wet=0,dry=0;
      for(let x=-20;x<=24;x+=2) for(let z=-4;z>=-56;z-=2) {
        if(op.heightAt(x,z)<landscape.lake.level) wet++; else dry++;
      }
      return { ...landscape.diagnostics(), maxSurfaceError, comparisons, missingGround, minFlightGap, minCameraGap, pathLength:length,wet,dry };
    });
    check(metrics.maxSurfaceError < .002 && metrics.missingGround===0,`${variant}: foot sampler matches visible rock triangles`,metrics);
    check(metrics.minFlightGap > .5,`${variant}: flight clears the new landscape`,metrics.minFlightGap);
    check(metrics.minCameraGap > .35,`${variant}: story camera clears rendered terrain`,metrics.minCameraGap);
    check(metrics.wet>20 && metrics.dry>20,`${variant}: lake occupies a basin with dry surrounding slopes`,{wet:metrics.wet,dry:metrics.dry});
    check(metrics.pathLength>60,`${variant}: extended flight traverses the valley`,metrics.pathLength);
    await page.evaluate(() => { const op=window.__op;op.setU(.45,9);op.landscape.lake.update(0);op.post.render(9); });
    const baseline=await page.screenshot({path:`${out}/${variant}-lake.png`});
    await page.evaluate(() => { const op=window.__op;op.landscape.lake.update(3);op.post.render(9); });
    const moving=await page.screenshot();
    const animatedPixels=changedPixels(baseline,moving);
    check(animatedPixels>150,`${variant}: wind ripples change actual lake pixels`,animatedPixels);
    await page.evaluate(() => { const op=window.__op;op.landscape.lake.mesh.visible=false;op.post.render(9); });
    const absent=await page.screenshot();
    const lakePixels=changedPixels(moving,absent);
    check(lakePixels>5000,`${variant}: reflective water is visible during the flyover`,lakePixels);
    await page.evaluate(() => { window.__op.landscape.lake.mesh.visible=true; });
    for(const u of [0,.28,.45,.62,.87,1]) {
      await page.evaluate(u => window.__op.setU(u,5+u*30),u);
      await page.screenshot({path:`${out}/${variant}-story-${u}.png`});
    }
    check(errors.length===0,`${variant}: no shader, JavaScript or asset errors`,errors);
    report.models.push({variant,...metrics,animatedPixels,lakePixels,errors});
    console.log(variant,JSON.stringify({maxSurfaceError:metrics.maxSurfaceError,pathLength:metrics.pathLength,minFlightGap:metrics.minFlightGap,minCameraGap:metrics.minCameraGap,animatedPixels,lakePixels,errors:errors.length}));
    await page.close();
  }
  const reduced=await browser.newPage({reducedMotion:'reduce'});
  await reduced.goto(`${origin}/opening-lab.html?m=lite&msaa=0&ui=0`);
  await reduced.waitForFunction(() => window.__op?.ready,null,{timeout:180000});
  const motion=await reduced.evaluate(() => { window.__op.landscape.update(9); return window.__op.landscape.lake.diagnostics(); });
  check(motion.time===0,'reduced motion holds lake ripples still',motion);
  await reduced.close();
  const autoplay=await browser.newPage({viewport:{width:960,height:540}});
  await autoplay.goto(`${origin}/opening-lab.html?m=lite&msaa=0&ui=0&play=1&dur=3`);
  await autoplay.waitForFunction(() => window.__op?.u===1,null,{timeout:180000});
  const landing=await autoplay.evaluate(() => ({u:window.__op.u,ground:window.__op.timeline.at(1).ground,feet:window.__op.feet.diagnostics()}));
  check(landing.u===1 && landing.ground===1,'automatic preview finishes on the landing perch',landing);
  report.autoplay=landing;
  await autoplay.close();
} catch(error) {report.failures.push({message:'Landscape verification interrupted',detail:error.stack});}
finally {await browser.close();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));}
console.log(`${report.failures.length?'FAIL':'PASS'}: ${report.failures.length} failures`);
for(const failure of report.failures) console.log(JSON.stringify(failure));
process.exitCode=report.failures.length?1:0;

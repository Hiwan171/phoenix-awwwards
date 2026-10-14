import { chromium } from 'playwright-core';
import fs from 'fs';
const id = process.argv[2];
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(`https://www.shadertoy.com/view/${id}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction('window.gShaderToy && gShaderToy.mEffect && gShaderToy.mEffect.mPasses && gShaderToy.mEffect.mPasses.length', null, { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(3000);
const data = await page.evaluate(() => {
  const g = window.gShaderToy;
  const passes = (g?.mEffect?.mPasses ?? []).map((p) => ({ type: p.mType, name: p.mName, code: p.mSource ?? p.mShaderCode ?? null,
    inputs: (p.mInputs ?? []).map((i) => i ? { type: i.mInfo?.mType ?? null, src: i.mInfo?.mSrc ?? null } : null) }));
  return { title: document.querySelector('#title')?.innerText ?? document.title, user: document.querySelector('#username')?.innerText ?? null,
    desc: document.querySelector('#description')?.innerText ?? null, license: document.body.innerText.match(/(CC BY[^\n]*|Creative Commons[^\n]*|License[^\n]*)/i)?.[0] ?? null, passes };
});
fs.writeFileSync(process.argv[3], JSON.stringify(data, null, 2));
console.log(JSON.stringify({ title: data.title, user: data.user, license: data.license, passes: data.passes.map((p) => ({ type: p.type, name: p.name, len: p.code?.length, inputs: p.inputs })) }, null, 1));
console.log('DESC:', (data.desc ?? '').slice(0, 400));
await browser.close();

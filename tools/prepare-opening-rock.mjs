// Reproduce the local CC0 rock textures. Requires tools/node_modules/sharp.
// node tools/prepare-opening-rock.mjs
import sharp from 'sharp';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const cache=fileURLToPath(new URL('./_out/landscape/source/',import.meta.url));
const out=fileURLToPath(new URL('../site/public/textures/opening-rock/',import.meta.url));
await mkdir(cache,{recursive:true});await mkdir(out,{recursive:true});
await Promise.all(['diff','nor_gl','rough','disp','ao'].map(async channel=>{
  const target=`${cache}/${channel}.jpg`;
  try {await readFile(target);return;} catch { /* Download missing source. */ }
  const url=`https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/rock_face/rock_face_${channel}_2k.jpg`;
  const response=await fetch(url);
  if(!response.ok) throw new Error(`${response.status}: ${url}`);
  await writeFile(target,Buffer.from(await response.arrayBuffer()));
}));
for(const size of [1024,2048]) {
  const suffix=size===1024?'1k':'2k';
  await sharp(`${cache}/diff.jpg`).resize(size,size).webp({quality:88}).toFile(`${out}/color-${suffix}.webp`);
  await sharp(`${cache}/nor_gl.jpg`).resize(size,size).webp({quality:90}).toFile(`${out}/normal-${suffix}.webp`);
}
const channels=await Promise.all(['rough','disp','ao'].map(channel=>sharp(`${cache}/${channel}.jpg`).resize(1024,1024).removeAlpha().extractChannel(0).raw().toBuffer()));
const pixels=Buffer.alloc(1024*1024*3);
for(let i=0;i<channels[0].length;i++)for(let c=0;c<3;c++)pixels[i*3+c]=channels[c][i];
await sharp(pixels,{raw:{width:1024,height:1024,channels:3}}).png().toFile(`${out}/surface.png`);
console.log('Opening rock: albedo, normal, packed roughness / relief / AO ready.');

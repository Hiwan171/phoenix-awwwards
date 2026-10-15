// Pixel diff of two images (or two folders of PNGs): the proof that an optimisation did not change the look.
// usage: node vdiff.mjs <A.png|dirA> <B.png|dirB> [heatDir]
// per image: MAE and RMSE (0-255), PSNR, % of pixels differing by > 2 and > 8, max diff, and the MAE after a 4x blur (what the
// eye integrates). Rules of thumb: identical = PSNR 99; a refactor that should be exact lands above ~60 dB; 38 dB with the
// differences all inside animated noise (flames) is the same look. A heat map (diff x 8) is written when heatDir is given.
// Deterministic frames: load the page with ?qa=1 and set window.__phoenix.S.t = <seconds> (stage.js freezes the clock).
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const [, , A, B, HEAT] = process.argv;
if (!A || !B) { console.error('usage: node vdiff.mjs <A.png|dirA> <B.png|dirB> [heatDir]'); process.exit(1); }

const pairs = fs.statSync(A).isDirectory()
  ? fs.readdirSync(A).filter((f) => f.endsWith('.png') && fs.existsSync(path.join(B, f))).map((f) => [path.join(A, f), path.join(B, f), f])
  : [[A, B, path.basename(A)]];

const raw = async (f) => { const { data, info } = await sharp(f).removeAlpha().raw().toBuffer({ resolveWithObject: true }); return { data, w: info.width, h: info.height }; };
const blur4 = async (f) => { const m = await sharp(f).metadata(); return sharp(f).removeAlpha().resize(Math.round(m.width / 4), Math.round(m.height / 4), { kernel: 'cubic' }).raw().toBuffer(); };

if (HEAT) fs.mkdirSync(HEAT, { recursive: true });
console.log('image'.padEnd(22), 'MAE'.padStart(6), 'RMSE'.padStart(6), 'PSNR'.padStart(6), '>2'.padStart(7), '>8'.padStart(7), 'max'.padStart(4), 'blurMAE'.padStart(8));
for (const [fa, fb, name] of pairs) {
  const a = await raw(fa), b = await raw(fb);
  if (a.w !== b.w || a.h !== b.h) { console.log(name.padEnd(22), 'SIZE MISMATCH', `${a.w}x${a.h} vs ${b.w}x${b.h}`); continue; }
  const n = a.w * a.h, heat = HEAT ? Buffer.alloc(n * 3) : null;
  let sum = 0, sq = 0, over2 = 0, over8 = 0, mx = 0;
  for (let i = 0; i < n; i++) {
    let pm = 0;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(a.data[i * 3 + c] - b.data[i * 3 + c]);
      sum += d; sq += d * d; if (d > pm) pm = d;
      if (heat) heat[i * 3 + c] = Math.min(255, d * 8);
    }
    if (pm > 2) over2++; if (pm > 8) over8++; if (pm > mx) mx = pm;
  }
  const mae = sum / (n * 3), rmse = Math.sqrt(sq / (n * 3)), psnr = rmse === 0 ? 99 : 20 * Math.log10(255 / rmse);
  const [ba, bb] = await Promise.all([blur4(fa), blur4(fb)]);
  let bs = 0; for (let i = 0; i < ba.length; i++) bs += Math.abs(ba[i] - bb[i]);
  console.log(name.padEnd(22), mae.toFixed(2).padStart(6), rmse.toFixed(2).padStart(6), psnr.toFixed(1).padStart(6),
    (100 * over2 / n).toFixed(2).padStart(6) + '%', (100 * over8 / n).toFixed(2).padStart(6) + '%', String(mx).padStart(4), (bs / ba.length).toFixed(2).padStart(8));
  if (heat) await sharp(heat, { raw: { width: a.w, height: a.h, channels: 3 } }).png().toFile(path.join(HEAT, name));
}

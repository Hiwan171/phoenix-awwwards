// ASCII density maps of a (prepped) GLB so joints can be placed from real coordinates.
// usage: node silhouette.mjs model.glb [xmax=0.5] [dx=0.025] [dy=0.05]
import { NodeIO } from '@gltf-transform/core';
const [,, file, xmaxArg = '0.5', dxArg = '0.025', dyArg = '0.05'] = process.argv;
const XMAX = +xmaxArg, DX = +dxArg, DY = +dyArg;
const doc = await new NodeIO().read(file);
const P = doc.getRoot().listMeshes()[0].listPrimitives()[0].getAttribute('POSITION').getArray();
const n = P.length / 3;
const chars = ' .:-=+*#%@';
function map(title, ha, hmax) {   // ha: horizontal axis (0=x, 2=z); rows are y (1 .. -1)
  const cols = Math.round((2 * hmax) / DX), rows = Math.round(2 / DY);
  const g = Array.from({ length: rows }, () => new Float32Array(cols));
  for (let i = 0; i < n; i++) {
    const c = Math.floor((P[i * 3 + ha] + hmax) / DX), r = Math.floor((1 - P[i * 3 + 1]) / DY);
    if (c >= 0 && c < cols && r >= 0 && r < rows) g[r][c]++;
  }
  let m = 0; for (const row of g) for (const v of row) m = Math.max(m, v);
  console.log(`\n${title}   (each row ${DY} in y, each col ${DX}; max count ${m})`);
  let hdr = '       ';
  for (let c = 0; c < cols; c++) { const v = -hmax + c * DX; hdr += Math.abs(v * 10 - Math.round(v * 10)) < 1e-6 && Math.round(v * 10) % 2 === 0 ? String(Math.abs(Math.round(v * 10))).slice(-1) : (Math.abs(v) < 1e-9 ? '0' : ' '); }
  console.log(hdr + '   (ticks: |value|*10 on even tenths)');
  for (let r = 0; r < rows; r++) {
    const y = 1 - r * DY;
    let line = '';
    for (let c = 0; c < cols; c++) { const v = g[r][c]; line += v === 0 ? ' ' : chars[Math.min(chars.length - 1, 1 + Math.floor(Math.sqrt(v / m) * (chars.length - 2)))]; }
    console.log(`${y.toFixed(2).padStart(6)} ${line}`);
  }
}
map('FRONT silhouette: horizontal = X  (bird faces -Z; bird-left = -X)', 0, XMAX);
map('SIDE silhouette: horizontal = Z  (-Z = the bird\'s front, +Z = back)', 2, 0.45);

// Tiny orthographic point-splat renderer -> PNG (for rig planning / verification, no GPU needed).
import { PNG } from 'pngjs';
import fs from 'fs';

// views: axes [horizontal, vertical, depth]; depth sign decides which point wins
export const VIEWS = {
  front: { h: 0, v: 1, d: 2, hs: 1 },   // looking down -Z : X right, Y up
  side:  { h: 2, v: 1, d: 0, hs: 1 },   // Z right, Y up
  top:   { h: 0, v: 2, d: 1, hs: 1 },   // X right, Z up
};

// pos: Float32Array xyz; rgb: optional Uint8Array rgb per vertex (else depth-tinted)
export function render(pos, file, view, { crop = null, size = 900, rgb = null, step = 1, marks = [] } = {}) {
  const { h, v, d } = VIEWS[view];
  const n = pos.length / 3, pad = 24;
  let [x0, x1, y0, y1] = crop ?? [1e9, -1e9, 1e9, -1e9];
  let dmin = 1e9, dmax = -1e9;
  for (let i = 0; i < n; i++) {
    const a = pos[i*3+h], b = pos[i*3+v], c = pos[i*3+d];
    if (!crop) { x0 = Math.min(x0, a); x1 = Math.max(x1, a); y0 = Math.min(y0, b); y1 = Math.max(y1, b); }
    dmin = Math.min(dmin, c); dmax = Math.max(dmax, c);
  }
  const sc = (size - 2*pad) / Math.max(x1 - x0, y1 - y0);
  const png = new PNG({ width: size, height: size });
  png.data.fill(255);
  const zb = new Float32Array(size*size).fill(-1e9);
  const put = (px, py, depth, r, g, b) => {
    if (px < 0 || py < 0 || px >= size || py >= size) return;
    const k = py*size + px; if (depth <= zb[k]) return; zb[k] = depth;
    png.data[k*4] = r; png.data[k*4+1] = g; png.data[k*4+2] = b; png.data[k*4+3] = 255;
  };
  for (let i = 0; i < n; i += step) {
    const a = pos[i*3+h], b = pos[i*3+v], c = pos[i*3+d];
    const px = Math.round(pad + (a - x0)*sc), py = Math.round(size - pad - (b - y0)*sc);
    let r, g, bl;
    if (rgb) { r = rgb[i*3]; g = rgb[i*3+1]; bl = rgb[i*3+2]; }
    else { const t = (c - dmin)/((dmax - dmin) || 1); r = 40 + 200*t; g = 60 + 60*(1-t); bl = 220 - 180*t; }
    put(px, py, c, r, g, bl);
    put(px+1, py, c, r, g, bl);
  }
  // 0.1-unit grid
  for (let t = Math.ceil(x0*10)/10; t <= x1; t += 0.1) { const px = Math.round(pad + (t - x0)*sc); for (let y = 0; y < size; y += 8) { const k = y*size + px; if (px>=0&&px<size) { png.data[k*4]=png.data[k*4+1]=png.data[k*4+2]=0; } } }
  for (let t = Math.ceil(y0*10)/10; t <= y1; t += 0.1) { const py = Math.round(size - pad - (t - y0)*sc); for (let x = 0; x < size; x += 8) { const k = py*size + x; if (py>=0&&py<size) { png.data[k*4]=png.data[k*4+1]=png.data[k*4+2]=0; } } }
  // marks: [{p:[x,y,z], c:[r,g,b], r}] drawn on top
  for (const m of marks) {
    const px = Math.round(pad + (m.p[h] - x0)*sc), py = Math.round(size - pad - (m.p[v] - y0)*sc), R = m.r ?? 4;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      if (dx*dx + dy*dy > R*R) continue; const X = px+dx, Y = py+dy;
      if (X<0||Y<0||X>=size||Y>=size) continue; const k = Y*size + X;
      png.data[k*4] = m.c[0]; png.data[k*4+1] = m.c[1]; png.data[k*4+2] = m.c[2]; png.data[k*4+3] = 255;
    }
  }
  fs.writeFileSync(file, PNG.sync.write(png));
}

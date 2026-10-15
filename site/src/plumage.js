// Plumage bake: per-vertex data that lets the shader PAINT the phoenix instead of recolouring the GLB texture.
// Works from bone NAMES, so it follows any rig built with tools/skeleton-v2.mjs conventions:
//   Root/Spine* (torso) | Neck*/Head (head) | Beak | Crest* | Wing_{L,R}_* | Tail_<id>_<k> | Leg_{L,R}_<k>
// Adds three vec4 attributes to the (shared) skinned geometry:
//   aW0 = (torso, head, beak, crest)  region weights from the skin weights (soft across joints)
//   aW1 = (wing, tail, leg, t)        t = 0 at the root of a limb/feather chain -> 1 at its tip
//   aQ  = (cavity, convex, thin, front)
//         cavity: 0..1 how recessed the surface is (geometry AO, calibrated by percentile); convex: 0..1 ridges;
//         thin: 0..1 how much light passes through (distal wing/tail only); front: breast facing (-z) 0..1
//   aE  = (u, v, 0, 0)   position relative to the NEAREST eye, in the eye's own frame and in units of the eye's half-length
//         (u, along the slanted long axis, + = toward the back/up) and half-height (v, + = up). Linear in position, so the
//         shader gets an exact eye outline per pixel: a shape thinner than the vertex spacing can't be drawn from a
//         per-vertex distance.
//   aX  = (outward, eyeD, cere, 0)
//         outward: 0..1 how far a wing vertex sits from the wing's bone chain (= how far along its own feather:
//         the dark "primary tips" of the reference); eyeD: distance to the nearest eye / eyeR (0 = centre);
//         cere: 0..1 around the beak base
// Everything is derived from the rest pose, once, at load (a few hundred ms for ~130k vertices).
//
// Why not just use the dominant bone: skin weights are noisy, the dominant bone flips from vertex to vertex and a
// bone-index based `t` turns into confetti. So `t` is the projection onto the chain polyline (geometric), equalised by
// rank inside each region (feathers extend far beyond the bone chain, raw t piles up near 1) and smoothed on the mesh.
import * as THREE from 'three';

const regionOfName = (n) =>
  /^(Root|Spine)/.test(n) ? 0 : /^(Neck|Head)/.test(n) ? 1 : /^Beak/.test(n) ? 2 : /^Crest/.test(n) ? 3
  : /^Wing_/.test(n) ? 4 : /^Tail_/.test(n) ? 5 : /^Leg_/.test(n) ? 6 : 0;
const chainOfName = (n) => {
  let m;
  if ((m = /^(Wing_[LR])_/.exec(n))) return m[1];
  if ((m = /^(Tail_[A-Z])_/.exec(n))) return m[1];
  if ((m = /^(Leg_[LR])_/.exec(n))) return m[1];
  if (/^Crest/.test(n)) return 'Crest';
  return null;
};
// yield to the browser so a long bake never freezes the frame (setTimeout 0 -> next task, not next microtask)
const tick = () => new Promise((r) => setTimeout(r, 0));
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// eyes: model-space centres of the eyes (the sculpt has no separate eyeball: they were located by raycasting the face)
export async function bakePlumage(skinned, { cavityGain = 1.0, smoothPasses = 8, tau = 0.04,
  eyes = [[-0.075, 0.25, -0.12], [-0.035, 0.25, -0.12]], eyeR = 0.0075,
  // almond/diamond eye: long, thin, slanted (front corner low, rear corner high)
  eyeHalfLen = 0.0062, eyeHalfH = 0.0023, eyeTilt = 28,
  cere = [-0.045, 0.242, -0.135], cereR = 0.02 } = {}) {
  const geo = skinned.geometry, skel = skinned.skeleton;
  const n = geo.attributes.position.count;
  const SI = geo.attributes.skinIndex, SW = geo.attributes.skinWeight;
  const idx = geo.index ? geo.index.array : null;
  const nb = skel.bones.length;

  // The shipped GLB is meshopt-quantised: positions are NORMALISED Int16 (and normals Int8), so `.array` holds raw
  // integers and the skeleton's inverse bind matrices live in that same normalised space. Decode through getX/Y/Z,
  // then map back to model space with a per-axis affine fit between the bones' true rest positions (node graph) and
  // the ones implied by the inverse bind matrices. (Reading `.array` here made every distance below garbage.)
  const Pn = new Float32Array(n * 3), N = new Float32Array(n * 3);
  const pa = geo.attributes.position, na = geo.attributes.normal;
  for (let i = 0; i < n; i++) {
    Pn[i * 3] = pa.getX(i); Pn[i * 3 + 1] = pa.getY(i); Pn[i * 3 + 2] = pa.getZ(i);
    N[i * 3] = na.getX(i); N[i * 3 + 1] = na.getY(i); N[i * 3 + 2] = na.getZ(i);
  }
  skel.bones[0].updateWorldMatrix(true, true);
  const bindPos = [], truePos = [], tm = new THREE.Matrix4(), tv = new THREE.Vector3();
  for (let i = 0; i < nb; i++) {
    tm.copy(skel.boneInverses[i]).invert(); bindPos.push(tv.setFromMatrixPosition(tm).toArray());
    truePos.push(skel.bones[i].getWorldPosition(new THREE.Vector3()).toArray());
  }
  const fit = [0, 1, 2].map((k) => {                       // least squares: true = a * bind + b
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let i = 0; i < nb; i++) { const x = bindPos[i][k], y = truePos[i][k]; sx += x; sy += y; sxx += x * x; sxy += x * y; }
    const den = nb * sxx - sx * sx, a = Math.abs(den) < 1e-12 ? 1 : (nb * sxy - sx * sy) / den;
    return [a, (sy - a * sx) / nb];
  });
  const P = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) P[i * 3 + k] = fit[k][0] * Pn[i * 3 + k] + fit[k][1];
  const bind2model = (b) => b.map((v, k) => fit[k][0] * v + fit[k][1]);
  let yLo = 1e9, yHi = -1e9;
  for (let i = 1; i < P.length; i += 3) { if (P[i] < yLo) yLo = P[i]; if (P[i] > yHi) yHi = P[i]; }
  const tau2 = Math.pow(tau * (yHi - yLo) / 2, 2);        // blend width, relative to the model's half-height

  // bone rest positions (mesh space) and the region / chain of every bone
  const bp = [];
  for (let i = 0; i < nb; i++) bp.push(new THREE.Vector3(...truePos[i]));
  const boneRegion = skel.bones.map((b) => regionOfName(b.name));
  const chainNames = [...new Set(skel.bones.map((b) => chainOfName(b.name)).filter(Boolean))];
  const polys = chainNames.map((cn) => {
    const ids = skel.bones.map((b, i) => (chainOfName(b.name) === cn ? i : -1)).filter((i) => i >= 0);
    const pts = ids.map((i) => bp[i].clone());
    if (pts.length >= 2) pts.push(pts[pts.length - 1].clone().add(pts[pts.length - 1].clone().sub(pts[pts.length - 2])));
    else pts.push(pts[0].clone().add(new THREE.Vector3(0, 0.05, 0)));
    return pts;
  });
  const chainRegion = chainNames.map((cn) => regionOfName(skel.bones.find((b) => chainOfName(b.name) === cn).name));

  // ── weld duplicate vertices (UV seams / hard normals) ──
  const rep = new Int32Array(n), keyMap = new Map();
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(P[i * 3] * 5e3)},${Math.round(P[i * 3 + 1] * 5e3)},${Math.round(P[i * 3 + 2] * 5e3)}`;
    const r = keyMap.get(k);
    if (r === undefined) { keyMap.set(k, i); rep[i] = i; } else rep[i] = r;
  }
  keyMap.clear();
  const wn = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const r = rep[i]; wn[r * 3] += N[i * 3]; wn[r * 3 + 1] += N[i * 3 + 1]; wn[r * 3 + 2] += N[i * 3 + 2]; }
  for (let i = 0; i < n; i++) {
    if (rep[i] !== i) continue;
    const l = Math.hypot(wn[i * 3], wn[i * 3 + 1], wn[i * 3 + 2]) || 1;
    wn[i * 3] /= l; wn[i * 3 + 1] /= l; wn[i * 3 + 2] /= l;
  }

  // adjacency (welded)
  const triCount = idx ? idx.length / 3 : n / 3;
  const eachEdge = (fn) => {
    for (let t = 0; t < triCount; t++) {
      const a = rep[idx ? idx[t * 3] : t * 3], b = rep[idx ? idx[t * 3 + 1] : t * 3 + 1], c = rep[idx ? idx[t * 3 + 2] : t * 3 + 2];
      fn(a, b); fn(b, a); fn(b, c); fn(c, b); fn(c, a); fn(a, c);
    }
  };
  const deg = new Uint16Array(n), sum = new Float32Array(n * 3), edge = new Float32Array(n);
  eachEdge((a, b) => {
    sum[a * 3] += P[b * 3]; sum[a * 3 + 1] += P[b * 3 + 1]; sum[a * 3 + 2] += P[b * 3 + 2];
    edge[a] += Math.hypot(P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]);
    deg[a]++;
  });
  const smoothField = async (src, passes) => {
    let cur = src;
    for (let it = 0; it < passes; it++) {
      await tick();                                  // let the page draw between passes (the loader animates meanwhile)
      const acc = new Float32Array(n);
      eachEdge((a, b) => { acc[a] += cur[b]; });
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) if (rep[i] === i) out[i] = deg[i] ? 0.4 * cur[i] + 0.6 * (acc[i] / deg[i]) : cur[i];
      cur = out;
    }
    return cur;
  };

  // ── cavity: Laplacian projected on the normal, normalised by local edge length, two scales, percentile-calibrated ──
  const curv = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (rep[i] !== i || !deg[i]) continue;
    const d = deg[i], e = edge[i] / d || 1e-4;
    const lx = sum[i * 3] / d - P[i * 3], ly = sum[i * 3 + 1] / d - P[i * 3 + 1], lz = sum[i * 3 + 2] / d - P[i * 3 + 2];
    curv[i] = (lx * wn[i * 3] + ly * wn[i * 3 + 1] + lz * wn[i * 3 + 2]) / e;
  }
  const cS = await smoothField(curv, 2), cL = await smoothField(curv, 6);
  const raw = new Float32Array(n), reps = [];
  for (let i = 0; i < n; i++) if (rep[i] === i) { raw[i] = 1.0 * cS[i] + 0.25 * cL[i]; reps.push(raw[i]); }
  reps.sort((a, b) => a - b);
  const pct = (p) => reps[Math.min(reps.length - 1, Math.floor(reps.length * p))];
  const cLo = pct(0.55), cHi = pct(0.97), vLo = pct(0.40), vHi = pct(0.03);

  // ── region weights, then t PER REGION (soft-min over that region's chains), equalised per region and blended by
  //    the region weights. (Never classify a vertex by its dominant region: dominance flips between neighbours and
  //    gave neighbouring feathers different t scales = hard-edged islands.)
  const CH_REGIONS = [3, 4, 5, 6];
  const wr = Array.from({ length: 7 }, () => new Float32Array(n));
  const traw = CH_REGIONS.map(() => new Float32Array(n));
  const dist = CH_REGIONS.map(() => new Float32Array(n));    // distance to the nearest chain of the region
  const a = new THREE.Vector3(), s = new THREE.Vector3(), q = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    if ((i & 8191) === 0 && i) await tick();
    if (rep[i] !== i) continue;
    const rw = [0, 0, 0, 0, 0, 0, 0];
    let tot = 0;
    for (let k = 0; k < 4; k++) { const bi = SI.getComponent(i, k), bw = SW.getComponent(i, k); rw[boneRegion[bi]] += bw; tot += bw; }
    for (let r = 0; r < 7; r++) wr[r][i] = rw[r] / (tot || 1);
    q.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
    CH_REGIONS.forEach((R, ri) => {
      if (wr[R][i] < 0.02) return;
      let dMin = Infinity;
      const cd = [], ct = [];
      for (let c = 0; c < chainNames.length; c++) {
        if (chainRegion[c] !== R) continue;
        const pts = polys[c], len = pts.length - 1;
        let bd = Infinity, bt = 0;
        for (let j = 0; j < len; j++) {
          s.copy(pts[j + 1]).sub(pts[j]);
          const L2 = s.lengthSq() || 1e-9;
          const fRaw = a.copy(q).sub(pts[j]).dot(s) / L2;
          const f = Math.min(1, Math.max(0, fRaw));
          const d2 = a.copy(pts[j]).addScaledVector(s, f).distanceToSquared(q);
          if (d2 < bd) { bd = d2; bt = (j + (j === len - 1 ? Math.max(0, fRaw) : f)) / len; }   // open past the tip: keeps the order
        }
        cd.push(bd); ct.push(bt); if (bd < dMin) dMin = bd;
      }
      let ws = 0, wsum = 0;
      for (let c = 0; c < cd.length; c++) { const w = Math.exp(-(cd[c] - dMin) / tau2); ws += w; wsum += w * ct[c]; }
      traw[ri][i] = ws ? wsum / ws : 0;
      dist[ri][i] = Math.sqrt(dMin);
    });
  }
  // rank equalisation per region, built from the vertices that really belong to it (weight >= 0.5)
  const cdfs = CH_REGIONS.map((R, ri) => {
    const vals = [];
    for (let i = 0; i < n; i++) if (rep[i] === i && wr[R][i] >= 0.5) vals.push(traw[ri][i]);
    vals.sort((x, y) => x - y);
    return vals;
  });
  const cdfAt = (vals, x) => {
    if (vals.length < 2) return 0;
    let lo = 0, hi = vals.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (vals[mid] < x) lo = mid + 1; else hi = mid; }
    return lo / (vals.length - 1);
  };
  const tt = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (rep[i] !== i) continue;
    let t = 0;
    CH_REGIONS.forEach((R, ri) => { if (wr[R][i] >= 0.02) t += wr[R][i] * cdfAt(cdfs[ri], traw[ri][i]); });
    tt[i] = t;
  }
  const st = await smoothField(tt, smoothPasses);
  {
    // smoothing compresses the range: stretch p2..p98 (over vertices that sit on a chain region) back to 0..1
    const vals = [];
    for (let i = 0; i < n; i++) if (rep[i] === i && wr[3][i] + wr[4][i] + wr[5][i] + wr[6][i] >= 0.5) vals.push(st[i]);
    vals.sort((x, y) => x - y);
    const lo = vals[Math.floor(vals.length * 0.02)] ?? 0, hi = vals[Math.floor(vals.length * 0.98)] ?? 1, span = Math.max(1e-4, hi - lo);
    for (let i = 0; i < n; i++) if (rep[i] === i) st[i] = Math.min(1, Math.max(0, (st[i] - lo) / span));
  }
  const sw = [];
  for (const r of wr) sw.push(await smoothField(r, 2));
  // wing outwardness: how far from the bone chain (feathers radiate from it), calibrated by percentile, then smoothed
  const outRaw = new Float32Array(n);
  {
    const ri = CH_REGIONS.indexOf(4), ds = [];
    for (let i = 0; i < n; i++) if (rep[i] === i && wr[4][i] >= 0.5) ds.push(dist[ri][i]);
    ds.sort((x, y) => x - y);
    const d95 = ds[Math.floor(ds.length * 0.95)] || 1;
    for (let i = 0; i < n; i++) if (rep[i] === i) outRaw[i] = Math.min(1, dist[ri][i] / d95) * wr[4][i];
  }
  const outS = await smoothField(outRaw, 3);

  // ── pack ──
  const aW0 = new Float32Array(n * 4), aW1 = new Float32Array(n * 4), aQ = new Float32Array(n * 4), aX = new Float32Array(n * 4), aE = new Float32Array(n * 4);
  const tilt = (eyeTilt * Math.PI) / 180, ua = [0, Math.sin(tilt), Math.cos(tilt)], va = [0, Math.cos(tilt), -Math.sin(tilt)];   // +z = back of the bird
  let cavSum = 0;
  for (let i = 0; i < n; i++) {
    const r = rep[i];
    const wt = sw.map((f) => Math.max(0, f[r]));
    const tot = wt.reduce((x, y) => x + y, 0) || 1;
    for (let k = 0; k < 7; k++) wt[k] /= tot;
    const t = Math.min(1, Math.max(0, st[r]));
    aW0.set([wt[0], wt[1], wt[2], wt[3]], i * 4);
    aW1.set([wt[4], wt[5], wt[6], t], i * 4);
    const cav = Math.min(1, sstep(cLo, cHi, raw[r]) * cavityGain);
    const cvx = sstep(vLo, vHi, raw[r]);
    // translucency only where feathers are really thin: far half of wings/tails, crest tips
    const thin = wt[4] * sstep(0.45, 0.92, t) + wt[5] * sstep(0.35, 0.92, t) + wt[3] * 0.35;
    aQ.set([cav, cvx, Math.min(1, thin), Math.max(0, -wn[r * 3 + 2])], i * 4);
    let eyeD = 9, eu = 9, ev = 9;
    for (const e of eyes) {
      const dx = P[i * 3] - e[0], dy = P[i * 3 + 1] - e[1], dz = P[i * 3 + 2] - e[2];
      const d = Math.hypot(dx, dy, dz) / eyeR;
      if (d < eyeD) {
        eyeD = d;
        eu = (dx * ua[0] + dy * ua[1] + dz * ua[2]) / eyeHalfLen;
        ev = (dx * va[0] + dy * va[1] + dz * va[2]) / eyeHalfH;
      }
    }
    aE.set([Math.max(-6, Math.min(6, eu)), Math.max(-6, Math.min(6, ev)), 0, 0], i * 4);
    const cereW = 1 - sstep(0.4, 1.0, Math.hypot(P[i * 3] - cere[0], P[i * 3 + 1] - cere[1], P[i * 3 + 2] - cere[2]) / cereR);
    aX.set([Math.min(1, Math.max(0, outS[r])), Math.min(9, eyeD), cereW, 0], i * 4);
    cavSum += cav;
  }
  geo.setAttribute('aW0', new THREE.BufferAttribute(aW0, 4));
  geo.setAttribute('aW1', new THREE.BufferAttribute(aW1, 4));
  geo.setAttribute('aQ', new THREE.BufferAttribute(aQ, 4));
  geo.setAttribute('aX', new THREE.BufferAttribute(aX, 4));
  geo.setAttribute('aE', new THREE.BufferAttribute(aE, 4));
  let minEye = 9, mnX = 9, mxX = -9, mnY = 9, mxY = -9, mnZ = 9, mxZ = -9;
  for (let i = 0; i < n; i++) {
    minEye = Math.min(minEye, aX[i * 4 + 1]);
    mnX = Math.min(mnX, P[i * 3]); mxX = Math.max(mxX, P[i * 3]); mnY = Math.min(mnY, P[i * 3 + 1]); mxY = Math.max(mxY, P[i * 3 + 1]);
    mnZ = Math.min(mnZ, P[i * 3 + 2]); mxZ = Math.max(mxZ, P[i * 3 + 2]);
  }
  return { cavMean: cavSum / n, cLo, cHi, chains: chainNames.length, minEye, posArray: pa.array.constructor.name, fit: fit.map((f) => f.map((v) => +v.toFixed(4))),
           bbox: [mnX, mxX, mnY, mxY, mnZ, mxZ].map((v) => +v.toFixed(3)) };
}

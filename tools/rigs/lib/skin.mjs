// Skin-weight solver shared by every rig builder: "tube field" weights.
//
// A creature is described as a set of TUBES: polylines through joint positions, each with a radius per point (the
// clearance from the medial path). A vertex belongs to the tubes it is close to RELATIVE TO THEIR RADIUS (a thin leg
// next to a fat torso is not swallowed by it); inside a tube the weight is the hat function along the joint chain
// (two neighbouring joints, linear), so a long serpentine body blends exactly like a curve deformer.
//   q_t(v)  = distance(v, tube t) / radius_t(at the nearest point)
//   own_t   = exp(-kappa * (q_t - min q))        normalised over tubes
//   w_joint = sum_t own_t * hat_t(joint)
// followed by Laplacian smoothing over the welded surface graph and a top-4 cut.
import { len } from './mesh.mjs';

/**
 * tube = { name, joints: number[]   (skeleton joint index of every sample point, or -1 for a pure geometric extension),
 *          pts: [x,y,z][]           (positions, same length),
 *          r: number[]              (radius at each sample),
 *          weight?: number }        (multiplier on the ownership, default 1)
 */
export function tubeWeights({ p, nW, tubes, J, kappa = 6, minRadius = 0.012 }) {
  // flatten segments
  const segs = [];
  tubes.forEach((tube, ti) => {
    for (let i = 0; i + 1 < tube.pts.length; i++) {
      const a = tube.pts[i], b = tube.pts[i+1];
      const dx = b[0]-a[0], dy = b[1]-a[1], dz = b[2]-a[2], l2 = dx*dx + dy*dy + dz*dz;
      segs.push({ ti, i, ax: a[0], ay: a[1], az: a[2], dx, dy, dz, l2 });
    }
  });
  const W = new Float32Array(nW * J);
  const bestQ = new Float64Array(tubes.length), bestSeg = new Int32Array(tubes.length), bestT = new Float64Array(tubes.length);
  const stats = { orphan: 0 };
  for (let v = 0; v < nW; v++) {
    const x = p[v*3], y = p[v*3+1], z = p[v*3+2];
    bestQ.fill(Infinity);
    for (let si = 0; si < segs.length; si++) {
      const s = segs[si];
      const rj = tubes[s.ti].reject;
      if (rj && rj(x, y, z)) continue;
      let t = s.l2 > 0 ? ((x - s.ax) * s.dx + (y - s.ay) * s.dy + (z - s.az) * s.dz) / s.l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = x - (s.ax + s.dx * t), ey = y - (s.ay + s.dy * t), ez = z - (s.az + s.dz * t);
      const d = Math.sqrt(ex*ex + ey*ey + ez*ez);
      const tube = tubes[s.ti];
      const r = Math.max(minRadius, tube.r[s.i] * (1 - t) + tube.r[s.i+1] * t);
      const q = d / r / (tube.weight ?? 1);
      if (q < bestQ[s.ti]) { bestQ[s.ti] = q; bestSeg[s.ti] = si; bestT[s.ti] = t; }
    }
    let qmin = Infinity;
    for (let ti = 0; ti < tubes.length; ti++) if (bestQ[ti] < qmin) qmin = bestQ[ti];
    let sum = 0; const own = new Float64Array(tubes.length);
    for (let ti = 0; ti < tubes.length; ti++) { own[ti] = Math.exp(-kappa * (bestQ[ti] - qmin)); sum += own[ti]; }
    for (let ti = 0; ti < tubes.length; ti++) {
      const o = own[ti] / sum;
      if (o < 1e-3) continue;
      const s = segs[bestSeg[ti]], tube = tubes[ti], t = bestT[ti];
      if (tube.basis) { for (const [j, bw] of tube.basis(s.i, t)) W[v*J + j] += o * bw; continue; }
      const j0 = tube.joints[s.i], j1 = tube.joints[s.i+1];
      if (j0 >= 0 && j1 >= 0) { W[v*J + j0] += o * (1 - t); W[v*J + j1] += o * t; }
      else if (j0 >= 0) W[v*J + j0] += o;
      else if (j1 >= 0) W[v*J + j1] += o;
      else stats.orphan++;
    }
  }
  return { W, stats };
}

/** Laplacian smoothing of dense weights over the welded graph. */
export function smoothWeights(W, adj, J, iters = 4, lam = 0.5) {
  const { start, nb, nW } = adj;
  let cur = W, nxt = new Float32Array(W.length);
  for (let it = 0; it < iters; it++) {
    for (let v = 0; v < nW; v++) {
      const c = start[v+1] - start[v];
      if (!c) { for (let j = 0; j < J; j++) nxt[v*J+j] = cur[v*J+j]; continue; }
      for (let j = 0; j < J; j++) {
        let s = 0;
        for (let e = start[v]; e < start[v+1]; e++) s += cur[nb[e]*J + j];
        nxt[v*J+j] = (1 - lam) * cur[v*J+j] + lam * s / c;
      }
    }
    [cur, nxt] = [nxt, cur];
  }
  return cur;
}

/** keep the 4 strongest influences per welded vertex, renormalised. -> { joints: Uint16Array(nW*4), weights: Float32Array(nW*4) } */
export function topInfluences(W, nW, J, k = 4) {
  const joints = new Uint16Array(nW * k), weights = new Float32Array(nW * k);
  const order = new Array(J);
  for (let v = 0; v < nW; v++) {
    for (let j = 0; j < J; j++) order[j] = j;
    order.sort((a, b) => W[v*J + b] - W[v*J + a]);
    let s = 0; for (let i = 0; i < k; i++) s += W[v*J + order[i]];
    for (let i = 0; i < k; i++) { joints[v*k+i] = order[i]; weights[v*k+i] = s > 0 ? W[v*J + order[i]] / s : (i === 0 ? 1 : 0); }
  }
  return { joints, weights };
}

/** how clean the skin is: share of vertices dominated by one joint, and the joint usage histogram */
export function weightReport(top, nW, names) {
  let dominant = 0; const use = new Float64Array(names.length);
  for (let v = 0; v < nW; v++) { if (top.weights[v*4] > 0.8) dominant++; for (let i = 0; i < 4; i++) use[top.joints[v*4+i]] += top.weights[v*4+i]; }
  return { dominantShare: dominant / nW, unused: names.filter((_, j) => use[j] < 1e-6) };
}

export { len };

/**
 * Clamped uniform cubic B-spline basis over n control joints (joint index space x in [0, n-1]). Every x has at most 4
 * non-zero weights that sum to 1, C2-continuous: the skin follows the chain like a Bendy-Bone, and the end joints are
 * interpolated exactly (weight 1 at the first and last joint). Returns [[joint, weight], ...].
 */
export function bsplineBasis(n) {
  const deg = 3, knots = [];
  for (let i = 0; i < n + deg + 1; i++) knots.push(i <= deg ? 0 : i >= n ? n - deg : i - deg);
  const g = []; for (let i = 0; i < n; i++) g.push((knots[i+1] + knots[i+2] + knots[i+3]) / 3);   // Greville abscissae
  const N = (i, k, u) => {
    if (k === 0) return (knots[i] <= u && u < knots[i+1]) || (u === knots[n] && knots[i] < knots[i+1] && knots[i+1] === knots[n]) ? 1 : 0;
    let r = 0;
    const d1 = knots[i+k] - knots[i], d2 = knots[i+k+1] - knots[i+1];
    if (d1 > 0) r += (u - knots[i]) / d1 * N(i, k - 1, u);
    if (d2 > 0) r += (knots[i+k+1] - u) / d2 * N(i + 1, k - 1, u);
    return r;
  };
  return (x) => {
    x = Math.min(Math.max(x, 0), n - 1);
    const i0 = Math.min(n - 2, Math.floor(x)), t = x - i0;
    const u = g[i0] + (g[i0+1] - g[i0]) * t;
    const out = [];
    for (let j = 0; j < n; j++) { const w = N(j, deg, u); if (w > 1e-6) out.push([j, w]); }
    return out;
  };
}

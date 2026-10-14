// Phoenix skeleton definition (model space, bird faces -Z, wings rise along +Y, tails fall along -Y).
// All joints keep an identity rest rotation so local axes == world axes (easy to animate/procedurally drive).

const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const add = (a, b) => a.map((v, i) => v + b[i]);
const len = (a) => Math.hypot(...a);
const scale = (a, s) => a.map((v) => v * s);

// resample a polyline into n evenly spaced points (incl. both ends)
function resample(pts, n) {
  const seg = [0];
  for (let i = 1; i < pts.length; i++) seg.push(seg[i-1] + len(sub(pts[i], pts[i-1])));
  const total = seg[seg.length-1], out = [];
  for (let k = 0; k < n; k++) {
    const d = (total * k) / (n - 1);
    let i = 1; while (i < pts.length - 1 && seg[i] < d) i++;
    out.push(lerp(pts[i-1], pts[i], (d - seg[i-1]) / ((seg[i] - seg[i-1]) || 1)));
  }
  return out;
}

export function buildSkeleton() {
  const joints = [];            // {name, parent, pos, next, ext, group}
  const byName = new Map();
  const J = (name, parent, pos, group, extra = {}) => {
    const j = { name, parent, pos, group, next: null, ext: 1.0, ...extra };
    joints.push(j); byName.set(name, j); return j;
  };
  // chain: names get `${prefix}_${i}`; first joint parents to `parent`
  const chain = (prefix, parent, pts, group, names, extra = {}) => {
    const made = [];
    pts.forEach((p, i) => {
      const nm = names ? names[i] : `${prefix}_${i+1}`;
      const j = J(nm, i === 0 ? parent : made[i-1].name, p, group, extra);
      if (i > 0) made[i-1].next = nm;
      made.push(j);
    });
    return made;
  };

  // ---- core body ----
  J('Root',   null,     [0.00, -0.13, 0.03], 'body'); 
  J('Spine1', 'Root',   [0.00, -0.06, 0.01], 'body');
  J('Spine2', 'Spine1', [0.00,  0.00, -0.03], 'body');
  J('Neck1',  'Spine2', [0.00,  0.035, -0.06], 'neck');
  J('Neck2',  'Neck1',  [0.00,  0.050, -0.08], 'neck');
  J('Head',   'Neck2',  [0.00,  0.050, -0.095], 'head');
  J('Beak',   'Head',   [0.00,  0.035, -0.125], 'head', { ext: 1.2 });
  J('Crest1', 'Head',   [0.00,  0.070, -0.105], 'head');
  J('Crest2', 'Crest1', [0.00,  0.090, -0.115], 'head', { ext: 1.4 });
  byName.get('Root').next = 'Spine1'; byName.get('Spine1').next = 'Spine2';
  byName.get('Spine2').next = 'Neck1'; byName.get('Neck1').next = 'Neck2';
  byName.get('Neck2').next = 'Head'; byName.get('Head').next = 'Beak';
  byName.get('Crest1').next = 'Crest2';

  // ---- wings (6 bones each) ----
  const wingNames = (s) => [`Wing_${s}_Shoulder`, `Wing_${s}_Arm`, `Wing_${s}_Forearm`, `Wing_${s}_Hand`, `Wing_${s}_Tip1`, `Wing_${s}_Tip2`];
  const wingL = resample([[-0.045, 0.045, -0.03], [-0.12, 0.17, -0.08], [-0.261, 0.384, -0.165]], 6);
  const wingR = resample([[ 0.035, 0.040,  0.02], [ 0.12, 0.22,  0.08], [ 0.258, 0.497,  0.143]], 6);
  chain(null, 'Spine2', wingL, 'wingL', wingNames('L'), { ext: 0.5 });
  chain(null, 'Spine2', wingR, 'wingR', wingNames('R'), { ext: 0.5 });

  // ---- tails: three plumes hanging from the pelvis ----
  const tailA = resample([[-0.04, -0.12, 0.00], [-0.098, -0.228, -0.125], [-0.09, -0.295, -0.285], [-0.12, -0.325, -0.335]], 5);
  const tailB = resample([[ 0.02, -0.12, 0.05], [ 0.027, -0.214, 0.19], [ 0.142, -0.386, 0.245], [ 0.12, -0.42, 0.32]], 5);
  const tailC = resample([[ 0.00, -0.14, 0.04], [ 0.08, -0.326, 0.056], [ 0.154, -0.416, -0.078], [ 0.16, -0.49, -0.10]], 5);
  chain('Tail_A', 'Root', tailA, 'tailA', null, { ext: 0.6 });
  chain('Tail_B', 'Root', tailB, 'tailB', null, { ext: 0.6 });
  chain('Tail_C', 'Root', tailC, 'tailC', null, { ext: 0.6 });

  // ---- ribbons / streamers (legs & trailing tendrils) ----
  chain('Ribbon_L1', 'Spine1', resample([[-0.03, -0.07, 0.01], [-0.10, -0.08, 0.02], [-0.17, -0.095, 0.03], [-0.225, -0.13, 0.03]], 4), 'ribL1', null, { ext: 0.8 });
  chain('Ribbon_L2', 'Spine1', resample([[-0.04, -0.10, 0.02], [-0.10, -0.15, 0.025], [-0.15, -0.18, 0.03], [-0.20, -0.20, 0.02]], 4), 'ribL2', null, { ext: 0.8 });
  chain('Ribbon_R1', 'Spine1', resample([[ 0.03, -0.08, 0.05], [ 0.08, -0.07, 0.09], [ 0.12, -0.08, 0.12], [ 0.14, -0.11, 0.15]], 4), 'ribR1', null, { ext: 0.8 });
  chain('Ribbon_R2', 'Spine1', resample([[ 0.03, -0.10, 0.05], [ 0.07, -0.13, 0.10], [ 0.11, -0.15, 0.13], [ 0.14, -0.16, 0.19]], 4), 'ribR2', null, { ext: 0.8 });

  return { joints, byName };
}

// capsule segment for each joint: pos -> next.pos, or an extension past the end
export function boneSegments({ joints, byName }) {
  return joints.map((j) => {
    const a = j.pos;
    let b;
    if (j.next) b = byName.get(j.next).pos;
    else {
      // leaf: continue in the direction of the parent segment
      const par = j.parent ? byName.get(j.parent) : null;
      let dir = par ? sub(a, par.pos) : [0, -1, 0];
      if (len(dir) < 1e-6) dir = [0, -1, 0];
      b = add(a, scale(dir, j.ext));
    }
    return { a, b };
  });
}

// Re-centre chain joints on the local mass of the mesh (mean-shift perpendicular to the chain).
// `pos` = Float32Array xyz of the bind mesh. Joint spacing along the chain is left untouched.
export function refine(sk, pos, spec) {
  const n = pos.length / 3;
  for (const { group, radius, iters = 3, damp = 0.7, skipFirst = true } of spec) {
    const js = sk.joints.filter((j) => j.group === group);
    for (let it = 0; it < iters; it++) {
      js.forEach((j, idx) => {
        if (skipFirst && idx === 0) return;
        const prev = js[Math.max(0, idx - 1)].pos, nxt = js[Math.min(js.length - 1, idx + 1)].pos;
        let t = sub(nxt, prev); const tl = len(t) || 1; t = scale(t, 1 / tl);
        let s = [0, 0, 0], c = 0; const r2 = radius * radius;
        for (let i = 0; i < n; i++) {
          const dx = pos[i*3] - j.pos[0], dy = pos[i*3+1] - j.pos[1], dz = pos[i*3+2] - j.pos[2];
          if (dx*dx + dy*dy + dz*dz > r2) continue;
          s[0] += pos[i*3]; s[1] += pos[i*3+1]; s[2] += pos[i*3+2]; c++;
        }
        if (c < 20) return;
        const m = scale(s, 1 / c), d = sub(m, j.pos);
        const along = d[0]*t[0] + d[1]*t[1] + d[2]*t[2];
        const perp = sub(d, scale(t, along));       // drop the along-chain component
        j.pos = add(j.pos, scale(perp, damp));
      });
    }
  }
}

// Skeleton for the second (sculpted, 179k-tri) phoenix. Same conventions as skeleton.mjs, so anim.mjs / the site keep
// working: bird faces -Z, wings rise along +Y, every joint has an identity rest rotation (local axes == world axes).
// Model space = what prep-model.mjs outputs (y in [-1, 1], x in about [-0.48, 0.48], z in about [-0.42, 0.42]).
// All coordinates below were read from the mesh (see tools/centroids.mjs, tails.mjs, landmarks.mjs):
//   * the body axis sits at x ~ -0.06 (the whole bird is turned a little), the head at (-0.11, 0.53, -0.20)
//   * wings sweep BACK (+z) as they rise; the left (-X) wing sweeps more than the right one (3/4 pose)
//   * the tail is a radial bell of ~30 feathers (x -0.47..0.42, z -0.40..0.40 at y ~ -0.85), not a few plumes
// Joint names are kept compatible with anim.mjs: Wing_{L,R}_*, Tail_<id>_<1..5>; Leg_* is new.

const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const len = (a) => Math.hypot(...a);
const R3 = (a) => a.map((v) => Math.round(v * 1e4) / 1e4);

function resample(pts, n) {
  const seg = [0];
  for (let i = 1; i < pts.length; i++) seg.push(seg[i-1] + len(sub(pts[i], pts[i-1])));
  const total = seg[seg.length-1], out = [];
  for (let k = 0; k < n; k++) {
    const d = (total * k) / (n - 1);
    let i = 1; while (i < pts.length - 1 && seg[i] < d) i++;
    out.push(R3(lerp(pts[i-1], pts[i], (d - seg[i-1]) / ((seg[i] - seg[i-1]) || 1))));
  }
  return out;
}

export const TAIL_IDS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

// `scale` = half-height of the prepped mesh (1 -> the coordinates below as written; 0.5 -> site scale, y in [-0.5, 0.5])
export function buildSkeletonV2(scale = 1) {
  const joints = [], byName = new Map();
  const J = (name, parent, pos, group, extra = {}) => {
    const j = { name, parent, pos, group, next: null, ext: 1.0, ...extra };
    joints.push(j); byName.set(name, j); return j;
  };
  const chain = (parent, pts, group, names, extra = {}) => {
    const made = [];
    pts.forEach((p, i) => {
      const j = J(names[i], i === 0 ? parent : made[i-1].name, p, group, extra);
      if (i > 0) made[i-1].next = names[i];
      made.push(j);
    });
    return made;
  };

  // ---- core body ----
  J('Root',   null,     [-0.06, -0.20,  0.03], 'body');
  J('Spine1', 'Root',   [-0.06, -0.02, -0.07], 'body');
  J('Spine2', 'Spine1', [-0.06,  0.18, -0.13], 'body');
  J('Neck1',  'Spine2', [-0.08,  0.33, -0.15], 'neck');
  J('Neck2',  'Neck1',  [-0.10,  0.44, -0.17], 'neck');
  J('Head',   'Neck2',  [-0.11,  0.53, -0.20], 'head');
  J('Beak',   'Head',   [-0.08,  0.49, -0.25], 'head', { ext: 0.9 });
  // crest: the tufts on top of the head. (There is NO long plume: the thin spike seen from the side is the leading
  // primary of the +X wing. A 3rd crest bone put there grabbed the wing tip and tore needles out of it.)
  J('Crest1', 'Head',   [-0.15,  0.66, -0.16], 'crest');
  J('Crest2', 'Crest1', [-0.17,  0.76, -0.12], 'crest', { ext: 0.5 });
  for (const [a, b] of [['Root', 'Spine1'], ['Spine1', 'Spine2'], ['Spine2', 'Neck1'], ['Neck1', 'Neck2'], ['Neck2', 'Head'],
                        ['Head', 'Beak'], ['Crest1', 'Crest2']]) byName.get(a).next = b;

  // ---- wings: centroid trajectory of the feather mass, 6 bones each ----
  const wn = (s) => [`Wing_${s}_Shoulder`, `Wing_${s}_Arm`, `Wing_${s}_Forearm`, `Wing_${s}_Hand`, `Wing_${s}_Tip1`, `Wing_${s}_Tip2`];
  const wingL = resample([[-0.14, 0.12, -0.08], [-0.27, 0.30, -0.02], [-0.34, 0.50, 0.10], [-0.33, 0.72, 0.21], [-0.28, 0.90, 0.28], [-0.25, 1.00, 0.31]], 6);
  const wingR = resample([[ 0.04, 0.12, -0.12], [ 0.15, 0.28, -0.17], [ 0.23, 0.50, -0.15], [ 0.28, 0.74, -0.08], [ 0.31, 0.92,  0.04], [ 0.32, 1.00, 0.08]], 6);
  chain('Spine2', wingL, 'wingL', wn('L'), { ext: 0.4 });
  chain('Spine2', wingR, 'wingR', wn('R'), { ext: 0.4 });

  // ---- tail: 8 radial chains (a bell around the vertical tail axis), 5 bones each ----
  const rootPos = [-0.06, -0.20, 0.03], tipC = [-0.02, -0.92, 0.08];
  const S = [0.10, 0.32, 0.54, 0.76, 0.96];
  TAIL_IDS.forEach((id, k) => {
    const phi = (k / TAIL_IDS.length) * Math.PI * 2;
    const dir = [0.44 * Math.cos(phi), 0, 0.36 * Math.sin(phi)];
    const pts = S.map((s) => { const c = lerp(rootPos, tipC, s), r = Math.pow(s, 1.3); return R3([c[0] + dir[0] * r, c[1], c[2] + dir[2] * r]); });
    chain('Root', pts, `tail${id}`, S.map((_, i) => `Tail_${id}_${i + 1}`), { ext: 0.4 });
  });

  // ---- legs / talons, tucked in front of the tail (3 bones each) ----
  chain('Spine1', [[-0.13, -0.12, -0.10], [-0.16, -0.25, -0.19], [-0.14, -0.36, -0.22]], 'legL', ['Leg_L_1', 'Leg_L_2', 'Leg_L_3'], { ext: 0.5 });
  chain('Spine1', [[ 0.01, -0.12, -0.12], [ 0.03, -0.25, -0.20], [ 0.04, -0.36, -0.23]], 'legR', ['Leg_R_1', 'Leg_R_2', 'Leg_R_3'], { ext: 0.5 });

  if (scale !== 1) for (const j of joints) j.pos = R3(j.pos.map((v) => v * scale));
  return { joints, byName };
}

export const CHAIN_GROUPS_V2 = ['wingL', 'wingR', 'crest', ...TAIL_IDS.map((id) => `tail${id}`), 'legL', 'legR'];

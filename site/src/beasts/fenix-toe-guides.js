// Measured in the Meshy phoenix's sculpt space. Each foot has three forward
// digits and a hallux. Keep these guides shared by the runtime and GLB builder.
export const FENIX_TOE_GUIDES = [
  { side: 'A', ankle: 'Bone_003', leg: ['Bone_006', 'Bone_005', 'Bone_004'], old: ['Bone_002', 'Bone_003', 'Bone_004'], toes: [
    { root: [-0.881, 0.079, 0.326], tip: [-1.020, 0.066, 0.311] },
    { root: [-0.881, 0.079, 0.359], tip: [-0.997, 0.061, 0.449] },
    { root: [-0.850, 0.079, 0.369], tip: [-0.863, 0.055, 0.523] },
    { root: [-0.817, 0.087, 0.283], tip: [-0.692, 0.070, 0.174] },
  ] },
  { side: 'B', ankle: 'Bone_010', leg: ['Bone_013', 'Bone_012', 'Bone_011'], old: ['Bone_009', 'Bone_010', 'Bone_011'], toes: [
    { root: [-1.176, 0.076, -0.043], tip: [-1.329, 0.062, -0.031] },
    { root: [-1.174, 0.076, -0.078], tip: [-1.307, 0.060, -0.133] },
    { root: [-1.163, 0.076, -0.008], tip: [-1.239, 0.059, 0.065] },
    { root: [-1.096, 0.077, -0.073], tip: [-0.958, 0.066, -0.104] },
  ] },
];

export function toeProjection(point, toe) {
  const a = toe.root, b = toe.tip;
  const dx = b[0] - a[0], dz = b[2] - a[2], l2 = dx * dx + dz * dz;
  const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[2] - a[2]) * dz) / l2));
  return { t, distance: Math.hypot(point[0] - a[0] - t * dx, point[2] - a[2] - t * dz) };
}

export const toeCenters = (toe) => [0, 0.48, 0.80].map((t) => toe.root.map((x, k) => x + (toe.tip[k] - x) * t));

// Retain the original ankle weights at the base; the shaft and claw use only
// their own phalanges. Neighbours blend over each hinge, never across digits.
export function toeWeights(point, toe) {
  const { t } = toeProjection(point, toe);
  const alpha = Math.min(1, Math.max(0, t / 0.27));
  const s = t < 0.48 ? t / 0.48 : 1 + (t - 0.48) / 0.32;
  const first = Math.min(1, Math.floor(Math.min(2, s)));
  const f = Math.min(1, s - first), blend = f * f * (3 - 2 * f);
  return { alpha: alpha * alpha * (3 - 2 * alpha), first, blend };
}

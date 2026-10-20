// MountainSummit — the hero peak. Its macro shape is analytic (three warped arêtes with
// steep faces between them, a small rock perch at the top) and it is merged into the
// procedural range with a smooth max, so both share one continuous height function.
// The near-field mesh is a dense radial grid (sub-decimetre spacing at the perch) that
// shares the same bake/shader path as the far terrain.
import * as THREE from 'three';

export const SUMMIT = {
  perch: new THREE.Vector3(0, 0, 0), // top of the peak (world)
  steepFaces: 1.72, steepRidges: 0.86, exponent: 1.065, twist: 0.42,
  nearRadius: 420, // radius covered by the dense summit mesh (m)
};

export const SUMMIT_GLSL = /* glsl */`
uniform vec4 uSummitA; // x faces steepness, y ridge steepness, z exponent, w twist
float summitHeight(vec2 p, out float ridge){
  float r = length(p);
  // polar angle with its wrap seam turned to the far side of the peak (−Z)
  float a = r > 1e-4 ? atan(-p.x, p.y) : 0.0;
  float wa = a + uSummitA.w * sin(r*0.0045 + 1.3) + 0.22*sin(r*0.013 + a*2.0) + 0.16*vnoise(p*0.011 + 3.7);
  ridge = pow(abs(cos(1.5*(wa - 2.1))), 3.0);
  float k = mix(uSummitA.x, uSummitA.y, ridge);
  float e = uSummitA.z;
  float h = -k * (pow(r + 2.0, e) - pow(2.0, e));
  h -= 0.06 * r * r * (1.0 - smoothstep(0.0, 3.0, r));
  // flank ribs and couloirs: ridged noise elongated down the fall line (polar domain,
  // blended across the angular wrap so it stays seamless)
  float sx = 2.0 + 0.035 * r;
  vec2 q0 = vec2(wa * sx, r * 0.05), q1 = vec2((wa - 6.2831853) * sx, r * 0.05);
  float bw = clamp((a + 3.14159265) / 6.2831853, 0.0, 1.0);
  float n0 = mix(vnoise(q0), vnoise(q1), bw), n1 = mix(vnoise(q0*2.3 + 7.1), vnoise(q1*2.3 + 7.1), bw);
  float rib = 1.0 - abs(n0); rib *= rib; float rib2 = 1.0 - abs(n1); rib2 *= rib2;
  float ramp = smoothstep(2.5, 22.0, r);
  h += (rib*0.8 + rib2*0.4 - 0.5) * min(r*0.16, 22.0) * ramp;
  // gendarmes along the aretes
  float g = vnoise(p * 0.035 + 11.0);
  h += smoothstep(0.3, 0.9, g) * smoothstep(0.35, 1.0, ridge) * min(r*0.1, 10.0) * smoothstep(8.0, 40.0, r);
  return h;
}
`;

// Radial grid with exponential ring spacing. mode 0 (from the centre): r_i = a*(exp(b*i) - 1);
// mode 1 (annulus): r_i = r0*exp(b*i). Both keep the relative ring spacing ~b, so the
// summit mesh and the far-range mesh meet with matching density on the shared ring.
export function radialGrid({ r0, r1, rings, segments, b: bIn }) {
  let mode, a, b;
  if (r0 <= 0) { mode = 0; b = bIn; a = r1 / (Math.exp(b * (rings - 1)) - 1); }
  else { mode = 1; a = r0; b = Math.log(r1 / r0) / (rings - 1); }
  const ringR = i => (mode === 0 ? a * (Math.exp(b * i) - 1) : a * Math.exp(b * i));
  const pos = new Float32Array(rings * segments * 3);
  const grid = new Float32Array(rings * segments * 2);
  let k = 0;
  for (let i = 0; i < rings; i++) {
    const r = ringR(i);
    for (let j = 0; j < segments; j++, k++) {
      const t = (j / segments) * Math.PI * 2;
      pos[k * 3] = Math.cos(t) * r; pos[k * 3 + 1] = 0; pos[k * 3 + 2] = Math.sin(t) * r;
      grid[k * 2] = j; grid[k * 2 + 1] = i;
    }
  }
  const idx = new Uint32Array((rings - 1) * segments * 6);
  let q = 0;
  for (let i = 0; i < rings - 1; i++) for (let j = 0; j < segments; j++) {
    const j1 = (j + 1) % segments;
    const v00 = i * segments + j, v01 = i * segments + j1, v10 = (i + 1) * segments + j, v11 = (i + 1) * segments + j1;
    idx[q++] = v00; idx[q++] = v10; idx[q++] = v01;
    idx[q++] = v01; idx[q++] = v10; idx[q++] = v11;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aGrid', new THREE.BufferAttribute(grid, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, -600, 0), r1 * 1.05);
  return { geometry: g, params: new THREE.Vector4(mode, a, b, segments), rings, segments, r0, r1, ringR };
}

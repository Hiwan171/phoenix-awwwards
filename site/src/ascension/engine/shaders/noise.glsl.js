// Shared GLSL noise library (value noise with analytic derivatives, 3D noise, fbm).
export const NOISE_GLSL = /* glsl */`
#ifndef PA_NOISE
#define PA_NOISE
#ifndef PI
#define PI 3.141592653589793
#endif
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3){ p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
// value noise in [-1,1] with analytic derivatives (x: value, yz: gradient)
vec3 noised(vec2 x){
  vec2 p = floor(x); vec2 w = fract(x);
  vec2 u = w*w*w*(w*(w*6.0-15.0)+10.0);
  vec2 du = 30.0*w*w*(w*(w-2.0)+1.0);
  float a = hash12(p), b = hash12(p+vec2(1.0,0.0)), c = hash12(p+vec2(0.0,1.0)), d = hash12(p+vec2(1.0,1.0));
  float k1 = b-a, k2 = c-a, k4 = a-b-c+d;
  return vec3(-1.0 + 2.0*(a + k1*u.x + k2*u.y + k4*u.x*u.y), 2.0*du*vec2(k1 + k4*u.y, k2 + k4*u.x));
}
float vnoise(vec2 x){
  vec2 p = floor(x); vec2 w = fract(x); vec2 u = w*w*(3.0-2.0*w);
  float a = hash12(p), b = hash12(p+vec2(1.0,0.0)), c = hash12(p+vec2(0.0,1.0)), d = hash12(p+vec2(1.0,1.0));
  return -1.0 + 2.0*mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}
float vnoise3(vec3 x){
  vec3 p = floor(x); vec3 w = fract(x); vec3 u = w*w*(3.0-2.0*w);
  float n000 = hash13(p), n100 = hash13(p+vec3(1,0,0)), n010 = hash13(p+vec3(0,1,0)), n110 = hash13(p+vec3(1,1,0));
  float n001 = hash13(p+vec3(0,0,1)), n101 = hash13(p+vec3(1,0,1)), n011 = hash13(p+vec3(0,1,1)), n111 = hash13(p+vec3(1,1,1));
  return -1.0 + 2.0*mix(mix(mix(n000,n100,u.x), mix(n010,n110,u.x), u.y), mix(mix(n001,n101,u.x), mix(n011,n111,u.x), u.y), u.z);
}
const mat2 M2 = mat2(0.80, 0.60, -0.60, 0.80);
const mat2 M2I = mat2(0.80, -0.60, 0.60, 0.80);
float fbm2(vec2 p, int oct){ float a = 0.0, b = 0.5; for (int i = 0; i < 12; i++){ if (i >= oct) break; a += b*vnoise(p); b *= 0.5; p = M2*p*2.03; } return a; }
float fbm3(vec3 p, int oct){ float a = 0.0, b = 0.5; for (int i = 0; i < 8; i++){ if (i >= oct) break; a += b*vnoise3(p); b *= 0.5; p = p*2.02 + vec3(1.7, 9.2, 3.1); } return a; }
// iq-style eroded fbm: derivative-damped octaves give sharp crests and smooth valleys
float erodedFbm(vec2 p, int oct){
  float a = 0.0, b = 1.0; vec2 d = vec2(0.0);
  for (int i = 0; i < 12; i++){ if (i >= oct) break; vec3 n = noised(p); d += n.yz; a += b*n.x/(1.0 + dot(d,d)); b *= 0.5; p = M2*p*2.0; }
  return a;
}
// ridged multifractal (Musgrave) in [0, ~1]
float ridgedMF(vec2 p, int oct){
  float sum = 0.0, amp = 0.5, prev = 1.0, norm = 0.0;
  for (int i = 0; i < 12; i++){ if (i >= oct) break; float n = 1.0 - abs(vnoise(p)); n *= n; sum += n*amp*prev; norm += amp; prev = clamp(n*1.6, 0.0, 1.0); amp *= 0.5; p = M2*p*2.05 + vec2(3.1, 1.7); }
  return sum / norm;
}
// curl of a 3D noise potential (for turbulent motion)
vec3 curl3(vec3 p){
  const float e = 0.1;
  float n1 = vnoise3(p + vec3(0, e, 0)), n2 = vnoise3(p - vec3(0, e, 0));
  float n3 = vnoise3(p + vec3(0, 0, e)), n4 = vnoise3(p - vec3(0, 0, e));
  float n5 = vnoise3(p + vec3(e, 0, 0)), n6 = vnoise3(p - vec3(e, 0, 0));
  float m1 = vnoise3(p.yzx + vec3(0, e, 0) + 31.0), m2 = vnoise3(p.yzx - vec3(0, e, 0) + 31.0);
  float m3 = vnoise3(p.yzx + vec3(0, 0, e) + 31.0), m4 = vnoise3(p.yzx - vec3(0, 0, e) + 31.0);
  return vec3((n1 - n2) - (m3 - m4), (n3 - n4) - (n5 - n6), (m1 - m2) - (n1 - n2)) / (2.0*e);
}
float ign(vec2 px, float frame){ px += 5.588238 * mod(frame, 64.0); return fract(52.9829189 * fract(0.06711056*px.x + 0.00583715*px.y)); }
#endif
`;

// CPU mirror of a small 3D value noise (used by the wind field / particles)
function h3(x, y, z) { let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
export function vnoise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const l = (a, b, t) => a + (b - a) * t;
  const x00 = l(h3(xi, yi, zi), h3(xi + 1, yi, zi), u), x10 = l(h3(xi, yi + 1, zi), h3(xi + 1, yi + 1, zi), u);
  const x01 = l(h3(xi, yi, zi + 1), h3(xi + 1, yi, zi + 1), u), x11 = l(h3(xi, yi + 1, zi + 1), h3(xi + 1, yi + 1, zi + 1), u);
  return l(l(x00, x10, v), l(x01, x11, v), w) * 2 - 1;
}

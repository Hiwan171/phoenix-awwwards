// Colour looks of the Shadertoy sky + the lighting rig of the phoenix. ONE source for the hero (stage.js) and the lab (sky-test.js).
// Why a look exists: the sky tint goes through pow(2.6)+tonemap (so it is hugely amplified) and the phoenix used to be
// lit by the sky's own orange. A look decouples both: a muted sky, and a phoenix lit by neutral-warm light so her
// albedo is what reads, not the sunset.
// Form-giving rig: the sun stays behind (rim only); a strong neutral-warm key from front-left-above carves the
// body, and ambient/env are nearly off so shadows go deep crimson. Flat frontal fill is what made her read as one
// orange "blanket". Positions: camera sits at -z looking +z, the sun is at +z.
export const RIG_FORM = { key: 0xffe9cf, keyI: 3.0, fill: 0xfff0e0, fillI: 2.3, fillPos: [-2.6, 1.6, -1.2],
                   hemiSky: 0xdfe6ee, hemiGround: 0x3a2418, hemiI: 0.12, env: 0.06, exposure: 0.92, rim: 0.5, rimCol: [1.0, 0.82, 0.55] };
export const LOOKS = {
  now:   { rig: null, sat: 1, defines: {} },
  dusty: { rig: RIG_FORM, sat: 0.9, defines: {
    SKY_HORIZON_TINT: 'vec3(1.0, 0.84, 0.62)', SKY_TOP_TINT: 'vec3(0.80, 0.82, 0.84)', SKY_TOP_RANGE: '0.55',
    SEA_TINT: 'vec3(0.78, 0.70, 0.62)', SEA_GAIN: '0.55' } },
  teal:  { rig: RIG_FORM, sat: 1, defines: {
    SKY_HORIZON_TINT: 'vec3(1.0, 0.78, 0.50)', SKY_TOP_TINT: 'vec3(0.70, 0.80, 0.88)', SKY_TOP_RANGE: '0.5',
    SEA_TINT: 'vec3(0.62, 0.62, 0.62)', SEA_GAIN: '0.55' } },
  // refinements around "teal": orange kept only near the sun, slate (not blue) overhead, neutral dark sea
  golden: { rig: RIG_FORM, sat: 0.95, defines: {
    SKY_HORIZON_TINT: 'vec3(1.0, 0.72, 0.42)', SKY_TOP_TINT: 'vec3(0.80, 0.84, 0.88)', SKY_TOP_RANGE: '0.55',
    SEA_TINT: 'vec3(0.64, 0.64, 0.64)', SEA_GAIN: '0.75', SKY_EXPOSURE: '0.82', SEA_DARK: '0.62' } },
  dusk:   { rig: { ...RIG_FORM, rim: 0.55 }, sat: 0.9, defines: {
    SKY_HORIZON_TINT: 'vec3(1.0, 0.64, 0.36)', SKY_TOP_TINT: 'vec3(0.72, 0.76, 0.84)', SKY_TOP_RANGE: '0.5',
    SEA_TINT: 'vec3(0.58, 0.58, 0.60)', SEA_GAIN: '0.5', SKY_EXPOSURE: '0.78', SEA_DARK: '0.35' } },
  soft:   { rig: RIG_FORM, sat: 0.9, defines: {
    SKY_HORIZON_TINT: 'vec3(1.0, 0.76, 0.50)', SKY_TOP_TINT: 'vec3(0.84, 0.84, 0.86)', SKY_TOP_RANGE: '0.6',
    SEA_TINT: 'vec3(0.66, 0.64, 0.62)', SEA_GAIN: '0.55', SKY_EXPOSURE: '0.85' } },
  smoke: { rig: { ...RIG_FORM, rim: 0.4 }, sat: 0.7, defines: {
    SKY_HORIZON_TINT: 'vec3(1.0, 0.88, 0.72)', SKY_TOP_TINT: 'vec3(0.86, 0.84, 0.82)', SKY_TOP_RANGE: '0.6',
    SEA_TINT: 'vec3(0.70, 0.66, 0.62)', SEA_GAIN: '0.55', SKY_EXPOSURE: '0.9' } },
};

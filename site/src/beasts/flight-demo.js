// A demo flight over an empty scenery, to test the phoenix's whole repertoire against the scroll:
// hover -> climb -> level flight (turn right) -> glide (turn left) -> dive / swoop -> pull up -> approach -> flare -> touch down -> fold.
// The waypoints are in scene units (the bird is 1 tall); y = 0 is the ground. `w` anchors a key to a waypoint (by arc length).
import { createPath, createTimeline } from './flight-path.js';

export const DEMO_POINTS = [
  [0, 3.0, 0],        // 0  hover
  [0, 3.6, -6],       // 1  climb
  [3, 5.0, -14],      // 2  climb, turning right
  [7, 5.6, -22],      // 3  level flight
  [6.5, 5.6, -27],    // 4  glide, high
  [2, 1.8, -32],      // 5  dive / swoop (a steep drop: ~35 degrees)
  [-3, 3.4, -39],     // 6  pull up
  [-7, 3.0, -47],     // 7  approach
  [-7, 1.0, -55],     // 8  flare
  [-7, 0.5, -58],     // 9  touch down (the bird's centre is 0.5 above its feet)
  [-7, 0.5, -60.5],   // 10 standing: the wings fold here
];

// key = progress anchor (waypoint index w, plus an optional offset in waypoints) and the pose parameters
const KEYS = [
  { w: 0,   beats: 0,    flap: 0.60, open: 1.00, sweep: 0.00, legs: 0.10, tail: 0.50, fly: 0.35, stretch: 0.20, alert: 0.90, ground: 0.00, pitchBias: 0.00 },   // hovering, a slow beat
  { w: 1,   beats: 3.0,  flap: 1.00, open: 1.00, sweep: 0.00, legs: 0.55, tail: 0.40, fly: 0.85, stretch: 0.50, alert: 0.70, ground: 0.00, pitchBias: 0.12 },   // climbing: strong beats, legs tuck
  { w: 2,   beats: 9.0,  flap: 0.90, open: 1.00, sweep: 0.10, legs: 0.85, tail: 0.35, fly: 1.00, stretch: 0.50, alert: 0.55, ground: 0.00, pitchBias: 0.08 },
  { w: 3,   beats: 14.0, flap: 0.45, open: 1.00, sweep: 0.00, legs: 0.85, tail: 0.50, fly: 1.00, stretch: 0.60, alert: 0.50, ground: 0.00, pitchBias: 0.00 },   // level, easing into the glide
  { w: 4,   beats: 15.5, flap: 0.04, open: 1.00, sweep: 0.00, legs: 0.85, tail: 0.80, fly: 1.00, stretch: 1.00, alert: 0.80, ground: 0.00, pitchBias: 0.00 },   // glide: wings still, tail fanned
  { w: 5,   beats: 15.5, flap: 0.00, open: 0.92, sweep: 0.28, legs: 1.00, tail: 0.45, fly: 1.00, stretch: 1.00, alert: 0.10, ground: 0.00, pitchBias: -0.08 },   // swoop: wings open, a little swept (half-closed wings read as stumps from the front)
  { w: 6,   beats: 19.0, flap: 1.00, open: 1.00, sweep: 0.20, legs: 0.80, tail: 0.70, fly: 0.90, stretch: 0.50, alert: 0.50, ground: 0.00, pitchBias: 0.14 },   // pull up: wings open, strong beats
  { w: 7,   beats: 23.0, flap: 0.90, open: 1.00, sweep: 0.00, legs: -0.35, tail: 1.00, fly: 0.55, stretch: 0.20, alert: 0.70, ground: 0.00, pitchBias: 0.12 },  // approach: legs reach forward
  { w: 8,   beats: 26.0, flap: 1.00, open: 1.00, sweep: 0.00, legs: -1.00, tail: 1.00, fly: 0.25, stretch: 0.00, alert: 0.60, ground: 0.15, pitchBias: 0.55 },  // flare: braking beats
  { w: 9,   beats: 27.2, flap: 0.35, open: 1.00, sweep: 0.00, legs: -0.60, tail: 0.80, fly: 0.10, stretch: 0.00, alert: 0.90, ground: 1.00, pitchBias: 0.30 },  // touch down
  { w: 9.55, beats: 27.6, flap: 0.10, open: 0.45, sweep: 0.20, legs: 0.00, tail: 0.50, fly: 0.00, stretch: 0.00, alert: 1.00, ground: 1.00, pitchBias: 0.00 },  // standing: the wings come in
  { w: 10,  beats: 27.8, flap: 0.00, open: 0.00, sweep: 0.00, legs: 0.00, tail: 0.50, fly: 0.00, stretch: 0.00, alert: 1.00, ground: 1.00, pitchBias: 0.00 },   // folded
];

const HOLD_W = 8.8;              // just before the touchdown waypoint: she stops travelling in the flare, then drops onto her feet (no foot sliding)

export function createDemoFlight(opts = {}) {
  const path = createPath(DEMO_POINTS, opts);
  const n = DEMO_POINTS.length;
  // arc-length progress of waypoint i (the curve parameter is i / (n - 1))
  const uOfT = (t) => { let lo = 0, hi = 1; for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; if (path.curve.getUtoTmapping(mid) < t) lo = mid; else hi = mid; } return (lo + hi) / 2; };
  const uOfW = (w) => uOfT(w / (n - 1));
  const keys = KEYS.map(({ w, ...rest }) => ({ u: uOfW(w), ...rest }));
  const timeline = createTimeline(keys);
  // Once the feet are on the ground she must not travel any more (the feet slid 3 body lengths while the wings folded - measured). The
  // position along the path is held at the touchdown point; just before it she decelerates (same speed going in, zero at touchdown).
  const holdU = uOfW(HOLD_W), easeLen = 0.035, u0 = holdU - easeLen;
  const pathU = (u) => { if (u <= u0) return u; const k = Math.min(1, (u - u0) / (2 * easeLen)); return u0 + easeLen * (2 * k - k * k); };
  return { path, timeline, keys, pathU, holdU, waypointU: DEMO_POINTS.map((_, i) => uOfW(i)), seconds: 48 };
}

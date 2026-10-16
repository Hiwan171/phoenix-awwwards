# Meshy rig test (15/10/2026)

Test of Meshy's auto-rigged phoenix (`Meshy_AI_Character_output.glb`, 66 MB, 594k tris, 67 bones named `Bone_NNN`).

    node tools/meshy-test/rig-tail.mjs    # one bone chain per tail strip  -> model/meshy-test/Meshy_rig.glb
    node tools/meshy-test/make-flap.mjs   # wings / body / tail clip "Flap" (2.5 s loop) -> model/meshy-test/Meshy_flap.glb
    node tools/meshy-test/serve.mjs       # viewer at http://localhost:5180/  (VS Code: "Simple Browser: Show")

Skeleton roles (found from the hierarchy, Meshy gives no names): wings `Bone_036` (z<0) / `Bone_039` (z>0) with three feather
branches each; back feathers `Bone_045`/`048`; crest `Bone_042`; tails `Bone_014`/`020`/`026`; legs `Bone_006`/`013`; root `Bone_000`.

`rig-tail.mjs`: Meshy puts the whole tail on three chains, so every strip moves in lockstep with its neighbours. The tail is made
of 19 495 separate pieces; the 49 with >= 500 vertices (and >= 80 % tail weights) become strips with their own 4-9 joint chain
(centre line = bin centroids, vertices parametrised by the closest point on it); the 9 783 small pieces follow ONE host strip.
Lessons: welding by position fuses the whole tail (pieces touch); a small piece must have a single host (nearest-vertex copy per
vertex tears it between two strips); blending weights at touching positions makes the neighbours stretch (`BLEND=1`, off).
Measured: 267 edges stretched > 4x in the clip (12 296 with the nearest-vertex copy, 17 346 with blending).

## Tiger (`Tiger-RIG.glb`, Meshy SmartRig, 57 bones, 598k tris)

    node tools/meshy-test/make-walk.mjs     # in-place walk "Walk" (1.2 s loop) -> model/meshy-test/Tiger_walk.glb
    viewer: http://localhost:5180/?f=/model/Tiger_walk.glb

Roles (faces -x, tail +x, left = +z): spine 000 001 003 002 015 014 013 (pelvis -> neck), head 030 029 028 (+ small head bones 043..056),
front legs 036..031 (L) / 042..037 (R), hind legs 027..022 (L) / 021..016 (R), tail 012..004.
Quirk: the legs are children of the neck-base (front) and chest (hind) bones, not of the pelvis/shoulders. The walk poses every
bone in WORLD space (local rotation derived from the posed parent) so the legs do not swing with the neck.
Measured over 12 phases: 509 distinct edges stretched > 4x of ~1.8 M (0.03 %), mostly tail (Bone_010), neck base (Bone_015),
front-right leg (Bone_041) and hind-left leg (Bone_026).

## Dragon (`dragon-RIG.glb`, Meshy SmartRig, 45 bones, 595k tris)

    node tools/meshy-test/make-dragon-walk.mjs   # "Walk" (1.6 s loop) -> model/meshy-test/Dragon_walk.glb
    viewer: http://localhost:5180/?f=/model/Dragon_walk.glb        (rest pose: Dragon_rest.glb)

Roles (faces -x, tail +x): pelvis 000 001 003 002; back 006 005 004; chest 028 027 026; neck + head 041..037; front legs 032..029
(L) / 036..033 (R); hind legs 016..012 (L) / 011..007 (R); tail 021..017 (only 5 bones); small chains 023/022 and 025/024.
Gait: lateral sequence + a head-to-tail lateral wave. Measured over 12 phases: 447 distinct edges (> 0.02 long) stretched > 4x,
mostly the legs (Bone_009/010/013/014/015).

### Dragon, flying / hovering

    node tools/meshy-test/make-dragon-fly.mjs    # "Hover" (3 s loop) -> model/meshy-test/Dragon_fly.glb
    viewer: http://localhost:5180/?f=/model/Dragon_fly.glb

An eastern dragon has no wings: it floats 0.55 above the ground and "swims" the air (a slow vertical + lateral wave from the head
to the tail), front legs folded forward against the chest, hind legs trailing, mane chains streaming. Measured over 12 phases: 1 900
distinct edges stretched > 4x of ~1.8 M (0.1 %), 600 of them at the tail tip (Bone_017: the last of only five tail bones).

## Tortoise / Xuanwu (`tortoise-RIG.glb`, Meshy SmartRig, 62 bones, 592k tris)

    node tools/meshy-test/make-tortoise-walk.mjs   # slow heavy "Walk" (2.4 s loop) -> model/meshy-test/Tortoise_walk.glb
    viewer: http://localhost:5180/?f=/model/Tortoise_walk.glb        (rest pose: Tortoise_rest.glb)

A tortoise with a serpent coiled on its shell. Faces +z, tail at -z; "A" legs at -x, "B" at +x. Roles: body 000 001 004 003 002;
tortoise head 027 026 (+ 042/041, 049..056..061..059); serpent neck + head 035..028 (+ 053..050, 055/054); serpent tail 025..015
(11 bones); front legs 047..043 (A) / 040..036 (B); hind legs 009..005 (A) / 014..010 (B).
Measured over 12 phases: 574 distinct edges (> 0.02 long) stretched > 4x of ~1.8 M (0.03 %), mostly head extras (Bone_055/059/061/056)
and the serpent tail tip (Bone_015).

## Phoenix, full pipeline (the one in the hero)  — 15/10/2026

    node tools/meshy-test/rig-feathers.mjs   # model/fenix/Fenix-RIG.glb -> model/meshy-test/Fenix_rig.glb   (114 feathers, 694 bones)
    node tools/meshy-test/make-fenix-motion.mjs   # -> Fenix_motion.glb  (clip "Hover", 2.5 s loop, 2 wing beats)
    node tools/meshy-test/to-web.mjs model/meshy-test/Fenix_motion.glb site/public/models/fenix-meshy-web.glb 0.2 0.01 2048 2048 1024
    node tools/meshy-test/to-web.mjs model/meshy-test/Fenix_motion.glb site/public/models/fenix-meshy-lite.glb 0.07 0.02 1024 1024 512

**What `rig-feathers.mjs` does** (generalises `rig-tail.mjs`): the mesh is made of ~19.5k separate pieces. Per region (tail, wing A
= z<0, wing B = z>0, back feathers) the pieces whose vertices are >= 80 % weighted to that region's bones and have >= 500 verts
(back feathers: 80) become *feathers* with their own chain of 4-9 joints (centre line = bin centroids re-centred by closest-point
projection; root = vertex nearest the region's base line; parent = nearest original bone segment). Smaller pieces follow ONE host
feather of the same region. Result: 114 feathers (49 tail, 10 + 20 wing, 35 back), 627 new joints, 336k of 450k vertices re-skinned.

**What `make-fenix-motion.mjs` does:** every bone is posed in WORLD space (rotation delta on top of the rest world rotation, the
local rotation derived from the posed parent). The sculpt's two wings are in different poses (A low/open, B raised/swept back: wing
axes measured 37 deg vs 73 deg from the z axis), so each shoulder gets a constant "balance" rotation (18 deg each) toward a mean pose
before the same beat is applied. Shoulder/arm/forearm/hand each add a share of the flap and of the outer-wing fold (upstroke); every
feather chain follows its parent plus a lagged wave with its own frequency (1, 2 or 3 cycles per loop so the clip closes); back
feathers follow 60 % of their wing's shoulder (rotation AND position about the shoulder pivot).

**Measured** (12 phases, edges > 4x rest length and > 0.02 long, of 1.03 M edges):

| clip | stretched |
|---|---|
| Meshy as delivered, simple beat, 1x | 2 160 (0.21 %) |
| Meshy as delivered, beat x2 (stress) | 9 400 (0.91 %) |
| feather rig, new beat (bigger: balance, fold, per-feather waves), 1x | 2 740 (0.27 %) |
| feather rig, new beat x2 (stress) | 3 862 (0.38 %) |
| web GLB (119k tris) | 352 of 240k (0.15 %) |

**Lessons**
- Weld by position fuses the whole tail (pieces touch); use the index components, one per piece.
- A loose piece needs ONE host: nearest-vertex copy per vertex tears it between two feathers (12k edges stretched).
- Contact blending of weights makes the neighbours stretch (17k vs 270): keep `BLEND` off.
- Surface distance is a bad parameter on a feather with barbs; project on the centre line.
- The remaining stretch is Meshy's own mixed weights between back-feather bones and the wing's forearm branch (Bone_044/047/051/
  052/056/057, 025/019 at the tail root): they follow different bones, so any differential motion shears them.
- Simplifying a skinned mesh with meshopt keeps joints/weights valid because vertices are never moved or interpolated
  (weld first, `lockBorder: false`, error 0.01): 595k -> 119k tris, 66 MB -> 3.9 MB, no visible difference.
- `hero-smooth.mjs` (per-bone angle scan) is too slow with 694 bones; use a plain rAF frame-time script.

**Known gaps:** a frontal tail "fringe" (the real tail seen from the front), white specular glints on the wings, folded wing not
tested (the sculpt is an open wing; pouso/ovo need it), legs and crest only get a small motion, no IK on the paws.

## Flight rig: feathers + a real spine (16/10/2026)

    node tools/meshy-test/rig-feathers.mjs   # now with a 5th region, the crest/head strands  (210 feathers, ~1018 joints)
    node tools/meshy-test/rig-spine.mjs      # model/meshy-test/Fenix_rig.glb -> Fenix_rig2.glb : 11 Spine_NN joints pelvis -> head
    node tools/meshy-test/to-web.mjs model/meshy-test/Fenix_rig2.glb site/public/models/fenix-flight-web.glb 0.2 0.01 2048 2048 1024
    node tools/meshy-test/to-web.mjs model/meshy-test/Fenix_rig2.glb site/public/models/fenix-flight-lite.glb 0.07 0.02 1024 1024 512

Why: in the first flight test she flew UPRIGHT and stiff. Meshy carried the whole body, neck and head (51k vertices, y 0.4 to 1.7)
with nine bones that all sit below y = 1.15, so the neck could not bend, the head could not stretch forward and the body could
not undulate. `rig-spine.mjs` gives every vertex's old-spine weight (alpha) to a chain of 11 joints along the body/neck/head centre
line by a cubic B-spline (smooth bending); the weights on wings, legs, tail and feathers are untouched; the wings, the crest chain
and the back feathers are re-parented to the spine joint at THEIR height (both wings to the same one).
Lessons: the centre line cannot come from surface distance (body, neck and head are many separate pieces): use a guide read off the
height profile of the vertices, resample, re-centre three times, then smooth; leave the hair at the back of the head out of the
fit (it hangs far behind the neck and pulls the end back); attach wings by HEIGHT, not by nearest joint (their z differs).

The controller (`site/src/beasts/fenix-flight.js`) poses every spine segment to an ABSOLUTE direction between standing (rest) and
flight (`P.fly`, `P.stretch`): body horizontal, neck reaching forward, head level, legs tucked back, tail and crest combed back, plus
a wave that travels along the body with the wing beat. Measured (12 poses): body/neck 8-16 stretched edges, whole rig 0.23-0.28 %
in flight posture, 0.42 % in the swept dive; no pops along the path; 60 fps; ~1.5 ms per pose (1096 bones).

### Correction (16/10/2026, from the user's recording): head detached, lower body stiff
- The "crest" region of `rig-feathers.mjs` swallowed the HEAD and the neck shell: Meshy also rides them on bones 40-42, so after
  the first spine build the head had 88 % of its weight on feather chains (loose from the body) and the neck 58 %. Now the crest
  region only takes THIN, LONG strands (`ELONG` >= 2.5 bbox ratio, >= 0.16 long): 5 feathers instead of 96; head = 98 % spine,
  neck = 92 % spine. (Check: `lab-who`-style report of the weight mass by group around Spine_10 / Spine_08 / Spine_00.)
- The belly was 49 % on Bone_000/001 and the legs: nothing moved them. `Bone_001` now has a `pelvis` rule in fenix-flight.js
  (rides the beat a touch after the chest, leans into the turn, pitches toward the flight posture, breathes; belly, legs and tail
  base go with it) and the legs got a wave down the chain, airflow drag, splay with the turn and a slow flex of their own.
- Lesson: never trust "dominant bone" names; measure the weight mass of each body zone by group before re-skinning.

### A living head, and the bank sign (16/10/2026)
- Measured, not assumed: `bankSign` was inverted: in a LEFT turn the LEFT wing went UP (leftWingWorldY +0.28). Now -1 (left wing down).
- Head: the last five spine segments carry a share of the head's orientation (`HEAD_W`): it stays level against the body's pitch and
  roll (the eyes keep the horizon), ignores most of the body wave, LEADS into the turns (lookYaw from the path's curvature), and scans
  (`gazeAt`: fixations of 1.4-3.4 s joined by 0.2 s eased saccades, drift, tremor; all a pure function of time, so reversible).
  `P.alert` calms the scanning on a dive. Neck: a slow S drift and a lead toward the next stroke. Measured: the head moves 13 degrees
  on average (35 max) away from where a dead head would be; no step above 3 degrees except at the saccades.
- Feather flutter grows in the airflow (stretched, not beating): amplitude x1.7, frequency x1.3 at most (x2.6 / x2.6 first: 21 degrees
  per step, violent).

### Head posture, load, rate, landing (16/10/2026, second recording)
- ROOT CAUSE of the "sleeping" head: the head joint's bone is VERTICAL at rest (the standing bird) and the beak is perpendicular to it.
  Posing the last spine segments to ~10 degrees above the horizontal therefore pointed the beak DOWN in every flight. `FLIGHT_THETA`
  now ends [.., 50, 72, 84]: the neck rises in an S and a head segment at ~85 degrees keeps the beak forward. The pitch compensation
  also had the wrong sign (it raised the body and lowered the head); now `+HEAD_STAB * pitch` (0.75: the head ends up within a few
  degrees of looking ahead at the horizon in a -35 degree dive and a +35 degree climb). Checked by rendering pitch -0.6 / 0 / +0.6.
- `P.rate` (Hz): when the scroll makes the beat faster than ~1.6 Hz the stroke shrinks smoothly (`RATE_DAMP`): a blur, not a frenzy.
- `P.load` (pull-up +, push-over -) from the path's pitch rate: wing tips flex up, tail and legs trail, the neck lags.
- Back feathers: only the base joint follows the wing (the chain used to compound x1.85, x2.5); `fold.backK` 0.7. Their stretch
  (~250 edges) is NOT caused by the controller. CORRECTION (16/10, measured): it is not the mesh simplification either (that claim was
  wrong: the stretched edges are inside single pieces, none bridges two chains). The stretched vertices are still skinned to Meshy's
  ORIGINAL back bones (Bone_043..048), whose weights Meshy mixes with the wing's forearm chain (e.g. 0.65 Bone_047 + 0.21 Bone_052 +
  0.08 Bone_051): two chains that move differently shear the same piece. Fix: clean the weights per piece (drop the wing weights from
  the pieces that belong to the back region and renormalise).
- Landing: `P.ground` (timeline key) puts the lowest foot ON the ground whatever the pose.
- NOT done: eyes and beak. The model has no eyelid or jaw geometry (the eye is baked in the texture; the closed beak has no mouth
  interior), so a blink or an opening beak would need a remodel or a texture-space eyelid; see the report.

### Calibrating by measurement, blink, symmetric wings (16/10/2026, third recording)
- The head was measured, not eyeballed: the beak tip (frontmost head vertex, found in the bind pose) vs the head joint, in WORLD pitch,
  along the whole flight (`lab-beak2`-style script). Standing, the tip is 25.7 degrees below the head bone's axis, so the targets were
  calibrated until the beak sat ~10 degrees below the horizon in level flight: mean -13 degrees, range -34..+4 over the flight (it was
  -40 mean, -68 at worst). `lookPitch` from the path is 0 (the head does not look down unless a scene asks). The yaw lead used to
  couple into pitch (+5 degrees down at 25 degrees of yaw) because the rotations were composed pitch-then-yaw; now yaw (outer) *
  pitch * roll (inner).
- Eyelids by shader (`beasts/fenix-eyes.js`): the eyes are painted in the base colour map, so a blink is a patch of the texture. The
  UV ellipses were found by casting rays through the eyes in close-up renders: left (0.6563, 0.6520), right (0.0735, 0.9795), radius
  ~0.0034. Inside them the colour closes toward the skin sampled around (four taps) with a darker lid line; `blinkAt(t)` is a pure
  function of time (a blink every 2.4-6 s, sometimes double, 0.16 s). Cost not measurable (A/B interleaved: same noise either way).
- The two wings are not mirror images: in the front view the left one lay flat and the right one stood at ~35 degrees even after the
  axis balance, because the sculpt's wing PLANES are rolled differently. `fold.rollA` / `rollB` (0.25 / 0.42 rad) roll each wing about
  its own axis after the balance: symmetric dihedral in glide, on the up and down strokes and in the dive (checked front and top).
- Dive: open 0.68 / sweep 0.62 (was 0.55 / 0.85, which crumpled the feathers in the pull-out).

### Cleaning Meshy's mixed weights per piece (16/10/2026): `clean-weights.mjs`
Pipeline now: `rig-feathers.mjs` -> `clean-weights.mjs` -> `rig-spine.mjs <clean> Fenix_rig2.glb` -> `to-web.mjs`.
Measured which vertices stretch (union of 5 flight poses; `lab-stretchbones`): pieces skinned to TWO groups of bones that move
differently (back + tail root 119, back + legs, back + wing forearm, thigh pieces...). Each piece (connected component, <= 8000 verts) now
keeps ONLY its dominant group's weights (>= 30 % of the piece, another group >= 8 %), renormalised; the blending inside the group is
untouched. 650 pieces / 29.8k vertices of 450k. Result (web GLB): stretched edges per pose 624-726 -> 173-206 (0.26-0.30 % -> 0.07-0.09 %),
worst 35-55x -> 17-31x; the union over the 5 poses 1098 -> 371. No cracks seen in the renders (pieces are separate components).
What is left (~370): pieces that straddle the spine and the back bones (Spine_07 + Bone_048), tail root x back feathers, thigh x back.

### The tail root detached from the back (16/10/2026, user's top-view screenshot)
- Measured (`lab-gap`): contact pairs (vertices of two pieces closer than 1.2 cm in the bind pose) and how far apart they are in each
  pose. Tail vs BACK feathers: median gap 32 cm in flight (0.8 cm standing). Tail vs legs: 7 cm when tucked (they tuck back, natural).
- Cause 1 (fixed): Bone_001 (pelvis: tail, legs, belly) and Spine_00 (the back above it) followed two different rules; the pelvis now
  returns exactly Spine_00's delta (which holds the pelvis motion: beat pitch, yaw, roll).
- Cause 2 (the big one): the back feathers had their own chains hanging from the CHEST, but they lie along the back toward the tail:
  when the posture changes the chest moves ~39 cm forward and 79 degrees, the tail root only 12, and the feathers stretched between
  (tail moves 7 cm, back pieces 37 cm). Fix: `rig-spine.mjs` skins the back feather pieces (146 joints) to the SPINE by position like
  the rest of the body (`BACK_TO_SPINE=0` keeps the chains). Gap: median 32 cm -> 1.2 cm; top-view renders flow from back to tail in
  every pose. Cost: the back feathers no longer flutter on their own chains (they were small and covered).
- Trap: the centre line of the spine must be fitted on the ORIGINAL spine vertices only (`fitSet`); adding the back feathers to that set
  pulled the joints and the whole tail stood up vertically (found in the render, not in the numbers).
- Stretched edges now 0.10 % in flight (0.015 % folded), body/neck 86-100 (was ~30): the price of the re-skin, acceptable.

### Wing holes and the tail that started on the back (16/10/2026, recording `2026-10-16 13-50-07`)
Pipeline now: `rig-feathers` -> `clean-weights` -> `blend-wing` (ALPHA 0.25) -> `rig-spine` -> `to-web`.
- WING HOLE (measured with `lab-winggap`: pairs of vertices of different chains of the same wing that touch in the bind pose): gaps of
  up to 17 cm between the big overlapping sheets (F_wingA_88 | 91 | 93, F_wingB_11 | 15 | 17). Cause: each sheet was 100 % on its own
  chain and each chain hangs from ONE bone, and neighbouring sheets hang from different ones (Bone_053 vs Bone_035): they part when the
  elbow folds / the arm beats. Meshy's original blended across the wing. Fixes: (a) wing feathers' flutter phase / frequency / beat lag
  are smooth functions of where they sit on the wing instead of random hashes; (b) `blend-wing.mjs`: a wing vertex keeps ALPHA = 0.25
  of its chain weights and takes 0.75 from the ORIGINAL weights (two strongest). Result: pairs with a gap > 4 cm 2315-6461 -> 0, max
  17 cm -> 2 cm. Price: more stretched edges in the wings (0.07 % -> 0.18-0.23 % overall in flight); ALPHA 0.35 still leaves 35 pairs
  of 4-13 cm, 0.15 stretches more: 0.25 is the compromise.
- TAIL START (measured with `lab-gap` + the clusters of the worst pairs): the plumes Meshy skinned to a TAIL bone (Bone_025) but whose
  roots sit on the upper back (x -0.9, y 0.9, next to the base of the neck) tore from the body when the tail moved (137 pairs with a
  gap > 10 cm, up to 43 cm). `rig-spine.mjs` now gives the spine a share of every tail vertex that lies forward of the pelvis, fading in
  from x = -0.72 to -0.95 (`TAIL_X0` / `TAIL_X1`): pairs with a gap > 10 cm 137 -> 0, max 7 cm.
- Lesson: look at the p90 / the worst clusters, not just the median: the median was 1.2 cm while 10 % of the pairs were 37 cm apart.

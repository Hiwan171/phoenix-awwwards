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

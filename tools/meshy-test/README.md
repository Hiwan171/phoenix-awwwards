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

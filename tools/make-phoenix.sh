#!/usr/bin/env bash
# Whole pipeline for the sculpted phoenix: raw GLB -> prepped (oriented, scaled, decimated) -> rigged -> web + lite GLBs.
# usage (from tools/):  bash make-phoenix.sh [../model/model.glb]
set -euo pipefail
SRC="${1:-../model/model.glb}"
OUT=../site/public/models
HALF=0.5     # site scale: the shaders assume y in [-0.5, 0.5]
echo "== web: 30% of the triangles"
node prep-model.mjs "$SRC" ../model/phoenix-prep.glb 0.30 180 $HALF 0.02
node build-rig-v2.mjs ../model/phoenix-prep.glb ../model/phoenix-rigged.glb
node optimize.mjs ../model/phoenix-rigged.glb $OUT/phoenix-v2-web.glb 2048 2048 1024
echo "== lite: 10% of the triangles"
node prep-model.mjs "$SRC" ../model/phoenix-prep-lite.glb 0.10 180 $HALF 0.05
node build-rig-v2.mjs ../model/phoenix-prep-lite.glb ../model/phoenix-rigged-lite.glb
node optimize.mjs ../model/phoenix-rigged-lite.glb $OUT/phoenix-v2-lite.glb 1024 1024 512
ls -la $OUT

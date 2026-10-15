// Raw generator GLB  ->  web + lite GLBs for the site, one command per beast.
//   usage (from tools/):  node make-creature.mjs <dragon|fenix|tiger|tortoise|all> [--web-only]
//
// Per beast:   model/<name>/<name>.glb   (raw: ~590k tris, 4096² PBR, one mesh, no rig)
//   1. prep-model.mjs   bake the node transform + a yaw, centre, scale to height 1 (y in [-0.5, 0.5]), weld by position+UV,
//                       decimate (meshoptimizer) and rebuild smooth normals          -> model/<name>/build/prep-{web,lite}.glb
//   2. rig              if tools/rigs/<name>.mjs exists it runs here (skeleton + skin weights + clips)  -> build/rig-{web,lite}.glb
//   3. optimize.mjs     WebP textures + quantised, Meshopt-compressed geometry    -> site/public/models/<name>-{web,lite}.glb
//
// Canonical frame of every output (the stage's): Y up, the beast faces -Z (toward the camera), centred, height 1.
// `yaw` below is what each RAW file needs to get there (measured on 15/10/2026 from top/side renders).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const MODEL = path.resolve(here, '../model');
const OUT = path.resolve(here, '../site/public/models');

//            raw facing   yaw to face -Z   web tris   lite tris   (fractions of the ~595k source triangles)
const CREATURES = {
  dragon:   { yaw: -90, web: 0.20, lite: 0.07 },      // faces -X, upright S-curve in the XY plane
  fenix:    { yaw: -90, web: 0.20, lite: 0.07 },      // faces -X, wings spread along Z, ribbon tail trails to +X
  tiger:    { yaw: -90, web: 0.20, lite: 0.07 },      // faces -X
  tortoise: { yaw: 180, web: 0.20, lite: 0.07 },      // faces +Z (the only one)
};
const SIZES = { web: ['2048', '2048', '1024'], lite: ['1024', '1024', '512'] };

const [, , which = 'all', ...flags] = process.argv;
const names = which === 'all' ? Object.keys(CREATURES) : [which];
const run = (script, args) => execFileSync(process.execPath, [path.join(here, script), ...args], { stdio: 'inherit' });

fs.mkdirSync(OUT, { recursive: true });
for (const name of names) {
  const c = CREATURES[name];
  if (!c) { console.error(`unknown beast "${name}" (have: ${Object.keys(CREATURES).join(', ')})`); process.exit(1); }
  const raw = path.join(MODEL, name, `${name}.glb`);
  const build = path.join(MODEL, name, 'build');
  if (!fs.existsSync(raw)) { console.error(`missing ${raw}`); process.exit(1); }
  fs.mkdirSync(build, { recursive: true });
  for (const variant of flags.includes('--web-only') ? ['web'] : ['web', 'lite']) {
    console.log(`\n=== ${name} / ${variant} ===`);
    const prep = path.join(build, `prep-${variant}.glb`);
    run('prep-model.mjs', [raw, prep, String(c[variant]), String(c.yaw), '0.5', '0.02']);
    let source = prep;
    const rig = path.join(here, 'rigs', `${name}.mjs`);
    if (fs.existsSync(rig)) {
      source = path.join(build, `rig-${variant}.glb`);
      run(path.join('rigs', `${name}.mjs`), [prep, source, variant]);
    }
    const target = path.join(OUT, `${name}-${variant}.glb`);
    run('optimize.mjs', [source, target, ...SIZES[variant]]);
    console.log(`-> ${path.relative(process.cwd(), target)}  ${(fs.statSync(target).size / 1048576).toFixed(2)} MB`);
  }
}

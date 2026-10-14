import { NodeIO } from '@gltf-transform/core';
const doc = await new NodeIO().read(process.argv[2]);
const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
const p = prim.getAttribute('POSITION').getArray(); const n = p.length/3;
const f = v => v.map(x=>x.toFixed(3)).join(', ');
// extremes
let ext = {minX:0,maxX:0,minY:0,maxY:0,minZ:0,maxZ:0};
for (let i=1;i<n;i++){ const x=p[i*3],y=p[i*3+1],z=p[i*3+2];
  if (x<p[ext.minX*3]) ext.minX=i; if (x>p[ext.maxX*3]) ext.maxX=i;
  if (y<p[ext.minY*3+1]) ext.minY=i; if (y>p[ext.maxY*3+1]) ext.maxY=i;
  if (z<p[ext.minZ*3+2]) ext.minZ=i; if (z>p[ext.maxZ*3+2]) ext.maxZ=i; }
for (const k in ext) console.log(k, f([p[ext[k]*3],p[ext[k]*3+1],p[ext[k]*3+2]]));
// per-Y-slice stats: for each 0.05 slab, x-range, z-range, count, and x-cluster centroids split at sign
console.log('\nslab  count  xmin xmax | zmin zmax | cx(left) cz(left) n | cx(right) cz(right) n');
for (let y=0.5; y>-0.5; y-=0.05) {
  let c=0,xl=1e9,xh=-1e9,zl=1e9,zh=-1e9, L=[0,0,0], R=[0,0,0];
  for (let i=0;i<n;i++){ const Y=p[i*3+1]; if (Y>y||Y<=y-0.05) continue; const x=p[i*3],z=p[i*3+2];
    c++; xl=Math.min(xl,x); xh=Math.max(xh,x); zl=Math.min(zl,z); zh=Math.max(zh,z);
    if (x<0){L[0]+=x;L[1]+=z;L[2]++} else {R[0]+=x;R[1]+=z;R[2]++} }
  console.log(y.toFixed(2), String(c).padStart(6), f([xl,xh]), '|', f([zl,zh]), '|', L[2]?f([L[0]/L[2],L[1]/L[2]]):'-', L[2], '|', R[2]?f([R[0]/R[2],R[1]/R[2]]):'-', R[2]);
}

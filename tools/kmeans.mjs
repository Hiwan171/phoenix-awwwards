import { NodeIO } from '@gltf-transform/core';
const doc = await new NodeIO().read(process.argv[2]);
const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
const p = prim.getAttribute('POSITION').getArray(); const n = p.length/3;
const yMax = parseFloat(process.argv[3]), K = parseInt(process.argv[4]);
const idx=[]; for(let i=0;i<n;i+=3) if(p[i*3+1]<yMax) idx.push(i);
// kmeans++ init (deterministic seed via stride)
let C=[]; C.push([p[idx[0]*3],p[idx[0]*3+1],p[idx[0]*3+2]]);
while(C.length<K){ let best=-1,bd=-1; for(const i of idx){ let d=1e9; for(const c of C){const dx=p[i*3]-c[0],dy=p[i*3+1]-c[1],dz=p[i*3+2]-c[2]; d=Math.min(d,dx*dx+dy*dy+dz*dz);} if(d>bd){bd=d;best=i;} } C.push([p[best*3],p[best*3+1],p[best*3+2]]); }
let asg=new Int32Array(idx.length);
for(let it=0;it<30;it++){
  const S=C.map(()=>[0,0,0,0]);
  idx.forEach((i,j)=>{let b=0,bd=1e9; C.forEach((c,k)=>{const dx=p[i*3]-c[0],dy=p[i*3+1]-c[1],dz=p[i*3+2]-c[2];const d=dx*dx+dy*dy+dz*dz; if(d<bd){bd=d;b=k;}}); asg[j]=b; const s=S[b]; s[0]+=p[i*3];s[1]+=p[i*3+1];s[2]+=p[i*3+2];s[3]++;});
  C=S.map((s,k)=>s[3]?[s[0]/s[3],s[1]/s[3],s[2]/s[3]]:C[k]);
}
C.forEach((c,k)=>{ let mn=[1e9,1e9,1e9],mx=[-1e9,-1e9,-1e9],cnt=0; idx.forEach((i,j)=>{ if(asg[j]!==k) return; cnt++; for(let a=0;a<3;a++){mn[a]=Math.min(mn[a],p[i*3+a]);mx[a]=Math.max(mx[a],p[i*3+a]);}});
  console.log(k,'n',cnt,'c',c.map(v=>v.toFixed(3)).join(','),'min',mn.map(v=>v.toFixed(2)).join(','),'max',mx.map(v=>v.toFixed(2)).join(',')); });

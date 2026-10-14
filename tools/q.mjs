import { NodeIO } from '@gltf-transform/core';
const doc = await new NodeIO().read(process.argv[2]);
const p = doc.getRoot().listMeshes()[0].listPrimitives()[0].getAttribute('POSITION').getArray(); const n=p.length/3;
const regions = {
 'L-ribbon-tip x<-0.14,-0.2<y<0.0': v=>v[0]<-0.14&&v[1]>-0.2&&v[1]<0.0,
 'R-ribbon-tip x>0.10,-0.16<y<-0.04,|z|<0.3': v=>v[0]>0.10&&v[1]>-0.16&&v[1]<-0.04,
 'L-lower x<-0.12,y<-0.2': v=>v[0]<-0.12&&v[1]<-0.2,
};
for (const [name,f] of Object.entries(regions)) {
  let c=0,s=[0,0,0],mn=[1e9,1e9,1e9],mx=[-1e9,-1e9,-1e9];
  for(let i=0;i<n;i++){const v=[p[i*3],p[i*3+1],p[i*3+2]]; if(!f(v)) continue; c++; for(let a=0;a<3;a++){s[a]+=v[a];mn[a]=Math.min(mn[a],v[a]);mx[a]=Math.max(mx[a],v[a]);}}
  console.log(name,'n',c,'centroid',s.map(x=>(x/c).toFixed(3)).join(','),'min',mn.map(x=>x.toFixed(3)).join(','),'max',mx.map(x=>x.toFixed(3)).join(','));
}

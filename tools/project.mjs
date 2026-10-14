// Renders orthographic point-splat previews of a GLB (front/side/top) to PNG for rig planning.
import { NodeIO } from '@gltf-transform/core';
import { PNG } from 'pngjs';
import fs from 'fs';

const [,, input, outPrefix] = process.argv;
const io = new NodeIO();
const doc = await io.read(input);
const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
const pos = prim.getAttribute('POSITION').getArray();
const n = pos.length / 3;

function render(name, ax, ay, az, flipX = false) {
  const S = 900, pad = 30; const CROP = process.env.CROP ? process.env.CROP.split(',').map(Number) : null;
  let mnx=1e9,mxx=-1e9,mny=1e9,mxy=-1e9,mnz=1e9,mxz=-1e9;
  for (let i=0;i<n;i++){const x=pos[i*3+ax],y=pos[i*3+ay],z=pos[i*3+az];
    mnx=Math.min(mnx,x);mxx=Math.max(mxx,x);mny=Math.min(mny,y);mxy=Math.max(mxy,y);mnz=Math.min(mnz,z);mxz=Math.max(mxz,z);}
  const sc = (S-2*pad)/Math.max(mxx-mnx, mxy-mny);
  const png = new PNG({width:S,height:S});
  const depth = new Float32Array(S*S).fill(-1e9);
  png.data.fill(255);
  for (let i=0;i<n;i++){
    const x=pos[i*3+ax],y=pos[i*3+ay],z=pos[i*3+az];
    let px = Math.round(pad+(x-mnx)*sc); if (flipX) px = S-1-px;
    const py = Math.round(S-pad-(y-mny)*sc);
    if (px<0||py<0||px>=S||py>=S) continue;
    const k=py*S+px;
    if (z>depth[k]) { depth[k]=z;
      const t=(z-mnz)/(mxz-mnz||1);
      png.data[k*4]=Math.round(40+200*t); png.data[k*4+1]=Math.round(60+60*(1-t)); png.data[k*4+2]=Math.round(220-180*t); png.data[k*4+3]=255;
    }
  }
  // grid ticks every 0.1 units
  for (let v=Math.ceil(mnx*10)/10; v<=mxx; v+=0.1){ const px=Math.round(pad+(v-mnx)*sc); for(let yy=0;yy<S;yy+=1){ if(yy%8<2){const k=yy*S+(flipX?S-1-px:px); png.data[k*4]=0;png.data[k*4+1]=0;png.data[k*4+2]=0;} } }
  for (let v=Math.ceil(mny*10)/10; v<=mxy; v+=0.1){ const py=Math.round(S-pad-(v-mny)*sc); for(let xx=0;xx<S;xx+=1){ if(xx%8<2){const k=py*S+xx; png.data[k*4]=0;png.data[k*4+1]=0;png.data[k*4+2]=0;} } }
  fs.writeFileSync(`${outPrefix}-${name}.png`, PNG.sync.write(png));
  console.log(name, {mnx,mxx,mny,mxy,mnz,mxz});
}
render('front', 0, 1, 2);  // X right, Y up, depth Z (nearest = +Z)
render('side', 2, 1, 0);   // Z right, Y up, depth X
render('top', 0, 2, 1);    // X right, Z up(page), depth Y

// Measurements of the face, before and after the procedures on screen.
//
// They are taken on the face in 3D (deform.js's points3: MediaPipe's landmarks with
// their depth), in the head's own frame, so turning the head changes them far less
// than it changes the picture. Lengths are a share of face width (ear to ear,
// landmarks 234–454), so the distance to the camera does not change them either. The
// "after" values move every landmark by the same displacements the picture is warped
// with, so the numbers describe exactly the change you see.
//
// Depth comes from one camera: the model infers it from the picture, it does not
// measure it. Read the profile measurements (`abs`) as a comparison of before and
// after on one face, not as millimetres.
import {headFrame} from './deform.js?v=3';

export const metrics=[
  {id:'nose-width', name:'پهنای پرهٔ بینی', span:[64,294]},
  {id:'nose-eyes',  name:'پهنای بینی / فاصلهٔ دو چشم', ratio:[[64,294],[133,362]]},
  {id:'dorsum',     name:'قوز تیغهٔ بینی', hump:[168,4,[6,197,195,5]], abs:true},
  {id:'nose-proj',  name:'جلوآمدگی نوک بینی', forward:[1,[64,294]], abs:true},
  {id:'mouth',      name:'پهنای دهان', span:[61,291]},
  {id:'lip-upper',  name:'ضخامت لب بالا', span:[0,13]},
  {id:'lip-lower',  name:'ضخامت لب پایین', span:[14,17]},
  {id:'lip-ratio',  name:'لب پایین / لب بالا', ratio:[[14,17],[0,13]]},
  {id:'philtrum',   name:'فاصلهٔ بینی تا لب', span:[2,0]},
  {id:'eye-open',   name:'بازشدگی چشم', spans:[[159,145],[386,374]]},
  {id:'eye-width',  name:'پهنای چشم', spans:[[33,133],[263,362]]},
  {id:'canthal',    name:'زاویهٔ گوشهٔ چشم', tilt:true, abs:true},
  {id:'brow',       name:'فاصلهٔ ابرو تا پلک', spans:[[105,159],[334,386]]},
  {id:'cheeks',     name:'پهنای گونه‌ها', span:[50,280]},
  {id:'jaw',        name:'پهنای فک', span:[172,397]},
  {id:'chin-width', name:'پهنای چانه', span:[148,377]},
  {id:'chin',       name:'بلندی چانه', span:[17,152]},
  {id:'chin-proj',  name:'جلوآمدگی چانه نسبت به لب پایین', forward:[199,[17]], abs:true},
  {id:'thirds',     name:'یک‌سوم پایین / میانی صورت', ratio:[[2,152],[168,2]]}
];
// Every landmark read here, for the debug overlay.
export const measuredLandmarks=[...new Set(metrics.flatMap(m=>[
  ...(m.span||[]),...(m.spans||[]).flat(),...(m.ratio||[]).flat(),...(m.tilt?[33,133,263,362]:[]),
  ...(m.hump?[m.hump[0],m.hump[1],...m.hump[2]]:[]),...(m.forward?[m.forward[0],...m.forward[1]]:[])]))];

const PAIRS=[[33,263],[133,362],[61,291],[105,334],[172,397],[50,280],[70,300]];
const sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z});
const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
const len=v=>Math.hypot(v.x,v.y,v.z);

// Landmark positions in 3D pixels, each moved by `d` (x,y,z triples) when given.
export function moved(P,d){
  return d?P.map((q,i)=>({x:q.x+d[i*3],y:q.y+d[i*3+1],z:q.z+d[i*3+2]})):P;
}

export function measure(pts){
  const d=(a,b)=>len(sub(pts[a],pts[b]));
  const frame=headFrame(pts),{ex,ey,ez}=frame,face=frame.face;
  const out={};
  for(const m of metrics){
    if(m.span)out[m.id]={value:d(...m.span)/face*100,unit:'%'};
    else if(m.spans)out[m.id]={value:m.spans.reduce((s,pair)=>s+d(...pair),0)/m.spans.length/face*100,unit:'%'};
    else if(m.ratio)out[m.id]={value:d(...m.ratio[0])/(d(...m.ratio[1])||1),unit:'×'};
    else if(m.tilt){
      // Outer corner above inner corner reads positive, on both sides.
      const tilt=(outer,inner)=>{
        const v=sub(pts[outer],pts[inner]);
        return Math.atan2(-dot(v,ey),Math.abs(dot(v,ex)))*180/Math.PI;
      };
      out[m.id]={value:(tilt(33,133)+tilt(263,362))/2,unit:'°'};
    }else if(m.forward){
      // How far one point stands forward of others, out of the face.
      const [a,refs]=m.forward;
      const ref=refs.reduce((s,i)=>({x:s.x+pts[i].x/refs.length,y:s.y+pts[i].y/refs.length,z:s.z+pts[i].z/refs.length}),{x:0,y:0,z:0});
      out[m.id]={value:dot(sub(pts[a],ref),ez)/face*100,unit:'%'};
    }else if(m.hump){
      // The bridge of the nose against the straight line from its root to the tip:
      // the most any point between stands forward of it (negative for a scooped one).
      const [from,to,between]=m.hump,A=pts[from],AB=sub(pts[to],A),ab2=dot(AB,AB)||1;
      let most=-Infinity;
      for(const i of between){
        const q=pts[i],t=dot(sub(q,A),AB)/ab2;
        const line={x:A.x+AB.x*t,y:A.y+AB.y*t,z:A.z+AB.z*t};
        most=Math.max(most,dot(sub(q,line),ez));
      }
      out[m.id]={value:most/face*100,unit:'%'};
    }
  }
  return out;
}

// Left–right balance: each paired point reflected across the face's midline (the
// plane through the bridge of the nose, square to the ear-to-ear line), the mean miss
// as a share of face width, turned into a 0–100 score.
export function symmetry(pts){
  const {ex,face}=headFrame(pts),o=pts[168];
  let miss=0;
  for(const [a,b] of PAIRS){
    const q=pts[a],k=2*dot(sub(q,o),ex);
    const r={x:q.x-ex.x*k,y:q.y-ex.y*k,z:q.z-ex.z*k};      // a, reflected
    miss+=len(sub(r,pts[b]))/face;
  }
  return Math.max(0,Math.min(100,100-miss/PAIRS.length*400));
}

// Yaw, pitch and roll in degrees from MediaPipe's facial transformation matrix.
export function pose(data){
  if(!data||data.length<16)return null;
  // The packed data is column-major; detect it by where the translation sits.
  const colMajor=Math.abs(data[12])+Math.abs(data[13])+Math.abs(data[14])>=Math.abs(data[3])+Math.abs(data[7])+Math.abs(data[11]);
  const r=(row,col)=>colMajor?data[col*4+row]:data[row*4+col];
  const deg=180/Math.PI;
  return {
    yaw:Math.asin(Math.max(-1,Math.min(1,-r(2,0))))*deg,
    pitch:Math.atan2(r(2,1),r(2,2))*deg,
    roll:Math.atan2(r(1,0),r(0,0))*deg
  };
}

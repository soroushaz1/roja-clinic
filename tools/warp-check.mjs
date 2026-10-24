// Checks the 3D geometry behind the preview without a browser: MediaPipe's canonical
// face (facemesh.js's CANON3), turned to known angles and projected the way the
// tracker reports a face, through deform.js, warp.js and measure.js.
//
//   node tools/warp-check.mjs
//
// It checks that nothing moves at zero; that an edit in depth is invisible from the
// front and shows as the head turns, and an edit across the face does the opposite;
// that a nose edit never reaches the cheeks, whatever the angle; that the hump is
// found where it is and taken off there; that the lip styles are made of real
// controls; that the measurements hardly change with the angle and do register the
// edits; that the
// background follows the face's outline and stays put far from it; and which side of
// a turned face is marked as facing the camera; and that the shape solved for over
// many pictures (fuse.js) finds each picture's angle and a depth one picture only
// guesses.
import assert from 'node:assert/strict';
import {CANON3} from '../facemesh.js';
import {points3,headFrame,displacements,controls,zeroAmounts,hump} from '../deform.js';
import {lipStyles,procedures} from '../procedures.js';
import {createWarp,COLS,ROWS} from '../warp.js';
import {measure,symmetry,moved,metrics} from '../measure.js';
import {fuse,fitPose,place} from '../fuse.js';

const W=640,H=480,SCALE=10;                       // ~150 px ear to ear
const rad=d=>d*Math.PI/180;
// The canonical face turned by `yaw` (positive turns the 454 side away) and `pitch`,
// as the tracker reports it: x and y as fractions of the frame, z on the scale of x
// with smaller nearer the camera.
// `bump` pushes one landmark of the bridge forward by that share of the face's width:
// a hump where the canonical face has none.
function face(yaw=0,pitch=0,bump=null){
  const out=[];
  const cy=Math.cos(rad(yaw)),sy=Math.sin(rad(yaw)),cp=Math.cos(rad(pitch)),sp=Math.sin(rad(pitch));
  for(let i=0;i<468;i++){
    const X=CANON3[i*3],Y=CANON3[i*3+1],Z=CANON3[i*3+2];
    const x1=X*cy+Z*sy, z1=-X*sy+Z*cy;              // yaw, about the vertical
    const y2=Y*cp-z1*sp, z2=Y*sp+z1*cp;             // pitch, about the horizontal
    out.push({x:(W/2+SCALE*x1)/W,y:(H/2+SCALE*y2)/H,z:-SCALE*z2/W});
  }
  if(bump){
    const f=headFrame(points3(out,W,H)),k=bump.size*f.face;
    const q=out[bump.at];q.x+=f.ez.x*k/W;q.y+=f.ez.y*k/H;q.z+=f.ez.z*k/W;
  }
  return out;
}
const amounts=set=>Object.assign(zeroAmounts(),set);
// One landmark's move in the picture, in pixels.
function move(lm,set,i){
  const d=displacements(points3(lm,W,H),amounts(set));
  return d?{x:d[i*3],y:d[i*3+1],z:d[i*3+2]}:{x:0,y:0,z:0};
}
const img=v=>Math.hypot(v.x,v.y);
const report={};

/* the head frame */
{
  const f0=headFrame(points3(face(0),W,H));
  assert(f0.ez.z<-.999,`facing the camera, forward should be −z: ${JSON.stringify(f0.ez)}`);
  assert(Math.abs(f0.face-15.32*SCALE)<1,`face width ${f0.face}`);
  const f40=headFrame(points3(face(40),W,H));
  assert(Math.abs(Math.abs(f40.ez.x)-Math.sin(rad(40)))<.01,`turned 40°, forward is off by ${f40.ez.x}`);
  report.frame='forward is out of the face at 0° and 40°';
}

/* nothing moves at zero */
assert.equal(displacements(points3(face(0),W,H),zeroAmounts()),null,'zero amounts moved something');
assert.equal(createWarp().compute(face(30),W,H,zeroAmounts()),null,'zero amounts made a warp');

/* depth edits show as the head turns; edits across the face do the opposite */
{
  // "Invisible from the front" within the face's own tilt: forehead to chin, the
  // canonical face leans back by under a degree.
  const chin=[0,30,60].map(yaw=>move(face(yaw),{'chin-projection':100},199));
  const full=Math.hypot(chin[0].x,chin[0].y,chin[0].z);
  assert(img(chin[0])<full*.03,`chin projection moved the chin ${img(chin[0]).toFixed(3)} px from the front`);
  assert(full>SCALE*15.32*.03,`chin projection at 100 is only ${full.toFixed(1)} px`);
  for(const [i,yaw] of [[1,30],[2,60]])
    assert(Math.abs(img(chin[i])-full*Math.sin(rad(yaw)))<full*.03,`chin projection at ${yaw}°: ${img(chin[i]).toFixed(2)} px, expected ${(full*Math.sin(rad(yaw))).toFixed(2)}`);
  const hump=[0,70].map(yaw=>move(face(yaw),{'nose-hump':-100},197));
  assert(img(hump[0])<img(hump[1])*.03&&img(hump[1])>2,`the hump: ${img(hump[0]).toFixed(2)} px from the front, ${img(hump[1]).toFixed(2)} in profile`);
  const ala=[0,50].map(yaw=>move(face(yaw),{'nose-width':-100},64));
  assert(img(ala[0])>1,'narrowing the nose did not move the side of it');
  assert(Math.abs(img(ala[1])/img(ala[0])-Math.cos(rad(50)))<.08,`narrowing seen at 50°: ×${(img(ala[1])/img(ala[0])).toFixed(2)}, expected ×${Math.cos(rad(50)).toFixed(2)}`);
  report.depth={chinFront:+img(chin[0]).toFixed(3),chin60:+img(chin[2]).toFixed(2),humpProfile:+img(hump[1]).toFixed(2),alaFront:+img(ala[0]).toFixed(2),ala50:+img(ala[1]).toFixed(2)};
}

/* a nose edit stays on the nose */
{
  const nose={'nose-width':-100,'nose-bridge':-100,'nose-tip':100,'nose-tip-side':100,'nose-deviation':-100,'nose-tip-size':-100,'nose-hump':-100,'nose-projection':100};
  for(const yaw of [0,45,75])for(const i of [50,280,234,454,33,263,152])
    assert(img(move(face(yaw),nose,i))===0,`the nose edits reached landmark ${i} at ${yaw}°`);
  report.local='nose edits leave cheeks, eyes and chin alone at 0°, 45° and 75°';
}

/* the hump: found where it is, taken off there, and left alone from the front */
{
  const P0=points3(face(0),W,H);
  assert(Math.abs(hump(P0).peak.d)<1e-4,`the average face reads as having a hump of ${(hump(P0).peak.d*100).toFixed(2)}%`);
  const out={};
  for(const at of [6,197,195]){
    const lm=face(0,0,{at,size:.03}),P=points3(lm,W,H),h=hump(P);
    const t=h.t[[168,6,197,195,5,4].indexOf(at)];
    assert(Math.abs(h.peak.t-t)<.05,`a hump at ${at} (t ${t.toFixed(2)}) was found at t ${h.peak.t.toFixed(2)}`);
    assert(h.peak.d>.02,`a 3% hump at ${at} reads as ${(h.peak.d*100).toFixed(2)}%`);
    // At -100 it comes off; turned, the same.
    for(const yaw of [0,40]){
      const Q=points3(face(yaw,0,{at,size:.03}),W,H),d=displacements(Q,amounts({'nose-hump':-100}));
      const left=hump(Q.map((q,i)=>({x:q.x+d[i*3],y:q.y+d[i*3+1],z:q.z+d[i*3+2]}))).peak.d;
      assert(left<h.peak.d*.2,`at ${yaw}°, taking off a ${(h.peak.d*100).toFixed(2)}% hump at ${at} left ${(left*100).toFixed(2)}%`);
      if(!yaw)out[at]=+(left*100).toFixed(2);
    }
  }
  // Moved along the bridge by nose-hump-at: upwards, the bridge moves more above.
  const P=points3(face(0,0,{at:197,size:.03}),W,H),f=headFrame(P);
  const back=(set,i)=>{const d=displacements(P,amounts(set));return -(d[i*3]*f.ez.x+d[i*3+1]*f.ez.y+d[i*3+2]*f.ez.z);};
  assert(back({'nose-hump':-100,'nose-hump-at':100},6)>back({'nose-hump':-100},6)*1.5,'nose-hump-at did not move the correction up the bridge');
  assert.equal(displacements(P,amounts({'nose-hump-at':100})),null,'nose-hump-at moved something by itself');
  report.hump={leftAfter:out};
}

/* the lip styles are made of real lip controls, and are the lip filler's variants */
{
  const ids=new Set(controls.filter(c=>c.region==='lips').map(c=>c.id));
  for(const s of lipStyles)for(const id of Object.keys(s.weights))assert(ids.has(id),`lip style ${s.id} sets ${id}, which is not a lip control`);
  const variants=procedures.find(p=>p.id==='lip-filler').variants.map(v=>v.id);
  assert.deepEqual(variants,lipStyles.map(s=>s.id),'the lip filler variants are not the lip styles');
  report.lipStyles=lipStyles.map(s=>s.id).join(', ');
}

/* measurements hardly change with the angle, and register the edits */
{
  const at=(yaw,pitch,set)=>{const P=points3(face(yaw,pitch),W,H);return measure(moved(P,set?displacements(P,amounts(set)):null));};
  const base=at(0,0);
  for(const [yaw,pitch] of [[35,0],[-50,10],[20,-15]]){
    const m=at(yaw,pitch);
    for(const {id} of metrics){
      const a=base[id].value,b=m[id].value;
      assert(Math.abs(a-b)<=Math.max(.02,Math.abs(a)*.005),`${id} moved from ${a.toFixed(3)} to ${b.toFixed(3)} at yaw ${yaw}°, pitch ${pitch}°`);
    }
  }
  assert(symmetry(points3(face(0),W,H))>99&&symmetry(points3(face(40),W,H))>99,'the canonical face does not read as symmetric');
  const hump=at(50,0,{'nose-hump':-100}),chin=at(-30,0,{'chin-projection':100}),narrow=at(0,0,{'nose-width':-60});
  assert(hump.dorsum.value<base.dorsum.value-.5,`the hump measurement did not drop (${base.dorsum.value.toFixed(2)} → ${hump.dorsum.value.toFixed(2)})`);
  assert(chin['chin-proj'].value>base['chin-proj'].value+1,`the chin measurement did not rise (${base['chin-proj'].value.toFixed(2)} → ${chin['chin-proj'].value.toFixed(2)})`);
  assert(narrow['nose-width'].value<base['nose-width'].value*.97,'the nose width did not drop');
  report.measure={dorsum:[+base.dorsum.value.toFixed(2),+hump.dorsum.value.toFixed(2)],chinProj:[+base['chin-proj'].value.toFixed(2),+chin['chin-proj'].value.toFixed(2)]};
}

/* the warp: which side faces the camera, and the background around the face */
{
  const warp=createWarp();
  const lm=face(70);
  const w=warp.compute(lm,W,H,amounts({'jaw-width':-100,'chin-projection':100}));
  assert(w,'no warp for a jaw edit');
  const {facing,d,P}=warp.last;
  assert(facing[1]>.5,`the nose tip does not face the camera at 70° (${facing[1].toFixed(2)})`);
  assert.equal(facing[454],0,'the far ear point faces the camera at 70°');
  // Far from the face the background stays put.
  for(const [c,r] of [[0,0],[COLS,0],[0,ROWS],[COLS,ROWS]]){
    const g=(r*(COLS+1)+c)*2;
    assert.equal(w.grid[g]+w.grid[g+1],0,`the background moved at the corner ${c},${r}`);
  }
  // Just outside the near side of the jaw, the background follows the jaw.
  const front=createWarp(),fw=front.compute(face(0),W,H,amounts({'jaw-width':-100}));
  const fl=front.last,j=172,q=fl.P[j];
  const c=Math.round(q.x/W*COLS),r=Math.round(q.y/H*ROWS),g=(r*(COLS+1)+c)*2;
  const want=fl.d[j*3],got=fw.grid[g];
  assert(Math.abs(want)>3,'the jaw edit did not move the jaw');
  assert(Math.sign(got)===Math.sign(want)&&Math.abs(got)>Math.abs(want)*.5,`the background by the jaw moved ${got.toFixed(2)} px, the jaw ${want.toFixed(2)}`);
  // The mesh is in clip space, nearer is smaller depth.
  assert(w.mesh.pos[1*3+2]<w.mesh.pos[454*3+2],'the nose tip is not nearer than the far ear point');
  report.warp={noseFacing:+facing[1].toFixed(2),jaw:+want.toFixed(2),backgroundByJaw:+got.toFixed(2)};
}

/* every control moves something, and only depth controls are invisible from the front */
{
  const P=points3(face(0),W,H),P60=points3(face(60),W,H);
  for(const c of controls){
    if(c.texture||c.modifies)continue;
    const d=displacements(P,amounts({[c.id]:100})),d60=displacements(P60,amounts({[c.id]:100}));
    let front=0,side=0;
    for(let i=0;i<468;i++){front=Math.max(front,Math.hypot(d[i*3],d[i*3+1]));side=Math.max(side,Math.hypot(d60[i*3],d60[i*3+1]));}
    if(c.depth)assert(front<side*.03&&side>1,`${c.id}: ${front.toFixed(2)} px from the front, ${side.toFixed(2)} at 60°`);
    else assert(front>1,`${c.id} moves nothing from the front (${front.toFixed(2)} px)`);
  }
  report.controls=`${controls.filter(c=>!c.texture&&!c.modifies).length} shape controls, ${controls.filter(c=>c.depth).length} in depth`;
}

/* many pictures make one shape: each one's angle is found, and the depth the tracker
   only guesses from one picture comes from the turned ones */
{
  // A face whose nose stands out a fifth of a face width further than the canonical
  // one, seen by a tracker that measures it across each picture (with a pixel or so of
  // noise) but takes its depth from the face it expects: the canonical one.
  const C=[];for(let i=0;i<468;i++)C.push({x:CANON3[i*3],y:CANON3[i*3+1],z:CANON3[i*3+2]});
  const NOSE=[1,2,4,5,6,19,94,195,197,168,45,275,44,274,48,278,115,344,220,440];
  const T=C.map((q,i)=>NOSE.includes(i)?{...q,z:q.z+3}:q);
  const turn=(q,yaw,pitch)=>{const cy=Math.cos(rad(yaw)),sy=Math.sin(rad(yaw)),cp=Math.cos(rad(pitch)),sp=Math.sin(rad(pitch));
    const x1=q.x*cy+q.z*sy,z1=-q.x*sy+q.z*cy;return {x:x1,y:q.y*cp-z1*sp,z:q.y*sp+z1*cp};};
  let seed=7;const noise=()=>{seed=(seed*16807)%2147483647;return seed/2147483647-.5;};
  const seen=(yaw,pitch)=>T.map((q,i)=>{const a=turn(q,yaw,pitch),b=turn(C[i],yaw,pitch);
    return {x:W/2+SCALE*a.x+noise()*2,y:H/2+SCALE*a.y+noise()*2,z:-SCALE*b.z};});
  const angles=[[0,0],[-36,0],[-28,0],[-20,0],[-12,0],[12,0],[20,0],[28,0],[36,0],[-8,-14],[8,-14],[-8,14],[8,14]];
  const Ps=angles.map(([y,p])=>seen(y,p)),truth=T.map(q=>({x:W/2+SCALE*q.x,y:H/2+SCALE*q.y,z:-SCALE*q.z}));
  // How far the nose is from the true one, once laid over it.
  const noseError=X=>{const pose=fitPose(X,truth);return NOSE.reduce((e,i)=>{const q=place(pose,X[i]);
    return e+Math.hypot(q.x-truth[i].x,q.y-truth[i].y,q.z-truth[i].z);},0)/NOSE.length;};
  const {X,poses}=fuse(Ps),one=noseError(Ps[0]),all=noseError(X);
  assert(all<one*.6,`the nose from all the pictures is no nearer the truth than from the front one (${all.toFixed(2)} vs ${one.toFixed(2)} px)`);
  poses.forEach((pose,k)=>{
    // The picture's turn, read back: yaw about the vertical, pitch about the horizontal,
    // both the other way round, as the picture's z runs away from the camera.
    const yaw=-Math.atan2(pose.R[0][2],pose.R[2][2])*180/Math.PI,pitch=-Math.asin(Math.max(-1,Math.min(1,-pose.R[1][2])))*180/Math.PI;
    assert(Math.abs(yaw-angles[k][0])<1&&Math.abs(pitch-angles[k][1])<1,`picture ${k} found at ${yaw.toFixed(1)}°, ${pitch.toFixed(1)}° instead of ${angles[k]}`);
  });
  const alone=fuse([Ps[0]]).X;
  assert(alone.every((q,i)=>q.x===Ps[0][i].x&&q.y===Ps[0][i].y&&q.z===Ps[0][i].z),'one picture alone is not left as it is');
  report.fuse={pictures:Ps.length,noseFront:+one.toFixed(2),noseAll:+all.toFixed(2)};
}

console.log(JSON.stringify(report,null,1));

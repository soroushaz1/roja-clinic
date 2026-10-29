// Where the skin treatments act, drawn as soft white masks from the landmarks, and the
// filter that steadies the landmarks themselves.
//
// The shape procedures need no mask: they move pixels through deform.js. The
// non-surgical ones (botox, resurfacing, under-eye filler) change the skin's texture
// instead, and deform.js's textureLayers() names the zone each one smooths: the whole
// face, the forehead, around the eyes, or under them. The WebGL stage (stage.js)
// uploads each mask and smooths the frame inside it.
import {blurInto} from './blur.js?v=14';

// MediaPipe's contours. Eye openings and the mouth opening are never painted.
const lipOuter=[61,185,40,39,37,0,267,269,270,409,291,375,321,405,314,17,84,181,91,146];
const lipInner=[78,191,80,81,82,13,312,311,310,415,308,324,318,402,317,14,87,178,88,95];
const faceOval=[10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109];
// Per eye, listed outer corner first: the upper and lower lid, the lower and upper
// edge of the brow.
const eyes=[
  {upper:[33,246,161,160,159,158,157,173,133],lower:[133,155,154,153,145,144,163,7,33],
   brow:[46,53,52,65,55],browTop:[70,63,105,66,107]},
  {upper:[263,466,388,387,386,385,384,398,362],lower:[362,382,381,380,374,373,390,249,263],
   brow:[276,283,282,295,285],browTop:[300,293,334,296,336]}
];
const foreheadAnchors=[54,103,67,109,10,338,297,332,284,9];

// Which landmarks the masks read, so the debug overlay can pick out the ones in play.
export const textureLandmarks=[...faceOval,...foreheadAnchors,...eyes.flatMap(e=>[...e.upper,...e.lower])];

/* ---- geometry helpers --------------------------------------------------- */
const mix=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
const add=(a,v,k=1)=>({x:a.x+v.x*k,y:a.y+v.y*k});
const sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y});
const unit=v=>{const l=Math.hypot(v.x,v.y)||1;return {x:v.x/l,y:v.y/l};};
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const scaleAbout=(pts,c,k)=>pts.map(q=>mix(c,q,k));
const centroid=pts=>pts.reduce((s,q)=>({x:s.x+q.x/pts.length,y:s.y+q.y/pts.length}),{x:0,y:0});
const white=a=>`rgba(255,255,255,${Math.max(0,Math.min(1,a))})`;

// Quadratic mid-point contours avoid visible straight mesh segments.
function polygon(ctx,points){
  const mid=mix(points[points.length-1],points[0],.5);ctx.moveTo(mid.x,mid.y);
  points.forEach((q,i)=>{const next=mix(q,points[(i+1)%points.length],.5);ctx.quadraticCurveTo(q.x,q.y,next.x,next.y);});
  ctx.closePath();
}
function ellipse(ctx,center,rx,ry,angle,stops){
  ctx.save();ctx.translate(center.x,center.y);ctx.rotate(angle);ctx.scale(rx,ry);
  const g=ctx.createRadialGradient(0,0,0,0,0,1);
  for(const [at,alpha] of stops)g.addColorStop(at,white(alpha));
  ctx.fillStyle=g;ctx.fillRect(-1,-1,2,2);ctx.restore();
}
// The face-local frame every size is measured in, so a mask keeps its proportions
// whatever the distance to the camera and the tilt of the head.
function faceFrame(p){
  const left=p(234),right=p(454);
  const ex=unit(sub(right,left)),ey={x:-ex.y,y:ex.x};
  return {face:distance(left,right)||1,ex,ey,up:{x:-ey.x,y:-ey.y}};
}

/* ---- the zones ----------------------------------------------------------
   Each draws in white on a clear canvas and returns the points that bound it, so
   the blur that feathers it only has to touch that part of the frame. */
function wholeFace(ctx,p,f){
  const oval=faceOval.map(p),c=centroid(oval);
  // Pull the outline in, most of all at the top, where the hairline or a fringe
  // usually sits inside the model's oval.
  const inner=oval.map(q=>{const d=unit(sub(q,c)),lift=Math.max(0,d.x*f.up.x+d.y*f.up.y);return mix(c,q,.965-.085*lift);});
  ctx.fillStyle='#fff';ctx.beginPath();polygon(ctx,inner);ctx.fill();
  ctx.globalCompositeOperation='destination-out';ctx.beginPath();
  for(const eye of eyes){
    const lid=[...eye.upper,...eye.lower].map(p);polygon(ctx,scaleAbout(lid,centroid(lid),1.3));
    const brow=[...eye.browTop,...eye.brow.slice().reverse()].map(p);polygon(ctx,scaleAbout(brow,centroid(brow),1.12));
  }
  const lips=lipOuter.map(p);polygon(ctx,scaleAbout(lips,centroid(lips),1.06));
  ctx.fill();ctx.globalCompositeOperation='source-over';
  return oval;
}
function underEyes(ctx,p,f){
  const pts=[];
  ctx.fillStyle='#fff';ctx.beginPath();
  for(const eye of eyes){
    const lower=eye.lower.map(p);                     // inner corner first
    const width=distance(lower[0],lower[lower.length-1]);
    const top=lower.map(q=>add(q,f.ey,width*.07));
    const bottom=lower.map((q,i)=>{const t=i/(lower.length-1);
      return add(q,f.ey,width*(.14+.62*Math.pow(Math.sin(Math.PI*(.15+.7*t)),.8)));});
    const shape=[...top,...bottom.reverse()];polygon(ctx,shape);pts.push(...shape);
  }
  ctx.fill();return pts;
}
function forehead(ctx,p,f){
  // Across the top from one temple to the other, then back along the brows.
  const top=foreheadAnchors.slice(0,9).map(p);
  const brows=[...eyes[1].browTop.map(p),p(9),...eyes[0].browTop.slice().reverse().map(p)];
  const c=centroid(top);
  const shape=[...scaleAbout(top,c,.92),...brows.map(q=>add(q,f.up,f.face*.02))];
  ctx.fillStyle='#fff';ctx.beginPath();polygon(ctx,shape);ctx.fill();
  return shape;
}
function aroundEyes(ctx,p,f){
  const pts=[];
  for(const eye of eyes){
    const outer=p(eye.upper[0]),inner=p(eye.upper[eye.upper.length-1]),width=distance(outer,inner);
    const away=unit(sub(outer,inner));
    const c=add(outer,away,width*.3);
    ellipse(ctx,c,width*.32,width*.42,Math.atan2(f.ex.y,f.ex.x),[[0,1],[.6,.75],[1,0]]);
    pts.push(add(c,f.ex,-width*.5),add(c,f.ex,width*.5),add(c,f.ey,width*.5),add(c,f.up,width*.5));
  }
  return [...pts,...underEyes(ctx,p,f)];
}
const zones={skin:wholeFace,forehead,eyes:aroundEyes,undereye:underEyes};

/* ---- masks -------------------------------------------------------------- */
// How far a mask's edge is feathered at 100% fade, in face widths.
const FEATHER=.05;

function makeCanvas(){return document.createElement('canvas');}
function fit(canvas,w,h){if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}}

function boundsOf(points,pad,W,H){
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for(const q of points){if(q.x<x0)x0=q.x;if(q.y<y0)y0=q.y;if(q.x>x1)x1=q.x;if(q.y>y1)y1=q.y;}
  if(!points.length)return {x:0,y:0,w:W,h:H};
  x0=Math.max(0,Math.floor(x0-pad));y0=Math.max(0,Math.floor(y0-pad));
  x1=Math.min(W,Math.ceil(x1+pad));y1=Math.min(H,Math.ceil(y1+pad));
  return {x:x0,y:y0,w:Math.max(1,x1-x0),h:Math.max(1,y1-y0)};
}

// One painter per renderer. It owns its scratch canvases and returns the same mask
// canvas each time, so the caller must use (or upload) it before the next paint.
// Masks are soft and broad, so they are painted at half resolution; draw or sample
// one stretched to the frame. `spec` is {zone, fade}.
export function createMaskPainter(){
  const mask=makeCanvas(),shape=makeCanvas();
  const mctx=mask.getContext('2d'),sctx=shape.getContext('2d');
  let lastBox=null;

  function paint(spec,landmarks,W,H){
    const w=Math.max(1,Math.round(W*.5)),h=Math.max(1,Math.round(H*.5));
    fit(mask,w,h);fit(shape,w,h);
    const p=i=>({x:landmarks[i].x*w,y:landmarks[i].y*h});
    const f=faceFrame(p);
    sctx.clearRect(0,0,w,h);mctx.clearRect(0,0,w,h);
    sctx.save();const points=(zones[spec.zone]||(()=>[]))(sctx,p,f)||[];sctx.restore();
    const radius=f.face*FEATHER*Math.max(0,Math.min(100,spec.fade??60))/100;
    const box=boundsOf(points,radius*3+4,w,h);
    blurInto(mctx,shape,box,radius);

    // Keep everything on the face and out of the eye and mouth openings, whatever
    // the blur did. Nothing lies outside the box, so only it is touched.
    mctx.save();
    mctx.beginPath();mctx.rect(box.x,box.y,box.w,box.h);mctx.clip();
    mctx.globalCompositeOperation='destination-in';mctx.beginPath();polygon(mctx,faceOval.map(p));mctx.fill();
    mctx.globalCompositeOperation='destination-out';mctx.beginPath();
    polygon(mctx,lipInner.map(p));for(const eye of eyes)polygon(mctx,[...eye.upper,...eye.lower].map(p));mctx.fill();
    mctx.restore();
    lastBox={x:box.x/w,y:box.y/h,w:box.w/w,h:box.h/h};
    return mask;
  }
  // `box` bounds the last mask painted, as fractions of the frame.
  return {paint,canvas:mask,get box(){return lastBox;}};
}

// Steadies the landmarks without making the preview trail a moving face: a One Euro
// filter, one gain for the whole face so its shape is never bent. At rest the cutoff
// is low and the jitter of the model is smoothed away; the faster the face moves,
// the higher the cutoff, so the smoothing, and its lag, fade out.
export function createSmoother({minCutoff=1.5,beta=20,dCutoff=1}={}){
  let prev=null,prevT=0,speed=0;
  const gain=(cutoff,dt)=>1/(1+1/(2*Math.PI*cutoff*dt));
  const probes=[1,10,152,234,454];
  return {
    reset(){prev=null;},
    // `t` in milliseconds: when the frame these landmarks came from was taken.
    smooth(next,t){
      if(!next){prev=null;return null;}
      if(!prev||prev.length!==next.length){prev=next;prevT=t;speed=0;return next;}
      const dt=Math.max(.001,(t-prevT)/1000);prevT=t;
      let move=0;for(const i of probes)move+=distance(prev[i],next[i])/probes.length;
      // Do not drag a stale mask onto a reacquired face.
      if(move>.1){prev=next;speed=0;return next;}
      speed+=gain(dCutoff,dt)*(move/dt-speed);
      const a=gain(minCutoff+beta*speed,dt);
      // Depth too: the edits are placed in 3D, so a jittery z would make them shimmer.
      prev=next.map((q,i)=>({...q,x:prev[i].x+(q.x-prev[i].x)*a,y:prev[i].y+(q.y-prev[i].y)*a,z:(prev[i].z||0)+((q.z||0)-(prev[i].z||0))*a}));
      return prev;
    }
  };
}

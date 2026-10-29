// The displacement field behind the procedure preview, in 3D.
//
// Every shape edit is a sum of localised deformers anchored on landmarks. They work on
// the face in 3D: MediaPipe gives each landmark a depth as well as its place in the
// picture, so every anchor, radius and direction is set in the head's own frame
// (across, down, and forward out of the face). The frame turns with the head, so an
// edit looks the same from the front, from three-quarters or in profile, and edits
// in depth (a nose hump, how far the chin comes forward) show as soon as the head
// turns. Each deformer decays to zero at its radius, measured through the face in 3D,
// so a nose edit never reaches the cheek behind it in profile, and an all-zero set of
// amounts is exactly the identity. warp.js carries the result onto the picture.
//
// A few controls change skin texture rather than shape (the non-surgical
// treatments). Those are not deformers: textureLayers() turns them into masked
// smoothing passes for the stage.
import {CANON3} from './facemesh.js?v=14';

// Region controls. Ids are stable: procedures and the fine-tuning panel address them.
// Shape controls run −100…100 with positive meaning "more"; texture controls 0…100.
// `depth` marks the ones that move the face towards or away from the camera, which a
// front-on view hardly shows. `modifies` marks one that only says where another acts,
// and moves nothing by itself. Left and right are the patient's: positive moves
// towards their left (landmark 454).
export const regions=[
  {id:'nose',name:'بینی'},{id:'lips',name:'لب'},{id:'cheeks',name:'گونه و شقیقه'},
  {id:'jaw',name:'فک و چانه'},{id:'eyes',name:'چشم و ابرو'},{id:'skin',name:'پوست'}
];
export const controls=[
  {id:'nose-width',   region:'nose',  name:'پهنای پرهٔ بینی',     help:'باریک یا پهن‌شدن پرهٔ بینی'},
  {id:'nose-bridge',  region:'nose',  name:'پهنای تیغهٔ بینی',    help:'باریک یا پهن‌شدن تیغهٔ بینی'},
  {id:'nose-tip',     region:'nose',  name:'چرخش نوک بینی',       help:'بالا یا پایین‌رفتن نوک بینی'},
  {id:'nose-tip-side',region:'nose',  name:'نوک بینی به چپ و راست',help:'جابه‌جایی نوک بینی به چپ یا راست، برای نوک کج؛ مثبت به سمت چپ بیمار'},
  {id:'nose-deviation',region:'nose', name:'کجی تیغهٔ بینی',      help:'چرخیدن کل بینی از ریشه به چپ یا راست، برای بینی کج؛ مثبت به سمت چپ بیمار'},
  {id:'nose-tip-size',region:'nose',  name:'حجم نوک بینی',        help:'ظریف یا گوشتی‌شدن نوک بینی'},
  {id:'nose-hump',    region:'nose',  name:'قوز بینی',            help:'کم یا بیشتر شدن قوز، همان‌جا که قوز این بینی است؛ با چرخاندن سر دیده می‌شود',depth:true},
  {id:'nose-hump-at', region:'nose',  name:'جای قوز',             help:'اگر قوز جای دیگری است، جای اصلاح را روی تیغه بالا یا پایین ببر (صفر: جایی که پیدا شده)',modifies:'nose-hump'},
  {id:'nose-projection',region:'nose',name:'جلوآمدگی نوک بینی',   help:'عقب یا جلو رفتن نوک بینی؛ با چرخاندن سر دیده می‌شود',depth:true},
  {id:'lip-fullness', region:'lips',  name:'حجم کلی لب',          help:'نازک یا پرتر شدن هر دو لب'},
  {id:'lip-upper',    region:'lips',  name:'حجم لب بالا',         help:'نازک یا پرتر شدن لب بالا'},
  {id:'lip-lower',    region:'lips',  name:'حجم لب پایین',        help:'نازک یا پرتر شدن لب پایین'},
  {id:'lip-center',   region:'lips',  name:'حجم وسط لب',          help:'بلندتر شدن وسط لب‌ها بدون پهن‌شدن گوشه‌ها (مثل لب روسی)'},
  {id:'lip-bow',      region:'lips',  name:'قوس لب بالا (M)',     help:'مشخص‌تر شدن دو قلهٔ لب بالا و فرورفتگی وسط آن'},
  {id:'lip-projection',region:'lips', name:'جلوآمدگی لب',         help:'جلوتر یا صاف‌تر شدن نیم‌رخ لب؛ با چرخاندن سر دیده می‌شود',depth:true},
  {id:'lip-width',    region:'lips',  name:'پهنای دهان',          help:'کوچک یا پهن‌شدن دهان'},
  {id:'lip-corners',  region:'lips',  name:'گوشهٔ لب',            help:'پایین یا بالا رفتن گوشه‌های لب'},
  {id:'lip-lift',     region:'lips',  name:'فاصلهٔ بینی تا لب',    help:'کوتاه‌شدن فاصلهٔ زیر بینی تا لب بالا'},
  {id:'cheek-volume', region:'cheeks',name:'برجستگی گونه',        help:'کم یا پرحجم‌شدن گونه‌ها'},
  {id:'cheek-hollow', region:'cheeks',name:'گودی زیر گونه',       help:'گودافتادن یا پرشدن زیر استخوان گونه'},
  {id:'temple',       region:'cheeks',name:'پری شقیقه',           help:'گود یا پرشدن شقیقه‌ها'},
  {id:'jaw-width',    region:'jaw',   name:'پهنای فک',            help:'باریک یا پهن‌شدن زاویهٔ فک'},
  {id:'jowl',         region:'jaw',   name:'لیفت خط فک',          help:'افتادگی یا کشیدگی پوست کنار چانه'},
  {id:'chin-length',  region:'jaw',   name:'بلندی چانه',          help:'کوتاه یا بلندشدن چانه'},
  {id:'chin-width',   region:'jaw',   name:'پهنای چانه',          help:'باریک یا پهن‌شدن چانه'},
  {id:'chin-projection',region:'jaw', name:'جلوآمدگی چانه',       help:'عقب یا جلو آمدن چانه؛ با چرخاندن سر دیده می‌شود',depth:true},
  {id:'eye-open',     region:'eyes',  name:'بازشدگی چشم',         help:'باز یا بسته‌تر شدن شکاف پلک'},
  {id:'eye-size',     region:'eyes',  name:'اندازهٔ چشم',         help:'کوچک یا بزرگ‌شدن چشم‌ها'},
  {id:'eye-tilt',     region:'eyes',  name:'کشیدگی گوشهٔ چشم',     help:'بالا رفتن گوشهٔ بیرونی چشم (فاکس‌آی)'},
  {id:'brow-lift',    region:'eyes',  name:'لیفت ابرو',           help:'بالا یا پایین‌رفتن کل ابرو'},
  {id:'brow-tail',    region:'eyes',  name:'دم ابرو',             help:'بالا یا پایین‌رفتن انتهای ابرو'},
  {id:'smooth-forehead',region:'skin',name:'صاف‌شدن پیشانی',      help:'کم‌شدن خطوط پیشانی و بین ابرو',texture:true},
  {id:'smooth-eyes',  region:'skin',  name:'صاف‌شدن دور چشم',     help:'کم‌شدن خطوط کنار و زیر چشم',texture:true},
  {id:'smooth-skin',  region:'skin',  name:'یکدستی پوست',         help:'نرم‌تر و یکدست‌تر شدن بافت پوست',texture:true},
  {id:'undereye',     region:'skin',  name:'روشن‌شدن زیر چشم',    help:'کم‌شدن گودی و تیرگی زیر چشم',texture:true}
];
export const controlRange=control=>control.texture?[0,100]:[-100,100];

export const zeroAmounts=()=>Object.fromEntries(controls.map(c=>[c.id,0]));

// Which landmarks each control anchors on, so the debug overlay can highlight the
// region a procedure is actually moving. clinic-check.cjs re-reads the p(N) calls in
// deformers() and fails if these fall behind the code.
export const frameLandmarks=[234,454,10,152,1];   // the head frame, used by every edit
export const controlLandmarks={
  'nose-width':[1,2],
  'nose-bridge':[168,6],
  'nose-tip':[1],
  'nose-tip-side':[1,2],
  'nose-deviation':[197,4],
  'nose-tip-size':[1,4],
  'nose-hump':[168,6,197,195,5,4],
  'nose-hump-at':[168,6,197,195,5,4],
  'nose-projection':[1,4],
  'lip-fullness':[0,17],
  'lip-upper':[0,13],
  'lip-lower':[14,17],
  'lip-center':[0,17],
  'lip-bow':[37,267,0],
  'lip-projection':[0,17],
  'lip-width':[13,14],
  'lip-corners':[61,291],
  'lip-lift':[0],
  'cheek-volume':[50,280],
  'cheek-hollow':[50,61,280,291,132,58,361,288],
  'temple':[162,21,70,389,251,300],
  'jaw-width':[172,397],
  'jowl':[150,136,379,365],
  'chin-length':[152],
  'chin-width':[175],
  'chin-projection':[199,175],
  'eye-open':[33,133,362,263],
  'eye-size':[33,133,362,263],
  'eye-tilt':[33,263],
  'brow-lift':[105,107,334,336],
  'brow-tail':[70,46,300,276],
  'smooth-forehead':[10,54,284,9],
  'smooth-eyes':[33,263,145,374],
  'smooth-skin':[10,152,234,454],
  'undereye':[145,374]
};

/* ---- 3D helpers -------------------------------------------------------- */
const sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z});
const add=(a,v,k=1)=>({x:a.x+v.x*k,y:a.y+v.y*k,z:a.z+v.z*k});
const mix=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t});
const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
const cross=(a,b)=>({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});
const len=v=>Math.hypot(v.x,v.y,v.z);
const unit=v=>{const l=len(v)||1;return {x:v.x/l,y:v.y/l,z:v.z/l};};
const blend=(a,ka,b,kb)=>unit({x:a.x*ka+b.x*kb,y:a.y*ka+b.y*kb,z:a.z*ka+b.z*kb});
const neg=v=>({x:-v.x,y:-v.y,z:-v.z});

// The landmarks in pixels, in 3D. MediaPipe gives x and y as fractions of the frame
// and z (smaller is nearer the camera) on roughly the scale of x, so z is scaled by
// the width too.
export function points3(landmarks,W,H){
  return landmarks.map(l=>({x:l.x*W,y:l.y*H,z:(l.z||0)*W}));
}

// The head's own frame, from the landmarks: `ex` across the face towards landmark
// 454, `ey` down it, `ez` forward out of the face (towards the camera when it faces
// it), the face's width ear to ear, and a point at the middle of the head.
export function headFrame(P){
  const left=P[234],right=P[454];
  const ex=unit(sub(right,left));
  const down=sub(P[152],P[10]);               // forehead to chin: upright in depth too
  const ey=unit(add(down,ex,-dot(down,ex)));
  let ez=unit(cross(ey,ex));
  const middle=mix(left,right,.5);
  // Whichever way round the picture is, forward is the way the nose points.
  if(dot(sub(P[1],middle),ez)<0)ez=neg(ez);
  const face=len(sub(right,left))||1;
  return {ex,ey,ez,face,center:add(middle,ez,-face*.25)};
}

// The bridge of the nose, from its root to just above the tip, and where a hump is
// looked for on it (6, 197, 195: the tip's own curve, past 195, is not a hump).
export const BRIDGE=[168,6,197,195,5,4];
const SEARCH=[1,2,3];
// The way out of the bridge: forward, square to the line from its root to its tip.
function outOf(P,ez){
  const AB=unit(sub(P[BRIDGE[BRIDGE.length-1]],P[BRIDGE[0]]));
  return unit(add(ez,AB,-dot(ez,AB)));
}
// How far each point of the bridge stands out of the straight line from its root to
// its tip, as a share of face width.
function standOut(P,ez,face){
  const A=P[BRIDGE[0]],AB=sub(P[BRIDGE[BRIDGE.length-1]],A),ab2=dot(AB,AB)||1,n=outOf(P,ez);
  return BRIDGE.map(i=>{
    const q=P[i],t=dot(sub(q,A),AB)/ab2;
    return {t,e:dot(sub(q,add(A,AB,t)),n)/face};
  });
}
// The same on MediaPipe's average face, which every bridge curves like a little.
let average=null;
function averageBridge(){
  if(!average){
    const C=[];for(let i=0;i<CANON3.length/3;i++)C.push({x:CANON3[i*3],y:CANON3[i*3+1],z:-CANON3[i*3+2]});
    const {ez,face}=headFrame(C);
    average=standOut(C,ez,face).map(b=>b.e);
  }
  return average;
}
// The hump on this nose: how far each point of the bridge stands out against the
// average bridge (`d`, a share of face width, at `t` from root 0 to tip 1), and the
// peak. The peak is a soft maximum over the points a hump is looked for at, so it
// slides between landmarks as the face moves instead of jumping from one to the
// next; with nothing standing out it settles near 197, where humps usually are.
const SOFT=.004;
export function hump(P,frame=headFrame(P)){
  const avg=averageBridge();
  const b=standOut(P,frame.ez,frame.face),t=b.map(x=>x.t),d=b.map((x,i)=>x.e-avg[i]);
  // Along the bridge at `at`: the point on it, and how far it stands out there.
  const along=at=>{
    let i=0;while(i<t.length-2&&t[i+1]<at)i++;
    const f=Math.max(0,Math.min(1,(at-t[i])/((t[i+1]-t[i])||1)));
    return {point:mix(P[BRIDGE[i]],P[BRIDGE[i+1]],f),d:d[i]+(d[i+1]-d[i])*f};
  };
  const top=Math.max(...SEARCH.map(i=>d[i]));
  let sw=0,st=0;
  for(const i of SEARCH){const w=Math.exp((d[i]-top)/SOFT);sw+=w;st+=w*t[i];}
  const peakT=st/sw;
  return {t,d,peak:{t:peakT,d:along(peakT).d},along,out:outOf(P,frame.ez)};
}

const AXIS=0, RADIAL=1, SHIFT=2;
// Through the face, depth counts for half when measuring how far a point is from an
// anchor: far enough that a nose edit does not reach the cheek behind it in profile,
// near enough that the side of the nose, which sits well behind its tip, still moves
// with it as much as it did when the edits were tuned on the face seen from the front.
const DEPTH_WEIGHT=.5, SQUASH=1-DEPTH_WEIGHT*DEPTH_WEIGHT;

// The deformers for these amounts on this face. P: the landmarks from points3().
export function deformers(P, amounts) {
  const p=i=>P[i];
  const {ex,ey,ez,face}=headFrame(P);
  const up=neg(ey), fwd=ez, back=neg(ez);
  const out=[];
  const at=id=>(amounts[id]||0)/100;

  const push=(anchor,r,kind,v,a)=>a&&out.push({x:anchor.x,y:anchor.y,z:anchor.z,r,kind,vx:v.x,vy:v.y,vz:v.z,a,
    fx:ez.x,fy:ez.y,fz:ez.z});
  const axis=(anchor,r,v,gain)=>push(anchor,r,AXIS,v,gain);
  const radial=(anchor,r,gain)=>push(anchor,r,RADIAL,{x:0,y:0,z:0},gain);
  const shift=(anchor,r,v,gain)=>push(anchor,r,SHIFT,{x:v.x*r,y:v.y*r,z:v.z*r},gain);

  // Gains are tuned so a control at 100 is a clear but still plausible change. The
  // edits in depth are a few percent of the face's width, the size of the real thing:
  // a hump of 2–4 mm, a chin implant bringing the chin 5–10 mm forward.
  /* nose */
  axis(mix(p(1),p(2),.5), face*.20, ex, at('nose-width')*.75);
  axis(mix(p(168),p(6),.5), face*.14, ex, at('nose-bridge')*.70);
  shift(p(1), face*.16, up, at('nose-tip')*.60);
  // Sideways, for a crooked nose: the tip alone, or the whole nose turning about its
  // root (more at the tip than half way down, nothing at the root).
  shift(mix(p(1),p(2),.3), face*.12, ex, at('nose-tip-side')*.25);
  shift(p(197), face*.12, ex, at('nose-deviation')*.10);
  shift(p(4),   face*.14, ex, at('nose-deviation')*.17);
  radial(mix(p(1),p(4),.5), face*.10, at('nose-tip-size')*.45);
  // The hump, where this nose has it (hump()), or moved along the bridge by
  // nose-hump-at. Taken off, the bridge there comes back (straight back, so nothing
  // changes from the front, by enough to come back as far square to the bridge) by as
  // much as it stands out against the average bridge, and by at least 2% of the
  // face's width (~3 mm) so the control does something on a bridge that is already
  // straight; made bigger, it grows by 2.5%. The change fades out before the root and
  // before the tip (up to 11% of the face's width each way), so it reads as a
  // straighter line, not a dent, and the root and the tip stay where they are.
  const humpAmount=at('nose-hump');
  if(humpAmount){
    const h=hump(P,{ex,ey,ez,face});
    const there=h.along(Math.max(.08,Math.min(.85,h.peak.t-at('nose-hump-at')*.3)));
    const room=Math.min(len(sub(there.point,p(BRIDGE[0]))),len(sub(there.point,p(BRIDGE[BRIDGE.length-1]))));
    const r=Math.max(face*.05,Math.min(face*.11,room));
    const size=humpAmount<0?Math.max(there.d,.02):.025;
    const square=Math.max(.5,dot(h.out,fwd));
    shift(there.point, r, fwd, humpAmount*size*face/r/square);
  }
  shift(mix(p(1),p(4),.5), face*.13, fwd, at('nose-projection')*.25);

  /* lips: fuller lips also stand a little further forward */
  axis(mix(p(0),p(17),.5), face*.26, ey, at('lip-fullness')*.75);
  shift(mix(p(0),p(17),.5), face*.18, fwd, at('lip-fullness')*.10);
  axis(mix(p(0),p(13),.5), face*.13, ey, at('lip-upper')*.65);
  axis(mix(p(14),p(17),.5), face*.14, ey, at('lip-lower')*.65);
  // Height in the middle of the lips only, the corners left as they are.
  axis(mix(p(0),p(17),.5), face*.13, ey, at('lip-center')*.60);
  // The two peaks of the upper lip up, the dip between them a little down: an M.
  shift(p(37),  face*.045, up, at('lip-bow')*.35);
  shift(p(267), face*.045, up, at('lip-bow')*.35);
  shift(p(0),   face*.03,  ey, at('lip-bow')*.15);
  shift(mix(p(0),p(17),.5), face*.16, fwd, at('lip-projection')*.12);
  axis(mix(p(13),p(14),.5), face*.30, ex, at('lip-width')*.35);
  shift(p(61),  face*.08, up, at('lip-corners')*.30);
  shift(p(291), face*.08, up, at('lip-corners')*.30);
  shift(p(0), face*.10, up, at('lip-lift')*.28);

  /* cheeks and temples: volume comes forward as well as out */
  radial(p(50),  face*.24, at('cheek-volume')*.58);
  radial(p(280), face*.24, at('cheek-volume')*.58);
  shift(p(50),  face*.22, blend(fwd,1,neg(ex),.4), at('cheek-volume')*.12);
  shift(p(280), face*.22, blend(fwd,1,ex,.4),      at('cheek-volume')*.12);
  // Buccal hollow sits lower and more forward than the cheekbone itself; from the
  // front, the visible change is the lower cheek line moving in.
  radial(mix(p(50),p(61),.62),  face*.21, -at('cheek-hollow')*.60);
  radial(mix(p(280),p(291),.62),face*.21, -at('cheek-hollow')*.60);
  shift(mix(p(50),p(61),.62),  face*.18, back, at('cheek-hollow')*.10);
  shift(mix(p(280),p(291),.62),face*.18, back, at('cheek-hollow')*.10);
  shift(mix(p(132),p(58),.5), face*.20, ex,      at('cheek-hollow')*.16);
  shift(mix(p(361),p(288),.5),face*.20, neg(ex), at('cheek-hollow')*.16);
  shift(mix(mix(p(162),p(21),.5),p(70),.3),  face*.15, neg(ex), at('temple')*.25);
  shift(mix(mix(p(389),p(251),.5),p(300),.3),face*.15, ex,      at('temple')*.25);

  /* jaw and chin */
  shift(p(172), face*.34, neg(ex), at('jaw-width')*.32);
  shift(p(397), face*.34, ex,      at('jaw-width')*.32);
  shift(mix(p(150),p(136),.5), face*.20, blend(up,.85,ex,.5),      at('jowl')*.22);
  shift(mix(p(379),p(365),.5), face*.20, blend(up,.85,neg(ex),.5), at('jowl')*.22);
  shift(p(152), face*.26, ey, at('chin-length')*.34);
  axis(p(175), face*.17, ex, at('chin-width')*.55);
  shift(mix(p(199),p(175),.5), face*.26, fwd, at('chin-projection')*.25);

  /* eyes and brows */
  const leftEye=mix(p(33),p(133),.5), rightEye=mix(p(362),p(263),.5);
  radial(leftEye,  face*.15, at('eye-size')*.55);
  radial(rightEye, face*.15, at('eye-size')*.55);
  axis(leftEye,  face*.13, ey, at('eye-open')*.60);
  axis(rightEye, face*.13, ey, at('eye-open')*.60);
  shift(p(33),  face*.085, blend(up,1,neg(ex),.3), at('eye-tilt')*.24);
  shift(p(263), face*.085, blend(up,1,ex,.3),      at('eye-tilt')*.24);
  shift(mix(p(105),p(107),.5), face*.20, up, at('brow-lift')*.22);
  shift(mix(p(334),p(336),.5), face*.20, up, at('brow-lift')*.22);
  shift(mix(p(70),p(46),.5),   face*.10, up, at('brow-tail')*.28);
  shift(mix(p(300),p(276),.5), face*.10, up, at('brow-tail')*.28);
  return out;
}

// d(q) = Σ amount · smoothstep(1 − |q−anchor|/r) · direction, with |q−anchor| in 3D
// and its depth (along the head's forward axis) at DEPTH_WEIGHT.
export function displace(defs, x, y, z, out) {
  let dx=0, dy=0, dz=0;
  for (let i=0;i<defs.length;i++) {
    const d=defs[i], ax=x-d.x, ay=y-d.y, az=z-d.z, depth=ax*d.fx+ay*d.fy+az*d.fz;
    const dist2=ax*ax+ay*ay+az*az-SQUASH*depth*depth;
    if (dist2>=d.r*d.r) continue;
    const t=1-Math.sqrt(dist2)/d.r, s=t*t*(3-2*t)*d.a;
    if (d.kind===AXIS) {const proj=ax*d.vx+ay*d.vy+az*d.vz; dx+=s*proj*d.vx; dy+=s*proj*d.vy; dz+=s*proj*d.vz;}
    else if (d.kind===RADIAL) {dx+=s*ax; dy+=s*ay; dz+=s*az;}
    else {dx+=s*d.vx; dy+=s*d.vy; dz+=s*d.vz;}
  }
  out.x=dx; out.y=dy; out.z=dz;
}

// Every landmark's displacement in 3D pixels, as x,y,z triples; null when the amounts
// move nothing.
export function displacements(P, amounts){
  const defs=deformers(P,amounts);
  if(!defs.length)return null;
  const out=new Float32Array(P.length*3),o={x:0,y:0,z:0};
  for(let i=0;i<P.length;i++){
    displace(defs,P[i].x,P[i].y,P[i].z,o);
    out[i*3]=o.x;out[i*3+1]=o.y;out[i*3+2]=o.z;
  }
  return out;
}

// The texture controls as stage layers: masked, edge-preserving smoothing, and a
// gentle lift for the under-eye area. Masks come from masks.js's zones.
export function textureLayers(amounts){
  const out=[];
  const at=id=>Math.max(0,Math.min(100,amounts[id]||0))/100;
  if(at('smooth-skin'))    out.push({key:'tx:skin',    zone:'skin',    smooth:at('smooth-skin')*.85});
  if(at('smooth-forehead'))out.push({key:'tx:forehead',zone:'forehead',smooth:at('smooth-forehead')});
  if(at('smooth-eyes'))    out.push({key:'tx:eyes',    zone:'eyes',    smooth:at('smooth-eyes')});
  if(at('undereye'))       out.push({key:'tx:undereye',zone:'undereye',smooth:at('undereye')*.5,bright:at('undereye')});
  return out;
}

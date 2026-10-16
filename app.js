import {createStage,layerModes} from './stage.js?v=2';
import {controls,regions,controlLandmarks,controlRange,frameLandmarks,points3,deformers,displacements,textureLayers} from './deform.js?v=2';
import {procedures,byId,amountsFor,resolve,kinds} from './procedures.js?v=2';
import {renderDebug,nearest} from './debug.js?v=2';
import {metrics,measure,moved,symmetry,pose as poseOf} from './measure.js?v=2';
import {createWarp,MESH} from './warp.js?v=2';
import {CANON,CANON_ASPECT} from './facemesh.js?v=2';
import {createMaskPainter,createSmoother} from './masks.js?v=2';

const $=id=>document.getElementById(id);
// A host or CDN can keep a page for a few minutes: just after a release, a page kept
// from the one before can be handed this newer script, which would then look for
// elements that page does not have. Such a page is loaded afresh, once; if it is still
// the old one, it says a new version is on its way instead of failing.
const RELEASE='2';
if(document.documentElement.dataset.release!==RELEASE){
  let tried=null;
  try{tried=sessionStorage.getItem('clinic-reloaded');sessionStorage.setItem('clinic-reloaded',RELEASE);}catch{}
  document.documentElement.dataset.ready='1';           // keeps the page's own error note quiet
  const status=$('status');
  if(tried!==RELEASE){
    if(status)status.textContent='نسخهٔ تازه بار می‌شود…';
    location.reload();
  }else if(status)status.textContent='نسخهٔ تازه در راه است؛ چند دقیقهٔ دیگر صفحه را دوباره باز کن.';
  throw new Error(`a page from an older release than ${RELEASE}: not started`);
}
const fa=new Intl.NumberFormat('fa-IR');
const fa1=new Intl.NumberFormat('fa-IR',{minimumFractionDigits:1,maximumFractionDigits:1});
const fa2=new Intl.NumberFormat('fa-IR',{minimumFractionDigits:2,maximumFractionDigits:2});
const pct=n=>fa.format(Math.round(n))+'٪';
const el=(tag,props={},...children)=>{
  const node=document.createElement(tag);
  for(const [k,v] of Object.entries(props)){
    if(k==='class')node.className=v;
    else if(k==='style')Object.assign(node.style,v);
    else if(k==='data')Object.assign(node.dataset,v);
    else if(k.startsWith('on'))node[k]=v;
    else if(k==='text')node.textContent=v;
    else node.setAttribute(k,v);
  }
  node.append(...children.filter(c=>c!=null&&c!==false));
  return node;
};

const video=$('video'), photo=$('photo'), overlay=$('overlay'), octx=overlay.getContext('2d');
const ua=navigator.userAgent;
const iOS=/iPad|iPhone|iPod/.test(ua)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
function cameraHelp(){
  if(iOS)return 'در Safari روی «aA» کنار نشانی بزن، «تنظیمات وب‌سایت» و بعد «دوربین» را روی «اجازه» بگذار.';
  return 'از تنظیمات سایت در مرورگر، دسترسی دوربین را فعال کن.';
}
const code=e=>` (کد: ${e?.name&&e.name!=='Error'?e.name:e?.message||'نامشخص'})`;
const debugCanvas=$('debug'), debugCtx=debugCanvas.getContext('2d');
const viewport=$('viewport');

/* ---------- state ------------------------------------------------------- */
let source=null;                         // {kind:'camera'|'photo', el, width, height, live, version}
let landmarks=null, poseAngles=null, blendshapes=null;
let stage=null, stageBroken=false;
let seam=0.5, seamOn=false, compare=true;
let frozen=false;
let masksDirty=true, dirty=true, debugDirty=true, measureDirty=true;
const shots=[];

const active=new Map();                  // procedure id -> strength 0..100
const variants=new Map();                // procedure id -> variant id
let currentProcedure=null;
const overrides=Object.fromEntries(controls.map(c=>[c.id,0]));
let procGroup=null;

const painter=createMaskPainter();
const warper=createWarp();
const debug={on:false,points:true,mesh:false,contours:false,axes:false,masks:false,field:false,
  labelSize:10,highlight:true,onlyActive:false,find:null,hud:false,inspect:false};
let topology=null, maskView=null;
const maskTint=document.createElement('canvas');
const perf={frames:0,fps:0,since:0,draws:0,drawn:0,detections:0,hz:0,latency:0,inferMs:0,lastHud:0,maskMs:0,drawMs:0,lastError:'',trackerNote:''};
const ema=(old,v)=>old?old*.85+v*.15:v;

/* ---------- small helpers ----------------------------------------------- */
function paintRange(input){
  const min=Number(input.min||0),max=Number(input.max||100);
  input.style.setProperty('--fill',((Number(input.value)-min)/(max-min)*100)+'%');
}
function setRange(id,value){const input=$(id);input.value=value;paintRange(input);}
document.addEventListener('input',e=>{if(e.target.type==='range')paintRange(e.target);});

function frameSize(){return source?{w:source.width,h:source.height}:{w:640,h:480};}
function faceWidthPx(){
  if(!landmarks)return 0;
  const {w,h}=frameSize();
  return Math.hypot((landmarks[454].x-landmarks[234].x)*w,(landmarks[454].y-landmarks[234].y)*h);
}
function invalidate({masks=false,measure=false}={}){
  dirty=true;debugDirty=true;
  if(masks)masksDirty=true;
  if(measure)measureDirty=true;
}

let toastTimer;
function toast(message){
  $('toast').textContent=message;$('toast').classList.add('show');
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),2600);
}
function status(text){$('status').textContent=text;}

/* ---------- procedures -------------------------------------------------- */
const procedureAmounts=()=>amountsFor(active,overrides,variants);
const anyProcedure=()=>[...active.values()].some(v=>v>0)||controls.some(c=>overrides[c.id]!==0);
// Whether something on now changes the face in depth, which shows only as the head turns.
const DEPTH=controls.filter(c=>c.depth).map(c=>c.id);
const anyDepth=()=>{const a=procedureAmounts();return DEPTH.some(id=>a[id]);};

function showProcedure(id){
  currentProcedure=id;
  const procedure=byId(id);
  $('quick-procedure').hidden=!procedure;
  $('procedure-reset').hidden=!anyProcedure();
  $('procedure-facts').hidden=!procedure;
  $('variant-field').hidden=!procedure?.variants;
  if(!procedure){
    $('procedure-kicker').textContent='عمل‌های زیبایی';
    $('procedure-title').textContent='یک عمل را انتخاب کن';
    $('procedure-summary').textContent='از نوار زیر تصویر عملی را بزن تا نتیجهٔ تقریبی آن روی صورت ساخته شود. برای دیدن چند عمل با هم، «ترکیب چند عمل با هم» را روشن کن.';
    $('procedure-note').textContent='';
    renderActiveList();
    return;
  }
  const {kind,variant}=resolve(procedure,variants.get(id));
  const strength=active.get(id)||0;
  $('procedure-kicker').textContent=`عمل‌های زیبایی · ${regions.find(r=>r.id===procedure.region)?.name}`;
  $('procedure-title').textContent=procedure.name;
  $('procedure-summary').textContent=procedure.summary;
  $('procedure-note').textContent=procedure.note;
  $('fact-kind').textContent=kinds[kind];
  $('fact-lasts').textContent=procedure.lasts;
  $('fact-recovery').textContent=procedure.recovery;
  $('variant-options').replaceChildren(...(procedure.variants||[]).map(v=>el('button',{type:'button',role:'radio',
    'aria-checked':String(v.id===variant?.id),data:{variant:v.id},text:v.name,
    onclick:()=>{variants.set(id,v.id);showProcedure(id);invalidate({masks:true,measure:true});}})));
  $('strength-label').textContent=`میزان ${procedure.name}`;
  setRange('strength',strength);$('strength-amount').textContent=pct(strength);
  renderActiveList();
}
function renderActiveList(){
  $('active-list').replaceChildren(...[...active].filter(([,v])=>v>0).map(([id,v])=>{
    const procedure=byId(id);
    return el('button',{type:'button','aria-current':String(id===currentProcedure),onclick:()=>showProcedure(id),
      title:'انتخاب برای تنظیم'},procedure.name,' ',el('b',{text:pct(v)}));
  }));
}
// One procedure at a time unless "combine" is on: picking another replaces the one
// shown, which is what most people expect. Combined, each one picked is added.
const COMBINE='clinic-combine';
try{$('combine-procedures').checked=localStorage.getItem(COMBINE)==='1';}catch{}
function activateProcedure(id){
  if(active.has(id))return;
  if(!$('combine-procedures').checked)active.clear();
  setStrength(id,60);
}
function setStrength(id,value){
  if(value>0)active.set(id,value);else active.delete(id);
  $('procedure-reset').hidden=!anyProcedure();
  buildTray();renderActiveList();updateSeam();invalidate({masks:true,measure:true});
  status(statusText());
}

/* ---------- the seam ---------------------------------------------------- */
const seamLabels=()=>['پیش از عمل','پس از عمل'];
function updateSeam(){
  seamOn=!!source&&!!stage&&compare&&anyProcedure();
  $('seam').hidden=!seamOn;
  if(seamOn){
    const [before,after]=seamLabels();
    $('seam-before').textContent=before;$('seam-after').textContent=after;
    placeSeam();
  }
  $('compare').setAttribute('aria-pressed',String(compare));
}
// object-fit:contain letterboxes the frame inside the stage, so the seam must be
// measured and drawn against the displayed frame rather than the whole element.
function videoBox(){
  const rect=viewport.getBoundingClientRect();
  const {w,h}=frameSize();
  const ratio=w/h||4/3;
  let width=rect.width, height=rect.width/ratio;
  if(height>rect.height){height=rect.height;width=rect.height*ratio;}
  return {rect,left:(rect.width-width)/2,top:(rect.height-height)/2,width,height};
}
function placeSeam(){
  const box=videoBox();
  const x=box.left+seam*box.width;
  const line=$('seam-line');
  line.style.left=x+'px';line.style.top=box.top+'px';
  line.style.height=box.height+'px';line.style.bottom='auto';
  $('seam-grip').style.left=x+'px';
  $('seam-grip').setAttribute('aria-valuenow',String(Math.round(seam*100)));
  $('seam-before').style.left=(box.left+12)+'px';$('seam-before').style.right='';
  $('seam-after').style.right=(box.left+12)+'px';$('seam-after').style.left='';
}
// A pointer position as a point in frame pixels. The frame is mirrored on screen.
function framePoint(event){
  const box=videoBox(),{w,h}=frameSize();
  const fx=(event.clientX-box.rect.left-box.left)/box.width,fy=(event.clientY-box.rect.top-box.top)/box.height;
  return {x:(1-fx)*w,y:fy*h,inside:fx>=0&&fx<=1&&fy>=0&&fy<=1,
    screenX:event.clientX-box.rect.left,screenY:event.clientY-box.rect.top,scale:box.width/w};
}

/* ---------- tray -------------------------------------------------------- */
function buildTray(){
  const groups=$('tray-groups'),chips=$('tray-chips');
  groups.replaceChildren();chips.replaceChildren();
  for(const region of regions){
    const list=procedures.filter(p=>p.region===region.id);
    if(!list.length)continue;
    groups.append(el('button',{type:'button','aria-pressed':String(region.id===procGroup),data:{group:region.id},text:region.name,
      onclick:()=>{procGroup=region.id;groups.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.group===region.id)));
        chips.querySelector(`[data-sep="${region.id}"]`)?.scrollIntoView({inline:'start',block:'nearest'});}}));
    chips.append(el('span',{class:'tray-sep',data:{sep:region.id},text:region.name}));
    for(const procedure of list){
      const strength=active.get(procedure.id)||0;
      const b=el('button',{class:'chip',type:'button',data:{procedure:procedure.id},'aria-pressed':String(strength>0)},procedure.name);
      if(strength>0)b.append(el('span',{class:'on',text:pct(strength)}));
      b.onclick=()=>{activateProcedure(procedure.id);showProcedure(procedure.id);};
      chips.append(b);
    }
  }
}

function statusText(){
  if(!source)return 'برای شروع، دوربین را روشن کن یا یک عکس انتخاب کن.';
  if(!landmarks){
    if(source.kind==='photo')return photoPasses>=PHOTO_PASSES?'در این عکس صورتی پیدا نشد. عکسی از روبه‌رو و با نور کافی انتخاب کن.':'در حال پیدا کردن صورت در عکس…';
    return 'صورت را روبه‌روی دوربین نگه دار.';
  }
  // The edits are in 3D and follow the head, so turning is fine, up to where the
  // tracker itself starts to lose the far side of the face.
  if(poseAngles&&(Math.abs(poseAngles.yaw)>55||Math.abs(poseAngles.pitch)>35))
    return 'از این زاویه بیشتر، تشخیص چهره دقت کمتری دارد.';
  if(frozen)return 'تصویر ثابت است. برای ادامه، دوباره «ثابت» را بزن.';
  if(anyDepth()&&poseAngles&&Math.abs(poseAngles.yaw)<12)
    return 'این تغییر در نیم‌رخ است: سر را کمی به چپ و راست بچرخان تا دیده شود.';
  return anyProcedure()?'مرز روی تصویر را بکش تا پیش و پس از عمل را مقایسه کنی.':'یک عمل را از نوار زیر تصویر انتخاب کن.';
}

/* ---------- drawing ----------------------------------------------------- */
function ensureStage(){
  if(!stage&&!stageBroken){
    stage=createStage($('stage'));
    if(!stage){stageBroken=true;$('webgl-missing').hidden=false;}
    else{masksDirty=true;queueMicrotask(updateSeam);}
  }
  return stage;
}
function textureLayer(t,face){
  return {key:t.key,color:[1,1,1],amount:1,mode:layerModes.smooth,detail:0,gloss:0,matte:0,shimmer:0,
    smooth:t.smooth,bright:t.bright||0,radius:Math.max(2,face*.035),radiusK:.035};
}
// What the stage should draw right now: the "after" side, and the untouched "before"
// side when there is something to compare.
function plan(){
  const amounts=procedureAmounts();
  return {textures:textureLayers(amounts),amounts,before:anyProcedure()};
}
// Masks are painted in the face's own front-on space (facemesh.js) and the stage
// carries them onto the live face each frame, so they are repainted only when a
// treatment changes, never because the face moved.
const FACE_W=768, FACE_H=Math.round(FACE_W*CANON_ASPECT);
const canonLandmarks=Array.from({length:CANON.length/2},(_,i)=>({x:CANON[i*2],y:CANON[i*2+1]}));
const maskCrop=document.createElement('canvas');
const maskSpecs=p=>p.textures.map(t=>({key:t.key,zone:t.zone,fade:60}));
function rebuildMasks(p){
  const specs=maskSpecs(p);
  const cx=maskCrop.getContext('2d');
  for(const spec of specs){
    const canvas=painter.paint(spec,canonLandmarks,FACE_W,FACE_H);
    // Only the painted part is uploaded; the stage treats the rest as empty.
    const b=painter.box,W=canvas.width,H=canvas.height;
    const x0=Math.floor(b.x*W),y0=Math.floor(b.y*H),x1=Math.ceil((b.x+b.w)*W),y1=Math.ceil((b.y+b.h)*H);
    const cw=Math.max(1,x1-x0),ch=Math.max(1,y1-y0);
    maskCrop.width=cw;maskCrop.height=ch;
    cx.drawImage(canvas,x0,y0,cw,ch,0,0,cw,ch);
    stage.setMask(spec.key,maskCrop,{x:x0/W,y:y0/H,w:cw/W,h:ch/H});
  }
  stage.dropMasks(new Set(specs.map(s=>s.key)));
  masksDirty=false;
}
// The debug overlay's view of the masks, on the frame: painted the slow way, from the
// live landmarks, and only while that view is open.
function paintMaskView(p){
  const {w,h}=frameSize();
  if(!maskView)maskView=document.createElement('canvas');
  maskView.width=w;maskView.height=h;
  if(maskTint.width!==w||maskTint.height!==h){maskTint.width=w;maskTint.height=h;}
  const mv=maskView.getContext('2d'),t=maskTint.getContext('2d');
  for(const spec of maskSpecs(p)){
    const canvas=painter.paint(spec,landmarks,w,h);
    t.globalCompositeOperation='source-over';t.clearRect(0,0,w,h);t.drawImage(canvas,0,0,w,h);
    t.globalCompositeOperation='source-in';t.fillStyle='#69F0AE';t.fillRect(0,0,w,h);
    mv.drawImage(maskTint,0,0);
  }
}
// Both cheeks, the forehead and the chin: where the light on the face is read.
function probes(){
  return [50,280,151,199].flatMap(i=>[landmarks[i].x,landmarks[i].y]).map(v=>Math.min(.99,Math.max(.01,v)));
}
function draw(now=performance.now()){
  if(!source){octx.clearRect(0,0,overlay.width,overlay.height);return;}
  const {w,h}=frameSize();
  if(overlay.width!==w||overlay.height!==h){overlay.width=w;overlay.height=h;}
  const p=plan();
  const gl=ensureStage();
  // The warp follows the face, so it is worked out again for every frame drawn.
  const warp=gl&&landmarks&&p.before?warper.compute(landmarks,w,h,p.amounts):null;
  if(!gl){
    // The procedures need WebGL; without it the picture is shown as it is.
    $('stage').hidden=true;photo.hidden=source.kind!=='photo';dirty=false;return;
  }
  const face=faceWidthPx();
  if(debug.on&&debug.masks&&landmarks&&(dirty||masksDirty))paintMaskView(p);
  if(masksDirty){const t=performance.now();rebuildMasks(p);perf.maskMs=ema(perf.maskMs,performance.now()-t);}
  const t=performance.now();
  const sync=source.kind==='camera'&&syncing();
  const ok=gl.draw({
    source:sync?shown:source.el,width:w,height:h,
    version:sync?`s${shownVersion}`:source.version,live:source.live&&!sync,landmarks,
    after:{layers:p.textures.map(x=>textureLayer(x,face)),warp},
    before:p.before?{layers:[],warp:null}:null,
    seam:seamOn?1-seam:null,grade:null,
    probes:landmarks?probes():null,time:now/1000
  });
  perf.drawMs=ema(perf.drawMs,performance.now()-t);perf.draws++;
  if(!ok&&sync){stepBroken=true;perf.lastError='in step: the frame could not be drawn';dirty=true;return;}
  if(ok){
    // The canvas covers the video exactly. The video stays visible underneath: iOS
    // pauses a muted video it thinks is hidden, which froze the camera on its first
    // frame.
    $('stage').hidden=false;photo.hidden=true;
    octx.clearRect(0,0,w,h);
  }
  dirty=false;
}

// The landmarks driving what is on screen right now: the anchors of every control a
// procedure is moving.
function activeLandmarks(){
  const set=new Set(frameLandmarks);
  const amounts=procedureAmounts();
  for(const control of controls)
    if(amounts[control.id])
      for(const index of controlLandmarks[control.id]||[])set.add(index);
  return set;
}

// Hundreds of numbered labels are not cheap, so this only redraws when the points,
// the selection or the settings actually change, not on every animation frame.
let debugDrawn=null,debugSettings='';
function drawDebug(){
  const on=debug.on&&!!source;
  debugCanvas.hidden=!on;
  if(!on){debugDrawn=null;return;}
  const {w,h}=frameSize();
  if(debugCanvas.width!==w||debugCanvas.height!==h){debugCanvas.width=w;debugCanvas.height=h;debugDrawn=null;}
  const set=activeLandmarks();
  const settings=JSON.stringify({...debug,hud:0,inspect:0})+[...set].join()+(masksDirty?1:0);
  if(landmarks===debugDrawn&&settings===debugSettings&&!debugDirty)return;
  debugDrawn=landmarks;debugSettings=settings;debugDirty=false;
  renderDebug(debugCtx,landmarks,{...debug,active:set,topology,
    field:debug.field?fieldView():null,
    masks:debug.masks&&maskView?maskView:null});
  $('debug-count').textContent=set.size>frameLandmarks.length
    ? `${fa.format(set.size)} نقطه در این لحظه درگیرند.`
    : 'هیچ عملی فعال نیست.';
}

// The warp, for the debug overlay: each visible mesh point's move in the picture, and
// every deformer's anchor and reach.
function fieldView(){
  const last=warper.last;
  if(!last)return null;
  const {P,d,facing}=last,arrows=[];
  for(let i=0;i<MESH;i++){
    if(!facing[i])continue;
    const dx=d[i*3],dy=d[i*3+1];
    if(Math.hypot(dx,dy)>=.25)arrows.push(P[i].x,P[i].y,dx,dy);
  }
  return {arrows,anchors:deformers(P,procedureAmounts()).map(x=>({x:x.x,y:x.y,r:x.r}))};
}

/* ---------- measurements ------------------------------------------------ */
let lastMeasure=0;
function renderMeasure(now){
  if(!measureDirty||now-lastMeasure<180)return;
  lastMeasure=now;measureDirty=false;
  const table=$('measure-table');
  if(!landmarks){table.replaceChildren(el('span',{class:'empty',text:'صورت روی تصویر نیست.'}));return;}
  const {w,h}=frameSize();
  const P=points3(landmarks,w,h);
  const before=measure(P);
  const after=measure(moved(P,anyProcedure()?displacements(P,procedureAmounts()):null));
  const cells=[el('span',{class:'h',text:'اندازه'}),el('span',{class:'h',text:'پیش'}),el('span',{class:'h',text:'پس'}),el('span',{class:'h',text:'تغییر'})];
  const format=m=>m.unit==='×'?fa2.format(m.value):m.unit==='°'?fa1.format(m.value)+'°':fa1.format(m.value)+'٪';
  for(const metric of metrics){
    const a=before[metric.id],b=after[metric.id];
    // A ratio or a length changes by a share of itself; an angle, or a measure that
    // can be near zero or below it (`abs`), by the difference.
    const change=metric.abs?b.value-a.value:(b.value-a.value)/(Math.abs(a.value)||1)*100;
    const shifted=Math.abs(change)>=(metric.abs?.3:.5);
    const cls=shifted?'changed':'';
    const sign=change>0?'+':change<0?'−':'';
    cells.push(el('span',{class:cls,text:metric.name}),el('span',{class:cls,text:format(a)}),el('span',{class:cls,text:format(b)}),
      el('span',{class:`${cls} ${shifted?(change>0?'up':'down'):''}`,text:shifted?(metric.abs?`${sign}${fa1.format(Math.abs(change))}${metric.unit==='°'?'°':''}`:`${sign}${fa.format(Math.round(Math.abs(change)))}٪`):'—'}));
  }
  table.replaceChildren(...cells);
}

/* ---------- debug readout ----------------------------------------------- */
const EXPRESSIONS={jawOpen:'باز بودن دهان',mouthSmileLeft:'لبخند (چپ)',mouthSmileRight:'لبخند (راست)',eyeBlinkLeft:'پلک (چپ)',
  eyeBlinkRight:'پلک (راست)',browInnerUp:'بالا رفتن ابرو',browDownLeft:'اخم (چپ)',browDownRight:'اخم (راست)',mouthPucker:'غنچه‌کردن لب'};
function debugStats(){
  const {w,h}=frameSize();
  const amounts=procedureAmounts();
  const pts=landmarks?points3(landmarks,w,h):null;
  const defs=pts?deformers(pts,amounts).length:0;
  const top=(blendshapes||[]).filter(([n])=>n!=='_neutral').sort((a,b)=>b[1]-a[1]).slice(0,3);
  return [
    ['مسیر نمایش',stage?'WebGL':stageBroken?'—  (بدون WebGL)':'—'],
    ['منبع',source?(source.kind==='photo'?'photo':frozen?'camera (frozen)':'camera'):'—'],
    ['فریم',source?`${w}×${h}`:'—'],
    ['نمایش',`${perf.drawn} fps (حلقه ${perf.fps})`],
    ['ردیابی',`${perf.hz} Hz · ${Math.round(perf.latency)} ms · ${tracker?(tracker.kind==='worker'?'worker':'main thread'):trackerStarting?'starting':'—'}${delegate?' · '+delegate:''}`],
    ['مدل',`${perf.inferMs.toFixed(1)} ms هر فریم${gpuError?' · GPU: '+gpuError.slice(0,60):''}`],
    ['هماهنگی',source?.kind==='camera'?(syncing()?'فریم و نقاط هم‌زمان':'تصویر زنده'):'—'],
    ['هزینهٔ هر فریم',`masks ${perf.maskMs.toFixed(1)} ms · draw ${perf.drawMs.toFixed(1)} ms`],
    ['نقاط',landmarks?String(landmarks.length):'0'],
    ['پهنای صورت',landmarks?`${Math.round(faceWidthPx())} px`:'—'],
    ['زاویهٔ سر',poseAngles?`yaw ${poseAngles.yaw.toFixed(1)}° · pitch ${poseAngles.pitch.toFixed(1)}° · roll ${poseAngles.roll.toFixed(1)}°`:'—'],
    ['تقارن',pts?`${symmetry(pts).toFixed(0)} / 100`:'—'],
    ['لایه‌ها',`${defs} deformers · ${textureLayers(amounts).length} texture`],
    ['حالت چهره',top.length?top.map(([n,s])=>`${EXPRESSIONS[n]||n} ${s.toFixed(2)}`).join('، '):'—'],
    ['آخرین خطا',perf.lastError||'—']
  ];
}
function updateHud(now){
  perf.frames++;
  if(now-perf.since>=1000){
    const k=1000/(now-perf.since);
    perf.fps=Math.round(perf.frames*k);perf.hz=Math.round(perf.detections*k);perf.drawn=Math.round(perf.draws*k);
    perf.frames=0;perf.detections=0;perf.draws=0;perf.since=now;
    // In step from 16 tracked frames a second, back to live below 12.
    inStep=source?.kind==='camera'&&(alwaysInStep||(inStep?perf.hz>=12:perf.hz>=16));
  }
  if(!debug.on&&!$('debug-panel').open)return;
  if(now-perf.lastHud<250)return;
  perf.lastHud=now;
  const stats=debugStats();
  $('debug-stats').replaceChildren(...stats.flatMap(([k,v])=>[el('dt',{text:k}),el('dd',{text:v})]));
  $('hud').hidden=!(debug.on&&debug.hud&&source);
  if(!$('hud').hidden)$('hud').textContent=stats.filter(([k])=>k!=='حالت چهره').map(([,v])=>v).join('\n');
}
// Everything measured about the face on screen, for R&D notes and bug reports. No
// picture: only numbers.
function exportData(){
  const {w,h}=frameSize();
  const amounts=procedureAmounts();
  return {
    app:'roja-clinic',version:1,time:new Date().toISOString(),
    frame:{width:w,height:h,source:source?.kind||null,frozen},
    landmarks:landmarks?landmarks.map(l=>[+l.x.toFixed(5),+l.y.toFixed(5),+(l.z||0).toFixed(5)]):null,
    pose:poseAngles,blendshapes:blendshapes?Object.fromEntries(blendshapes.map(([n,s])=>[n,+s.toFixed(4)])):null,
    measurements:landmarks?{before:measure(points3(landmarks,w,h)),
      after:measure(moved(points3(landmarks,w,h),anyProcedure()?displacements(points3(landmarks,w,h),amounts):null))}:null,
    symmetry:landmarks?symmetry(points3(landmarks,w,h)):null,
    procedures:{active:Object.fromEntries(active),variants:Object.fromEntries(variants),amounts:Object.fromEntries(Object.entries(amounts).filter(([,v])=>v))}
  };
}

/* ---------- sources: camera and photo ----------------------------------- */
let stream=null,tracker=null,trackerStarting=false,trackerGeneration=0,ready=false,busy=false,activeSource=false;
let generation=0,raf=0,lastSent=0,sentAt=0,sentGen=-1,initTimer;
let photoPasses=0,sourceVersion=0;
const PHOTO_PASSES=8;
const smoother=createSmoother();
// The model on the GPU, off iPhones (where MediaPipe's GPU path is not dependable in
// WebKit); the tracker falls back to the CPU by itself if the GPU fails. ?gpu=0 keeps
// it on the CPU, ?gpu=force insists on the GPU, for comparing the two.
const params=new URLSearchParams(location.search),gpuParam=params.get('gpu');
// ?sync=always shows frames in step whatever the tracker's pace (for testing).
const alwaysInStep=params.get('sync')==='always';
const gpuQuery=gpuParam==='0'?'':gpuParam==='force'?'&gpu=force':iOS?'':'&gpu=1';
// The camera's resolution: a clinic camera is better than a phone's selfie camera, so
// 720p unless ?res= asks for another height (480, 720, 1080).
const RES={480:[640,480],720:[1280,720],1080:[1920,1080]}[params.get('res')]||[1280,720];
let delegate='', gpuError='';
// The fast path: a camera frame goes to the worker as a VideoFrame, with no copy.
let fastFrames=!iOS&&typeof VideoFrame==='function';
// Either way a copy of the frame sent is kept, and when its landmarks come back that
// very frame is shown with them: the change sits exactly on the face in the picture
// instead of trailing the live video by one tracking round-trip. The picture then
// moves at the tracker's pace, so this is done only while the tracker keeps up;
// below that, the live video with the latest landmarks looks better.
let inFlight=null, shown=null, shownAt=0, shownVersion=0, inStep=false;
// A camera frame that has not been measured yet (requestVideoFrameCallback), so the
// model never runs twice on the same picture.
let freshFrame=false, watching=0;
function watchFrames(){
  if(!video.requestVideoFrameCallback)return;
  const token=++watching;
  const tick=()=>{if(token!==watching||source?.kind!=='camera')return;freshFrame=true;video.requestVideoFrameCallback(tick);};
  video.requestVideoFrameCallback(tick);
}
function dropFrames(){
  inFlight?.close();inFlight=null;
  shown?.close();shown=null;
}
// A WebGL that cannot take the kept frame as a texture turns showing in step off.
let stepBroken=false;
const syncing=()=>inStep&&!stepBroken&&!!shown&&performance.now()-shownAt<400;

// The tracker runs in a worker. Where a worker cannot start MediaPipe (iPhones before
// iOS 17 have no WebGL inside workers) the same code runs on the page instead: a
// little slower, but it works.
function onTracker(d){
  if(d.type==='progress'){showLoading(d.loaded,d.total);return;}
  if(d.type==='ready'){
    clearTimeout(initTimer);ready=true;topology=d.topology;showLoading(null);
    delegate=d.delegate||'CPU';if(d.gpuError)gpuError=d.gpuError;
    if(delegate!=='GPU')fastFrames=false;
    if(source){status(statusText());enableTools(true);}
  }else if(d.type==='skip'){
    busy=false;inFlight?.close();inFlight=null;
  }else if(d.type==='result'){
    busy=false;
    const frame=inFlight;inFlight=null;
    if(sentGen!==generation||!source){frame?.close();return;}
    perf.detections++;perf.latency=performance.now()-sentAt;perf.inferMs=ema(perf.inferMs,d.ms||0);
    if(frame){shown?.close();shown=frame;shownAt=performance.now();shownVersion++;}
    landmarks=smoother.smooth(d.landmarks,sentAt);
    if(source.kind==='photo')photoPasses++;
    poseAngles=d.landmarks?poseOf(d.matrix):null;
    if(d.blendshapes)blendshapes=d.blendshapes;
    $('guide').hidden=!!landmarks;
    status(landmarks||source.kind==='photo'?statusText():'صورت پیدا نشد. کمی روبه‌روی دوربین و در نور بیشتر قرار بگیر.');
    invalidate({measure:true});
  }else if(d.type==='error'){
    busy=false;inFlight?.close();inFlight=null;
    perf.lastError=`${d.stage||'tracker'}: ${d.message||''}`;
    if(d.recoverable){gpuError=d.message;fastFrames=false;return;}
    if(!ready&&tracker?.kind==='worker')useTracker('page',d.message);
    else shutdown('تشخیص چهره روی این مرورگر آماده نشد. آخرین نسخهٔ مرورگر را امتحان کن.'+code({message:d.message}));
  }
}
function ensureTracker(){
  if(tracker||trackerStarting)return;
  let w=null;
  try{w=new Worker(new URL(`face-worker.js?v=2${gpuQuery}`,import.meta.url));}catch(e){perf.lastError=`worker: ${e.message}`;}
  if(!w){useTracker('page','no worker');return;}
  ready=false;busy=false;
  tracker={kind:'worker',post:(m,transfer)=>w.postMessage(m,transfer),close:()=>w.terminate()};
  w.onmessage=e=>onTracker(e.data);
  w.onerror=e=>{
    e.preventDefault?.();
    if(!ready)useTracker('page',e.message||'worker failed');
    else shutdown('بارگذاری انجام نشد. دوباره امتحان کن.'+code({message:e.message}));
  };
  clearTimeout(initTimer);
  initTimer=setTimeout(()=>{if(!ready)shutdown('آماده‌سازی طول کشید. صفحه را دوباره باز کن.');},90000);
}
async function useTracker(kind,reason){
  if(tracker){tracker.close();tracker=null;}
  ready=false;busy=false;trackerStarting=true;
  perf.trackerNote=reason||'';
  const token=++trackerGeneration;
  try{
    const Vision=await import('./vendor/vision_bundle.mjs');
    await import('./face-core.js?v=2');
    const core=self.rojaFaceCore(Vision,new URL('./',import.meta.url).href);
    const found=await core.init('CPU',(loaded,total)=>{if(token===trackerGeneration)onTracker({type:'progress',loaded,total});});
    if(token!==trackerGeneration){core.close();return;}
    tracker={kind,post:m=>setTimeout(()=>{
      let out;
      try{out=core.handle(m);}catch(e){out={type:'error',stage:'detect',message:String(e?.message||e)};}
      finally{m.frame?.close?.();}
      onTracker(out);
    },0),close:()=>core.close()};
    trackerStarting=false;
    onTracker({type:'ready',topology:found,delegate:found.delegate});
  }catch(e){
    trackerStarting=false;
    if(token===trackerGeneration)shutdown('تشخیص چهره روی این مرورگر آماده نشد. آخرین نسخهٔ Chrome یا Safari را امتحان کن.'+code(e));
  }
}
// How far the face model and its runtime have come down, while they do. From the
// cache it is over before it is seen; the first time it is ~15 MB.
const mb=new Intl.NumberFormat('fa-IR',{maximumFractionDigits:0});
const percent=new Intl.NumberFormat('fa-IR',{style:'percent'});
function showLoading(loaded,total){
  const box=$('loading');
  if(loaded==null||!total||!source){box.hidden=true;return;}
  const part=Math.min(.99,loaded/total);
  box.hidden=false;
  $('loading-bar').style.width=`${part*100}%`;
  $('loading-track').setAttribute('aria-valuenow',Math.round(part*100));
  $('loading-percent').textContent=percent.format(part);
  $('loading-text').textContent=`${mb.format(loaded/1048576)} از ${mb.format(total/1048576)} مگابایت`;
}
function shutdown(message){
  if(tracker)tracker.close();tracker=null;ready=false;busy=false;trackerStarting=false;trackerGeneration++;
  stop(message);
}
function enableTools(on){
  for(const id of ['compare','snap'])$(id).disabled=!on;
  $('freeze').disabled=!on||source?.kind!=='camera';
}
function goLive(){
  $('welcome').hidden=true;viewport.classList.add('live');
  $('toolbar').hidden=false;$('stop').disabled=false;
  $('stop').lastChild.textContent=source.kind==='photo'?'بستن عکس':'خاموش‌کردن';
  $('guide').hidden=false;$('badge').hidden=false;
  landmarks=null;poseAngles=null;photoPasses=0;
  overlay.width=source.width;overlay.height=source.height;
  enableTools(ready);
  ensureTracker();
  cancelAnimationFrame(raf);raf=requestAnimationFrame(frame);
  updateSeam();invalidate({masks:true,measure:true});
}

function stop(message='دوربین خاموش شد.'){
  generation++;activeSource=false;busy=false;watching++;dropFrames();smoother.reset();
  cancelAnimationFrame(raf);
  if(stream)stream.getTracks().forEach(t=>t.stop());
  stream=null;video.srcObject=null;
  source=null;landmarks=null;poseAngles=null;blendshapes=null;frozen=false;
  $('freeze').setAttribute('aria-pressed','false');
  // dispose() loses the WebGL context to free the GPU at once, and a canvas hands a
  // lost context back forever; the next source needs a fresh canvas.
  if(stage){stage.dispose();stage=null;const fresh=$('stage').cloneNode(false);$('stage').replaceWith(fresh);}
  stageBroken=false;$('stage').hidden=true;video.style.visibility='';photo.hidden=true;
  $('webgl-missing').hidden=true;
  debugCanvas.hidden=true;debugDrawn=null;
  viewport.classList.remove('live');
  octx.clearRect(0,0,overlay.width,overlay.height);
  $('welcome').hidden=false;$('start').disabled=false;
  $('start').lastChild.textContent='روشن‌کردن دوربین';
  $('stop').disabled=true;$('toolbar').hidden=true;$('seam').hidden=true;seamOn=false;
  $('guide').hidden=true;$('badge').hidden=true;$('hud').hidden=true;$('loading').hidden=true;$('tap-start').hidden=true;
  enableTools(false);
  status(message);
}

async function start(){
  if(activeSource&&(!source||source.kind==='camera'))return;
  if(source)stop('');
  activeSource=true;
  const token=++generation;
  $('start').disabled=true;$('start').lastChild.textContent='در حال آماده‌سازی…';
  status('اجازهٔ دوربین را در مرورگر تأیید کن.');
  try{
    if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia)throw new Error('UNSUPPORTED');
    const acquired=await navigator.mediaDevices.getUserMedia({audio:false,
      video:{facingMode:'user',width:{ideal:RES[0]},height:{ideal:RES[1]},frameRate:{ideal:30,max:30}}});
    if(token!==generation){acquired.getTracks().forEach(t=>t.stop());return;}
    stream=acquired;video.srcObject=stream;
    const playing=await video.play().then(()=>true,()=>false);
    await videoSize(video);
    if(token!==generation)return;
    if(!video.videoWidth||!video.videoHeight)throw Object.assign(new Error('the camera sent no picture'),{name:'NoVideo'});
    source={kind:'camera',el:video,width:video.videoWidth,height:video.videoHeight,live:true,version:++sourceVersion};
    freshFrame=true;watchFrames();
    status(ready?'صورت را روبه‌روی دوربین نگه دار.':'آماده‌سازی. بار اول ممکن است کمی طول بکشد.');
    goLive();
    if(!playing)$('tap-start').hidden=false;
    stream.getVideoTracks()[0].onended=()=>stop();
  }catch(e){
    if(token!==generation)return;
    cameraFailed(e);
  }
}
// Why the camera did not start, in words, with where to allow it and an error code.
function cameraFailed(e){
  perf.lastError=`camera: ${e?.name||''} ${e?.message||''}`;
  const errors={
    NotAllowedError:'اجازهٔ دوربین داده نشد. '+cameraHelp()+' یا یک عکس انتخاب کن.',
    SecurityError:'اجازهٔ دوربین داده نشد. '+cameraHelp(),
    NotFoundError:'دوربینی پیدا نشد. اتصال دوربین را بررسی کن یا یک عکس انتخاب کن.',
    OverconstrainedError:'دوربین این تنظیم را ندارد. یک عکس انتخاب کن.',
    NotReadableError:'دوربین در دسترس نیست. برنامه‌های دیگری که از آن استفاده می‌کنند را ببند.',
    NoVideo:'دوربین روشن شد اما تصویری نفرستاد. صفحه را دوباره باز کن.'
  };
  stop((errors[e.name]||(e.message==='UNSUPPORTED'
    ?'این مرورگر دوربین را پشتیبانی نمی‌کند. صفحه را با HTTPS (یا روی localhost) در Chrome باز کن، یا یک عکس انتخاب کن.'
    :'دوربین باز نشد. دوباره امتحان کن.'))+code(e));
}

// The stream's size can arrive a moment after the stream itself.
function videoSize(v,ms=5000){
  if(v.videoWidth&&v.videoHeight)return Promise.resolve();
  return new Promise(resolve=>{
    const done=()=>{clearTimeout(timer);v.removeEventListener('loadedmetadata',done);v.removeEventListener('resize',done);resolve();};
    const timer=setTimeout(done,ms);
    v.addEventListener('loadedmetadata',done);v.addEventListener('resize',done);
  });
}
// A turned tablet swaps the camera's width and height mid-stream.
video.addEventListener('resize',()=>{
  if(source?.kind!=='camera'||!video.videoWidth||!video.videoHeight)return;
  if(video.videoWidth===source.width&&video.videoHeight===source.height)return;
  source.width=video.videoWidth;source.height=video.videoHeight;
  overlay.width=source.width;overlay.height=source.height;
  invalidate({masks:true,measure:true});
  if(seamOn)placeSeam();
});
// Some browsers only start a camera picture from a tap on the page itself.
$('tap-start').onclick=()=>{
  video.play().then(()=>{$('tap-start').hidden=true;invalidate();},e=>toast('تصویر شروع نشد.'+code(e)));
};

// A photo is drawn mirrored, so the CSS mirror that suits a selfie camera shows it
// the right way round and every other part of the pipeline stays the same.
async function openPhoto(file){
  if(!file)return;
  if(source)stop('');
  const token=++generation;
  status('در حال باز کردن عکس…');
  try{
    const bitmap=await createImageBitmap(file);
    if(token!==generation){bitmap.close();return;}
    const scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));
    const w=Math.round(bitmap.width*scale),h=Math.round(bitmap.height*scale);
    photo.width=w;photo.height=h;
    const x=photo.getContext('2d');x.save();x.translate(w,0);x.scale(-1,1);x.drawImage(bitmap,0,0,w,h);x.restore();
    bitmap.close();
    activeSource=true;
    source={kind:'photo',el:photo,width:w,height:h,live:false,version:++sourceVersion};
    goLive();
    status(ready?'در حال پیدا کردن صورت در عکس…':'آماده‌سازی. بار اول ممکن است کمی طول بکشد.');
  }catch{
    stop('این فایل باز نشد. یک عکس JPG یا PNG انتخاب کن.');
  }
}

function frame(now){
  if(!source)return;
  raf=requestAnimationFrame(frame);
  detect(now);
  // In step with the tracker, a frame is drawn when its landmarks arrive (which marks
  // it dirty), not on every display refresh.
  if((source.live&&!syncing())||dirty||masksDirty)draw(now);
  drawDebug();
  renderMeasure(now);
  updateHud(now);
}
function detect(now){
  if(!ready||busy||!tracker||!source)return;
  if(source.kind==='camera'){
    if(video.readyState<2)return;
    if(frozen){
      if(landmarks)return;
      if(now-lastSent<100)return;
    }else{
      // Each camera frame once, as soon as the last one is measured. Without
      // requestVideoFrameCallback, at the camera's pace at most.
      if(!video.requestVideoFrameCallback)freshFrame=now-lastSent>=30;
      if(!freshFrame)return;
      // On the page itself a little less often, so the interface stays responsive.
      if(tracker.kind==='page'&&now-lastSent<80)return;
    }
  }else{
    if(photoPasses>=PHOTO_PASSES)return;
    if(now-lastSent<30)return;
  }
  busy=true;freshFrame=false;lastSent=now;sentAt=performance.now();sentGen=generation;
  const token=generation;
  grabFrame().then(({frame,transfer,keep})=>{
    if(token!==generation||!tracker){frame.close?.();keep?.close();busy=false;return;}
    inFlight?.close();inFlight=keep||null;
    tracker.post({type:'frame',frame,timestamp:sentAt,extras:debug.on||$('debug-panel').open,sample:false},transfer);
  }).catch(e=>{busy=false;perf.lastError=`frame: ${e?.message||e}`;
    if(token===generation)stop('پردازش تصویر روی این مرورگر انجام نشد. مرورگر دیگری را امتحان کن.'+code(e));});
}
// The frame the tracker measures, at most 640 px wide unless it goes as a VideoFrame
// (the model scales that itself). Drawing the video into a 2D canvas works the same
// everywhere; no createImageBitmap at all: ImageData.
const frameCanvas=document.createElement('canvas');
function grabFrame(){
  if(fastFrames&&source.kind==='camera'&&tracker.kind==='worker'&&!frozen){
    try{
      const frame=new VideoFrame(video,{timestamp:Math.round(sentAt*1000)});
      return Promise.resolve({frame,transfer:[frame],keep:frame.clone()});
    }catch(e){fastFrames=false;perf.lastError=`VideoFrame: ${e?.message||e}`;}
  }
  const scale=Math.min(1,640/source.width);
  const w=Math.max(1,Math.round(source.width*scale)),h=Math.max(1,Math.round(source.height*scale));
  if(frameCanvas.width!==w||frameCanvas.height!==h){frameCanvas.width=w;frameCanvas.height=h;}
  const x=frameCanvas.getContext('2d',{willReadFrequently:!window.createImageBitmap});
  x.drawImage(source.el,0,0,w,h);
  if(window.createImageBitmap)return Promise.all([createImageBitmap(frameCanvas),
    source.kind==='camera'&&!frozen?createImageBitmap(frameCanvas):null]).then(([frame,keep])=>({frame,transfer:[frame],keep}));
  const frame=x.getImageData(0,0,w,h);
  return Promise.resolve({frame,transfer:[frame.data.buffer]});
}

/* ---------- tools on the image ------------------------------------------ */
function toggleCompare(){
  compare=!compare;
  if(compare&&!anyProcedure())toast('اول یک عمل را انتخاب کن.');
  updateSeam();invalidate();
}
function toggleFreeze(){
  if(source?.kind!=='camera')return;
  frozen=!frozen;
  $('freeze').setAttribute('aria-pressed',String(frozen));
  if(frozen)video.pause();else video.play().catch(()=>{});
  status(statusText());
}

// The image as it is now, as a canvas. Null when there is nothing to take.
function capture(){
  if(!source)return null;
  const {w,h}=frameSize();
  const c=document.createElement('canvas');c.width=w;c.height=h;
  const x=c.getContext('2d');
  // Saved as seen: the preview is mirrored, so the saved picture is too.
  x.save();x.translate(w,0);x.scale(-1,1);
  if(stage&&!$('stage').hidden)x.drawImage($('stage'),0,0,w,h);
  else x.drawImage(source.el,0,0,w,h);
  x.restore();
  const s=Math.max(1,w/640);
  if(seamOn){
    const sx=seam*w;
    x.fillStyle='#D1AC3A';x.fillRect(sx-s,0,2*s,h);
    const [before,after]=seamLabels();
    x.font=`${13*s}px Estedad, Tahoma, sans-serif`;x.textBaseline='bottom';x.direction='rtl';
    const tag=(text,px,align)=>{x.textAlign=align;const m=x.measureText(text).width;
      x.fillStyle='#140C11CC';x.fillRect(align==='left'?px-6*s:px-m-6*s,h-30*s,m+12*s,22*s);x.fillStyle='#F4E3B0';x.fillText(text,px,h-12*s);};
    tag(before,12*s,'left');tag(after,w-12*s,'right');
  }
  // Every saved picture says what it is: a simulation, not a promised result.
  x.font=`600 ${11*s}px Estedad, Tahoma, sans-serif`;x.fillStyle='#FFFFFFB0';x.textAlign='right';x.textBaseline='top';x.direction='rtl';
  x.fillText('شبیه‌سازی تصویری، نه نتیجهٔ قطعی',w-12*s,10*s);
  return c;
}
async function snapshot(){
  const c=capture();
  if(!c){if(source)toast('عکس گرفته نشد. دوباره امتحان کن.');return;}
  const label=[...active].filter(([,v])=>v>0).map(([id,v])=>{
    const procedure=byId(id),{variant}=resolve(procedure,variants.get(id));
    return `${procedure.short}${variant?` (${variant.name})`:''} ${pct(v)}`;
  }).join('، ')||(anyProcedure()?'تنظیم دستی':'بدون عمل');
  const blob=await new Promise(resolve=>c.toBlob(resolve,'image/png'));
  if(!blob){toast('ذخیرهٔ عکس روی این مرورگر ممکن نشد.');return;}
  shots.unshift({url:URL.createObjectURL(blob),blob,label,time:new Date(),picked:false});
  while(shots.length>24){URL.revokeObjectURL(shots.pop().url);}
  $('shots-count').textContent=fa.format(shots.length);
  $('flash').classList.remove('on');void $('flash').offsetWidth;$('flash').classList.add('on');
  toast('عکس گرفته شد. از «عکس‌ها» می‌توانی مقایسه یا ذخیره‌اش کنی.');
}
function renderGallery(){
  const list=$('gallery-shots');
  if(!shots.length){list.replaceChildren(el('p',{class:'empty',text:'هنوز عکسی گرفته نشده. روی تصویر «عکس» را بزن.'}));$('gallery-compare').hidden=true;return;}
  const time=new Intl.DateTimeFormat('fa-IR',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  list.replaceChildren(...shots.map(shot=>{
    const pick=el('input',{type:'checkbox'});pick.checked=shot.picked;
    pick.onchange=()=>{
      shot.picked=pick.checked;
      const picked=shots.filter(s=>s.picked);
      if(picked.length>2){picked.find(s=>s!==shot).picked=false;}
      renderGallery();
    };
    return el('figure',{class:`shot${shot.picked?' picked':''}`,style:{margin:0}},
      el('img',{src:shot.url,alt:shot.label}),
      el('label',{},pick,'مقایسه'),
      el('div',{class:'shot-bar'},el('span',{text:`${time.format(shot.time)} · ${shot.label}`,title:shot.label}),
        el('a',{href:shot.url,download:`clinic-${shot.time.getTime()}.png`,'aria-label':'ذخیرهٔ عکس',title:'ذخیره'},icon('i-download')),
        el('button',{type:'button','aria-label':'حذف عکس',title:'حذف',onclick:()=>{URL.revokeObjectURL(shot.url);shots.splice(shots.indexOf(shot),1);
          $('shots-count').textContent=fa.format(shots.length);renderGallery();}},icon('i-trash'))));
  }));
  const picked=shots.filter(s=>s.picked);
  $('gallery-compare').hidden=picked.length!==2;
  if(picked.length===2)$('gallery-compare').replaceChildren(...picked.map(s=>el('figure',{},el('img',{src:s.url,alt:s.label}),el('figcaption',{text:s.label}))));
}
function saveBlob(blob,name){
  const url=URL.createObjectURL(blob);
  const a=el('a',{href:url,download:name});document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function icon(id){
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('class','ico');
  const use=document.createElementNS('http://www.w3.org/2000/svg','use');use.setAttribute('href','#'+id);svg.append(use);return svg;
}

// A link straight to one procedure, at its usual strength: #procedure=rhinoplasty.
// Taken out of the address once used, so a reload does not apply it again.
function procedureFromLink(){
  const m=/^#procedure=(.+)$/.exec(location.hash);
  if(!m)return;
  history.replaceState(null,'',location.pathname+location.search);
  if(byId(m[1])){activateProcedure(m[1]);showProcedure(m[1]);}
}

/* ---------- the theme --------------------------------------------------- */
// Light or dark: the system's unless the header switch chose one (kept on this device).
function currentTheme(){
  return document.documentElement.dataset.theme||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
}
function paintThemeButton(){
  const dark=currentTheme()==='dark';
  $('theme').setAttribute('aria-label',dark?'حالت روشن':'حالت تیره');$('theme').title=dark?'حالت روشن':'حالت تیره';
  $('theme').querySelector('use').setAttribute('href',dark?'#i-sun':'#i-moon');
}
$('theme').onclick=()=>{
  const next=currentTheme()==='dark'?'light':'dark';
  document.documentElement.dataset.theme=next;
  try{localStorage.setItem('clinic-theme',next);}catch{}
  paintThemeButton();
};
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change',paintThemeButton);
paintThemeButton();

/* ---------- wiring ------------------------------------------------------ */
$('gallery-open').onclick=()=>{renderGallery();$('gallery').showModal();};
$('gallery-close').onclick=()=>$('gallery').close();
$('gallery').addEventListener('click',e=>{if(e.target===$('gallery'))$('gallery').close();});
window.addEventListener('hashchange',procedureFromLink);

$('strength').oninput=()=>{
  const value=Number($('strength').value);
  $('strength-amount').textContent=pct(value);
  if(currentProcedure)setStrength(currentProcedure,value);
};
$('procedure-reset').onclick=()=>{
  active.clear();
  for(const control of controls){
    overrides[control.id]=0;
    const input=$(`fine-${control.id}`);if(input)setRange(input.id,0);
    const amount=$(`fine-${control.id}-amount`);if(amount)amount.textContent=fa.format(0);
  }
  showProcedure(null);buildTray();updateSeam();invalidate({masks:true,measure:true});status(statusText());
};
// Turned off with several on: keep the one being looked at.
$('combine-procedures').onchange=()=>{
  const on=$('combine-procedures').checked;
  try{localStorage.setItem(COMBINE,on?'1':'0');}catch{}
  if(!on&&active.size>1){
    const keep=active.has(currentProcedure)?currentProcedure:[...active.keys()].pop();
    const value=active.get(keep);
    active.clear();setStrength(keep,value);showProcedure(keep);
  }
  toast(on?'عمل‌ها با هم ترکیب می‌شوند: هر عملی که بزنی به قبلی‌ها اضافه می‌شود.':'هر بار یک عمل: عمل تازه جای قبلی را می‌گیرد.');
};
for(const region of regions){
  const list=controls.filter(c=>c.region===region.id);
  $('fine-controls').append(el('p',{class:'fine-group',text:region.name}));
  for(const control of list){
    const [min,max]=controlRange(control);
    const amount=el('output',{id:`fine-${control.id}-amount`,text:fa.format(0)});
    const label=el('label',{class:'field',for:`fine-${control.id}`,title:control.help},`${control.name} `,amount);
    const input=el('input',{id:`fine-${control.id}`,type:'range',min:String(min),max:String(max),step:'1',value:'0',data:{fine:control.id},'aria-describedby':`fine-${control.id}-help`});
    paintRange(input);
    input.oninput=()=>{
      overrides[control.id]=Number(input.value);
      amount.textContent=fa.format(Number(input.value));
      $('procedure-reset').hidden=!anyProcedure();
      updateSeam();invalidate({masks:true,measure:true});status(statusText());
    };
    $('fine-controls').append(label,input,el('p',{class:'help',id:`fine-${control.id}-help`,text:control.help}));
  }
}

/* inspecting landmarks with the pointer (debug) */
viewport.addEventListener('pointerdown',e=>{
  if(!source||e.target.closest('.toolbar,#welcome,.seam-grip'))return;
  const q=framePoint(e);
  if(debug.on&&debug.inspect&&landmarks&&q.inside){
    const {w,h}=frameSize();
    setFind(nearest(landmarks,w,h,q.x,q.y).index);
  }
});
viewport.addEventListener('pointermove',e=>{
  if(!source)return;
  const q=framePoint(e);
  if(debug.on&&debug.inspect&&landmarks&&q.inside){
    const {w,h}=frameSize();
    const hit=nearest(landmarks,w,h,q.x,q.y);
    const l=landmarks[hit.index];
    const tip=$('inspect-tip');tip.hidden=false;
    tip.style.left=q.screenX+'px';tip.style.top=q.screenY+'px';
    tip.textContent=`#${hit.index}  x ${(l.x*w).toFixed(1)}  y ${(l.y*h).toFixed(1)}  z ${(l.z||0).toFixed(3)}`;
  }else $('inspect-tip').hidden=true;
});
viewport.addEventListener('pointerleave',()=>{$('inspect-tip').hidden=true;});

/* the toolbar */
$('compare').onclick=toggleCompare;
$('freeze').onclick=toggleFreeze;
$('snap').onclick=snapshot;
$('fullscreen').onclick=()=>{
  if(document.fullscreenElement)document.exitFullscreen?.();
  else viewport.requestFullscreen?.().catch(()=>toast('تمام‌صفحه در این مرورگر در دسترس نیست.'));
};
if(!document.fullscreenEnabled)$('fullscreen').hidden=true;

/* debug */
$('debug-on').onchange=()=>{debug.on=$('debug-on').checked;viewport.classList.toggle('inspecting',debug.on&&debug.inspect);invalidate({masks:debug.masks});};
for(const key of ['points','mesh','contours','axes','masks','field','hud','inspect'])
  $(`debug-${key}`).onchange=()=>{
    debug[key]=$(`debug-${key}`).checked;
    viewport.classList.toggle('inspecting',debug.on&&debug.inspect);
    if(!debug.inspect)$('inspect-tip').hidden=true;
    invalidate({masks:key==='masks'});
  };
$('debug-size').oninput=()=>{
  debug.labelSize=Number($('debug-size').value);
  $('debug-size-amount').textContent=fa.format(debug.labelSize);
  invalidate();
};
$('debug-highlight').onchange=()=>{debug.highlight=$('debug-highlight').checked;invalidate();};
$('debug-only').onchange=()=>{debug.onlyActive=$('debug-only').checked;invalidate();};
function setFind(index){
  debug.find=Number.isInteger(index)&&index>=0&&index<478?index:null;
  if(debug.find!==null&&String($('debug-find').value)!==String(index))$('debug-find').value=index;
  const info=$('debug-find-info');
  if(debug.find===null){info.textContent='';}
  else if(landmarks&&landmarks[debug.find]){
    const {w,h}=frameSize(),l=landmarks[debug.find];
    const uses=Object.entries(controlLandmarks).filter(([,list])=>list.includes(debug.find)).map(([c])=>c);
    info.textContent=`نقطهٔ ${fa.format(debug.find)}: x ${fa1.format(l.x*w)} ، y ${fa1.format(l.y*h)}${uses.length?` · در ${uses.join('، ')}`:''}`;
  }else info.textContent=`نقطهٔ ${fa.format(debug.find)}`;
  invalidate();
}
$('debug-find').oninput=()=>setFind($('debug-find').value===''?null:Number($('debug-find').value));
$('debug-export').onclick=()=>{saveBlob(new Blob([JSON.stringify(exportData(),null,1)],{type:'application/json'}),`clinic-data-${Date.now()}.json`);};
$('debug-copy').onclick=async()=>{
  try{await navigator.clipboard.writeText(JSON.stringify(exportData()));toast('داده‌ها کپی شد.');}
  catch{toast('کپی در این مرورگر اجازه داده نشد؛ از «دانلود JSON» استفاده کن.');}
};

/* seam dragging: the grip is a real slider, so it works from the keyboard too */
function seamFromEvent(event){
  const box=videoBox();
  seam=Math.min(1,Math.max(0,(event.clientX-box.rect.left-box.left)/box.width));
  placeSeam();invalidate();draw();
}
$('seam').addEventListener('pointerdown',e=>{
  // Move first: capture is an enhancement, and it throws for a pointer id the
  // element does not own, which would otherwise abandon the drag.
  seamFromEvent(e);
  try{$('seam').setPointerCapture(e.pointerId);}catch{}
  e.stopPropagation();
});
$('seam').addEventListener('pointermove',e=>{if(e.buttons)seamFromEvent(e);});
$('seam-grip').addEventListener('keydown',e=>{
  const step=e.key==='ArrowLeft'?-0.02:e.key==='ArrowRight'?0.02:0;
  if(!step)return;
  e.preventDefault();
  seam=Math.min(1,Math.max(0,seam+step));placeSeam();invalidate();
});

/* keyboard shortcuts, never while typing */
document.addEventListener('keydown',e=>{
  if(e.target.closest('input,select,textarea,[contenteditable]')||e.altKey||e.ctrlKey||e.metaKey||!source)return;
  const k=e.key.toLowerCase();
  if(k==='c')$('compare').click();
  else if(k==='f')toggleFreeze();
  else if(k==='s')snapshot();
});

// The seam is positioned in pixels, so it has to be replaced when the box changes.
window.addEventListener('resize',()=>{if(seamOn)placeSeam();});
document.addEventListener('fullscreenchange',()=>{if(seamOn)placeSeam();});
window.addEventListener('pagehide',()=>{stop();if(tracker){tracker.close();tracker=null;ready=false;}});
$('start').onclick=start;
$('photo-input').onchange=()=>{const file=$('photo-input').files[0];$('photo-input').value='';openPhoto(file);};
$('stop').onclick=()=>stop(source?.kind==='photo'?'عکس بسته شد.':'دوربین خاموش شد.');
// Dropping a photo on the image opens it too.
viewport.addEventListener('dragover',e=>{if([...e.dataTransfer.items].some(i=>i.type.startsWith('image/'))){e.preventDefault();}});
viewport.addEventListener('drop',e=>{const file=[...e.dataTransfer.files].find(f=>f.type.startsWith('image/'));if(file){e.preventDefault();openPhoto(file);}});

buildTray();
showProcedure(null);
placeSeam();
document.querySelectorAll('input[type=range]').forEach(paintRange);
procedureFromLink();

// Anything that breaks later says so, instead of leaving a silent screen: the message
// is what a bug report needs, and the debug panel keeps the last one.
window.addEventListener('error',e=>{perf.lastError=String(e.message||e.error||'error');toast('خطا: '+perf.lastError);});
window.addEventListener('unhandledrejection',e=>{perf.lastError=String(e.reason?.message||e.reason||'error');toast('خطا: '+perf.lastError);});
document.documentElement.dataset.ready='1';

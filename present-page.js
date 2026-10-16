// The patient's screen (present.html). The doctor's window (presenter.js) hands it the
// picture as a stream of its own stage canvas, and tells it what else to show: the
// before/after seam and its labels, the procedure on the face, the clinic's name.
// Nothing is decided here; this window only shows.
const $=id=>document.getElementById(id);
const view=$('view');
let state={live:false};

// The picture's box on screen: object-fit:contain letterboxes it.
function box(){
  const W=innerWidth,H=innerHeight,ratio=(view.videoWidth&&view.videoHeight)?view.videoWidth/view.videoHeight:(state.aspect||4/3);
  let w=W,h=W/ratio;if(h>H){h=H;w=H*ratio;}
  return {left:(W-w)/2,top:(H-h)/2,width:w,height:h};
}
function paint(){
  const live=!!state.live&&!!view.srcObject;
  view.hidden=!live;
  $('idle').hidden=live;
  $('idle-title').textContent=state.clinic||'رُژا کلینیک';
  $('idle-text').textContent=state.message||'نمایشگر بیمار آماده است.';
  $('badge').hidden=!live;
  $('caption').hidden=!live||!state.caption;
  $('caption').textContent=state.caption||'';
  const seamOn=live&&state.seam!=null;
  $('seam').hidden=!seamOn;
  if(seamOn){
    // The seam is a fraction across the picture as seen, mirrored like the doctor's view.
    const b=box(),x=b.left+state.seam*b.width,line=$('seam-line');
    line.style.left=x+'px';line.style.top=b.top+'px';line.style.height=b.height+'px';
    const [before,after]=state.labels||['',''];
    $('seam-before').textContent=before;$('seam-before').style.left=(b.left+16)+'px';
    $('seam-after').textContent=after;$('seam-after').style.right=(b.left+16)+'px';
    $('seam-before').style.bottom=$('seam-after').style.bottom=(innerHeight-b.top-b.height)+'px';
  }
  document.title=state.clinic?`${state.clinic} | نمایشگر بیمار`:'رُژا کلینیک | نمایشگر بیمار';
}

// What the doctor's window calls. A stream from another window of the same site plays
// here as it is.
window.rojaPresent={
  attach(stream){
    view.srcObject=stream||null;
    if(stream){
      view.play().catch(()=>{});
      // The doctor's window stopped or went away: no frozen last picture.
      const track=stream.getVideoTracks()[0];
      if(track)track.onended=()=>{if(view.srcObject===stream){view.srcObject=null;paint();}};
    }
    paint();
  },
  update(next){state=next||{live:false};paint();}
};
view.addEventListener('resize',paint);
view.addEventListener('loadedmetadata',paint);
addEventListener('resize',paint);

// When the doctor's window goes away, say so instead of freezing on the last picture.
setInterval(()=>{
  let gone=true;try{gone=!window.opener||window.opener.closed;}catch{}
  if(gone&&state.live!==false){state={live:false,clinic:state.clinic,message:'پنجرهٔ پزشک بسته شد.'};paint();}
},1000);

// Full screen from a click or F (a browser asks for a gesture in this window), and
// the screen kept awake while it shows.
function fullscreen(){
  if(document.fullscreenElement)document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(()=>{});
}
$('hint').onclick=fullscreen;
document.addEventListener('dblclick',fullscreen);
document.addEventListener('keydown',e=>{if(e.key.toLowerCase()==='f'||e.key==='Enter')fullscreen();});
document.addEventListener('fullscreenchange',()=>{$('hint').hidden=!!document.fullscreenElement;paint();});
if(!document.fullscreenEnabled)$('hint').hidden=true;
let lock=null;
async function stayAwake(){
  if(document.visibilityState!=='visible'||lock)return;
  try{lock=await navigator.wakeLock?.request('screen');lock?.addEventListener('release',()=>{lock=null;});}catch{}
}
document.addEventListener('visibilitychange',stayAwake);stayAwake();
// The pointer out of the way when it is not moving.
let still=0;
document.addEventListener('pointermove',()=>{document.body.classList.remove('quiet');clearTimeout(still);
  still=setTimeout(()=>document.body.classList.add('quiet'),2000);});
paint();

// The patient's screen, from the doctor's side: a second window (present.html) for a
// second monitor, showing the live result full screen while every control stays here.
//
// The picture goes over as a stream of the stage canvas itself (captureStream), so it
// is exactly what the doctor sees, at the same pace; everything else (the seam, its
// labels, the procedure on the face) is a small state object sent whenever it
// changes. Both windows are this site's own, so nothing leaves the computer.
const NAME='roja-clinic-present';

export function createPresenter({toast,onAttach}){
  let win=null,api=null,canvas=null,stream=null,sent='';

  function release(){
    stream?.getTracks().forEach(t=>t.stop());
    stream=null;canvas=null;api=null;sent='';
  }
  // On a computer with two screens, where the browser lets a page place its windows,
  // the window goes onto the other one. Elsewhere the doctor drags it there.
  async function placeOnOtherScreen(w){
    if(!('getScreenDetails' in window))return;
    try{
      const d=await window.getScreenDetails();
      const other=d.screens.find(s=>s!==d.currentScreen);
      if(other&&!w.closed){w.moveTo(other.availLeft,other.availTop);w.resizeTo(other.availWidth,other.availHeight);}
    }catch{}
  }
  function open(){
    if(win&&!win.closed){win.focus();return true;}
    release();
    // Opened at once, inside the click: a window opened after waiting is blocked.
    win=window.open('present.html?v=6',NAME,'popup,width=1280,height=800');
    if(!win){toast('مرورگر پنجرهٔ تازه را باز نکرد. اجازهٔ «پنجره‌های بازشو» را برای این سایت بده.');return false;}
    placeOnOtherScreen(win);
    toast('نمایشگر بیمار باز شد. آن را به مانیتور بیمار ببر و روی آن بزن تا تمام‌صفحه شود.');
    return true;
  }
  function close(){
    if(win&&!win.closed)win.close();
    win=null;release();
  }

  return {
    get open(){return !!win&&!win.closed;},
    toggle(){if(win&&!win.closed){close();return false;}return open();},
    close,
    // Every frame: the stage canvas now on screen (null when nothing is) and the state.
    // Cheap when nothing changed.
    tick(stage,state){
      if(!win)return;
      if(win.closed){win=null;release();return;}
      let page=null;try{page=win.rojaPresent||null;}catch{}
      if(!page)return;                                     // still loading
      if(page!==api){api=page;canvas=undefined;sent='';}   // a new (or reloaded) window
      if(stage!==canvas){
        stream?.getTracks().forEach(t=>t.stop());
        canvas=stage;stream=stage?stage.captureStream(30):null;
        api.attach(stream);
        onAttach?.();                                      // a fresh frame for the stream to start with
      }
      const json=JSON.stringify(state);
      if(json!==sent){sent=json;api.update(state);}
    }
  };
}

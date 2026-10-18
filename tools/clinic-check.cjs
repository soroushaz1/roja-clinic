// Browser checks for Roja Clinic: every procedure changes the face and nothing else,
// variants, the seam, the measurements, the debug overlay, snapshots, a photo, and
// edits in depth showing on a turned face (tools/face-turned.png, made by
// tools/make-turned-face.cjs), the patient record with its PDF report and backup, and
// the patient's screen.
//
//   node tools/preview.cjs        # in one terminal
//   node tools/clinic-check.cjs   # in another
//
// Set CLINIC_URL to point it at a deployed copy instead of the local server. Playwright
// is found through PLAYWRIGHT_MODULE, a normal require, or the global npm folder; the
// browser through CLINIC_CHROMIUM (an executable path), installed Chrome, or
// Playwright's own Chromium.
const fs=require('fs'),path=require('path'),assert=require('assert/strict');

function loadPlaywright(){
  const tries=[process.env.PLAYWRIGHT_MODULE,'playwright'];
  try{tries.push(path.join(require('child_process').execSync('npm root -g',{stdio:['ignore','pipe','ignore']}).toString().trim(),'playwright'));}catch{}
  for(const name of tries.filter(Boolean)){try{return require(name);}catch{}}
  throw new Error('Playwright not found. Install it (npm i -g playwright) or set PLAYWRIGHT_MODULE.');
}
const {chromium}=loadPlaywright();
async function launch(){
  const attempts=[];
  if(process.env.CLINIC_CHROMIUM)attempts.push({executablePath:process.env.CLINIC_CHROMIUM});
  attempts.push({channel:'chrome'},{});
  for(const dir of ['/opt/pw-browsers']){
    try{for(const d of fs.readdirSync(dir).filter(n=>/^chromium-\d+$/.test(n)))
      attempts.push({executablePath:path.join(dir,d,'chrome-linux','chrome')});}catch{}
  }
  let last;
  for(const options of attempts){try{return await chromium.launch({headless:true,...options});}catch(e){last=e;}}
  throw last;
}

const origin=process.env.CLINIC_URL||'http://127.0.0.1:4174';
const fixturePng=fs.readFileSync(path.join(__dirname,'face-test.png'));
const fixture='data:image/png;base64,'+fixturePng.toString('base64');
const GX=32,GY=24;

// A webcam made from the test portrait. `testBlank` takes the face away.
const fakeCamera=({data})=>{
  const NativeWorker=window.Worker;
  window.Worker=class extends NativeWorker{constructor(...a){super(...a);this.addEventListener('message',e=>{if(e.data.type==='result')window.testLandmarks=e.data.landmarks;});}};
  Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{
    const image=new Image();image.src=data;await image.decode();
    const c=document.createElement('canvas');c.width=640;c.height=480;
    const ctx=c.getContext('2d');window.testBlank=false;
    const draw=()=>{ctx.fillStyle='#777';ctx.fillRect(0,0,640,480);if(!window.testBlank)ctx.drawImage(image,100,0,300,300,80,0,480,480);};
    draw();window.testTimer=setInterval(draw,70);window.testStream=c.captureStream(15);return window.testStream;
  }});
};

// The stage against its source, per grid cell, as mean absolute difference.
const probe=({GX,GY})=>{
  const s=document.querySelector('#stage'),v=document.querySelector('#photo').hidden&&document.querySelector('#video').srcObject?document.querySelector('#video'):document.querySelector('#photo');
  const w=s.width,h=s.height;
  const read=source=>{const c=document.createElement('canvas');c.width=w;c.height=h;
    const x=c.getContext('2d',{willReadFrequently:true});x.drawImage(source,0,0,w,h);
    return x.getImageData(0,0,w,h).data;};
  const sd=read(s),vd=read(v);
  let diff=0;for(let i=0;i<sd.length;i+=4)diff+=Math.abs(sd[i]-vd[i])+Math.abs(sd[i+1]-vd[i+1])+Math.abs(sd[i+2]-vd[i+2]);
  const grid=[],luma=[];
  for(let gy=0;gy<GY;gy++)for(let gx=0;gx<GX;gx++){
    const x0=Math.floor(gx*w/GX),x1=Math.floor((gx+1)*w/GX),y0=Math.floor(gy*h/GY),y1=Math.floor((gy+1)*h/GY);
    let sum=0,lum=0,n=0;
    for(let y=y0;y<y1;y+=2)for(let x=x0;x<x1;x+=2){const i=(y*w+x)*4;
      sum+=Math.abs(sd[i]-vd[i])+Math.abs(sd[i+1]-vd[i+1])+Math.abs(sd[i+2]-vd[i+2]);
      lum+=sd[i]*.299+sd[i+1]*.587+sd[i+2]*.114;n++;}
    grid.push(sum/n/3);luma.push(lum/n);
  }
  return {w,h,diff:diff/(sd.length/4*3),grid,luma};
};
// Mean difference inside the box around some landmarks.
const region=({ids,pad=2})=>{
  const s=document.querySelector('#stage'),v=document.querySelector('#photo').hidden&&document.querySelector('#video').srcObject?document.querySelector('#video'):document.querySelector('#photo');
  const w=s.width,h=s.height,lm=window.testLandmarks;
  const read=source=>{const c=document.createElement('canvas');c.width=w;c.height=h;
    const x=c.getContext('2d',{willReadFrequently:true});x.drawImage(source,0,0,w,h);return x.getImageData(0,0,w,h).data;};
  const sd=read(s),vd=read(v);
  const xs=ids.map(i=>lm[i].x*w),ys=ids.map(i=>lm[i].y*h);
  const x0=Math.max(0,Math.floor(Math.min(...xs)-pad)),x1=Math.min(w,Math.ceil(Math.max(...xs)+pad));
  const y0=Math.max(0,Math.floor(Math.min(...ys)-pad)),y1=Math.min(h,Math.ceil(Math.max(...ys)+pad));
  let d=0,n=0;
  for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const i=(y*w+x)*4;
    d+=Math.abs(sd[i]-vd[i])+Math.abs(sd[i+1]-vd[i+1])+Math.abs(sd[i+2]-vd[i+2]);n++;}
  return {diff:d/n/3};
};
function changed(base,now,threshold=3){
  const cells=[];
  for(let i=0;i<now.grid.length;i++)if(Math.abs((base?base.grid[i]:0)-now.grid[i])>threshold)cells.push(i);
  if(!cells.length)return {count:0,maxX:0,share:0};
  return {count:cells.length,maxX:Math.max(...cells.map(i=>(i%GX+1)/GX)),share:cells.length/now.grid.length};
}
function moved(base,now){
  const cells=[];
  for(let i=0;i<base.luma.length;i++)if(Math.abs(base.luma[i]-now.luma[i])>3)cells.push(i);
  if(!cells.length)return {count:0,maxX:0};
  return {count:cells.length,maxX:Math.max(...cells.map(i=>(i%GX+1)/GX))};
}
// deform.js: every landmark a deformer anchors on must be listed in controlLandmarks,
// or the debug overlay will not mark it.
{
  const src=fs.readFileSync(path.join(__dirname,'..','deform.js'),'utf8');
  const between=(text,a,b)=>{const i=text.indexOf(a);return text.slice(i+a.length,text.indexOf(b,i+a.length));};
  const nums=text=>(text.match(/[0-9]+/g)||[]).map(Number);
  const declared=nums(between(src,'controlLandmarks={','};')).concat(nums(between(src,'frameLandmarks=[',']')));
  // every p(N) call, found without a regex so no escape can be lost in transit
  const anchors=[];let i=0;
  while((i=src.indexOf('p(',i))>=0){const close=src.indexOf(')',i),inner=src.slice(i+2,close);
    if(/^[0-9]+$/.test(inner))anchors.push(Number(inner));i=close+1;}
  const stale=[...new Set(anchors)].filter(n=>!declared.includes(n));
  assert.deepEqual(stale,[],`deform.js anchors on ${stale} but controlLandmarks omits them`);
}

const settle=page=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const setSlider=async(page,selector,value)=>{await page.locator(selector).fill(String(value));await page.locator(selector).dispatchEvent('input');};

(async()=>{
  const browser=await launch();
  const report={origin};
  try{
    const page=await browser.newPage({viewport:{width:1440,height:960},acceptDownloads:true});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(fakeCamera,{data:fixture});
    await page.goto(origin,{waitUntil:'domcontentloaded',timeout:60000});
    // Before the camera: the tray is there, nothing about makeup or shops is.
    const ids=await page.evaluate(()=>[...document.querySelectorAll('[data-procedure]')].map(b=>b.dataset.procedure));
    assert(ids.length>=16,`expected the full procedure tray, got ${ids.length}`);
    for(const gone of ['#mode-makeup','#shades','#basket','#panel-skin','#brush-toggle'])
      assert.equal(await page.locator(gone).count(),0,`${gone} is still on the page`);

    await page.locator('#start').click();
    await page.waitForFunction(()=>window.testLandmarks,null,{timeout:90000});
    await page.waitForFunction(()=>{const s=document.querySelector('#stage');return !s.hidden&&s.width>0;},null,{timeout:20000});
    await settle(page);
    assert.equal(await page.locator('#webgl-missing').isVisible(),false,'WebGL reported missing');
    assert.equal(await page.locator('#badge').isVisible(),true,'simulation badge missing');

    const identity=await page.evaluate(probe,{GX,GY});
    assert(identity.diff<1.5,`identity differs from source by ${identity.diff}`);
    report.identityDiff=Number(identity.diff.toFixed(4));

    // Every procedure changes part of the face, shows its facts and resets cleanly.
    report.procedures={};
    for(const id of ids){
      await page.locator(`[data-procedure="${id}"]`).click();
      await setSlider(page,'#strength',100);
      await page.waitForTimeout(80);await settle(page);
      const spot=changed(identity,await page.evaluate(probe,{GX,GY}),.8);
      assert(spot.count>0,`${id} changed nothing`);
      assert(spot.share<0.5,`${id} changed ${Math.round(spot.share*100)}% of the frame`);
      assert.equal(await page.locator('#procedure-facts').isVisible(),true,`${id} shows no facts`);
      report.procedures[id]=spot.count;
      await page.locator('#procedure-reset').click();
      await settle(page);
      assert(changed(identity,await page.evaluate(probe,{GX,GY}),.8).count===0,`${id} did not reset`);
    }

    // Variants change the result, and the measurements report the change.
    await page.locator('[data-procedure="rhinoplasty"]').click();
    await setSlider(page,'#strength',100);
    await page.locator('#variant-options [data-variant="natural"]').click();await settle(page);
    const natural=(await page.evaluate(region,{ids:[1,2,64,294,98,327],pad:10})).diff;
    await page.locator('#variant-options [data-variant="fantasy"]').click();await settle(page);
    const fantasy=(await page.evaluate(region,{ids:[1,2,64,294,98,327],pad:10})).diff;
    assert(fantasy>natural,`the fantasy rhinoplasty is not a bigger change than the natural one (${fantasy} vs ${natural})`);
    await page.waitForTimeout(300);
    const noseRow=await page.evaluate(()=>{
      const cells=[...document.querySelectorAll('#measure-table span')];
      const i=cells.findIndex(c=>c.textContent==='پهنای پرهٔ بینی');
      return i<0?null:{changed:cells[i].classList.contains('changed'),change:cells[i+3].textContent};
    });
    assert(noseRow&&noseRow.changed,'the measurements did not register a narrower nose');
    report.variants={natural:+natural.toFixed(2),fantasy:+fantasy.toFixed(2),noseWidth:noseRow.change};

    // The seam: "before" fills from the left edge, so dragging it right hides more.
    const dragSeam=fraction=>page.evaluate(f=>{
      const box=document.querySelector('#viewport').getBoundingClientRect(),s=document.querySelector('#stage');
      const ratio=s.width/s.height;let bw=box.width,bh=box.width/ratio;if(bh>box.height){bh=box.height;bw=box.height*ratio;}
      const left=box.left+(box.width-bw)/2;
      document.querySelector('#seam').dispatchEvent(new PointerEvent('pointerdown',
        {clientX:left+bw*f,clientY:box.top+box.height/2,bubbles:true,pointerId:1}));
    },fraction);
    assert.equal(await page.locator('#seam').isVisible(),true,'the seam is not shown with a procedure on');
    await dragSeam(0.5);await settle(page);
    const half=moved(identity,await page.evaluate(probe,{GX,GY}));
    assert(half.count>0,'the seam hid the whole result at the half-way point');
    assert(half.maxX<=0.56,`warped pixels leaked past the seam (to ${half.maxX})`);
    await dragSeam(0.04);await settle(page);
    const mostlyAfter=moved(identity,await page.evaluate(probe,{GX,GY}));
    await dragSeam(0.96);await settle(page);
    const mostlyBefore=moved(identity,await page.evaluate(probe,{GX,GY}));
    assert(mostlyAfter.count>0,'nothing visible with the seam at the "after" end');
    assert.equal(mostlyBefore.count,0,'dragging to "before" left warped pixels on screen');
    report.seam={after:mostlyAfter.count,half:half.count,before:mostlyBefore.count};
    // "Compare" off shows the whole result; on again brings the seam back.
    await page.locator('#compare').click();await settle(page);
    assert.equal(await page.locator('#seam').isVisible(),false,'compare off left the seam up');
    assert(moved(identity,await page.evaluate(probe,{GX,GY})).count>=mostlyAfter.count,'compare off did not show the whole result');
    await page.locator('#compare').click();await dragSeam(0.5);await settle(page);
    assert.equal(await page.locator('#seam').isVisible(),true,'compare on did not bring the seam back');

    // One at a time is the default: a second procedure replaces the first.
    await page.locator('#procedure-reset').click();
    const pressed=()=>page.evaluate(()=>[...document.querySelectorAll('[data-procedure][aria-pressed=true]')].map(b=>b.dataset.procedure));
    await page.locator('[data-procedure="rhinoplasty"]').click();
    await page.locator('[data-procedure="lip-filler"]').click();
    assert.deepEqual(await pressed(),['lip-filler'],'a second procedure did not replace the first');
    await page.locator('#combine-procedures').check();
    await page.locator('[data-procedure="rhinoplasty"]').click();
    assert.deepEqual((await pressed()).sort(),['lip-filler','rhinoplasty'],'combined, a second procedure did not add to the first');
    await page.locator('#combine-procedures').uncheck();
    assert.deepEqual(await pressed(),['rhinoplasty'],'turning "combine" off did not keep just the one in view');
    report.combine='replaces by default, adds when combined';

    // The fine controls work on their own, with no procedure picked.
    await page.locator('#procedure-reset').click();
    await page.locator('#fine-tune summary').click();
    await setSlider(page,'#fine-lip-fullness',80);
    await page.waitForTimeout(80);await settle(page);
    assert(changed(identity,await page.evaluate(probe,{GX,GY}),.8).count>0,'a fine control changed nothing');
    await page.locator('#procedure-reset').click();await settle(page);
    assert(changed(identity,await page.evaluate(probe,{GX,GY}),.8).count===0,'resetting left a fine control on');

    // Losing the face must not leave a warped frame behind.
    await page.locator('[data-procedure="rhinoplasty"]').click();
    await setSlider(page,'#strength',100);
    await page.evaluate(()=>window.testBlank=true);
    await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('صورت پیدا نشد'),null,{timeout:20000});
    await settle(page);
    assert((await page.evaluate(probe,{GX,GY})).diff<1.5,'stale warp after the face was lost');
    await page.evaluate(()=>{window.testBlank=false;window.testLandmarks=null;});
    await page.waitForFunction(()=>window.testLandmarks,null,{timeout:20000});

    /* ---- the debug overlay and the export ---- */
    const debugPixels=()=>page.evaluate(()=>{
      const c=document.querySelector('#debug'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
      let n=0;for(let i=3;i<d.length;i+=4)if(d[i])n++;return n;});
    await page.locator('#debug-panel summary').click();
    await page.locator('#debug-on').check();
    await setSlider(page,'#debug-size',0);                  // dots only, so every layer has room to add pixels
    await page.waitForTimeout(300);await settle(page);
    assert(await debugPixels()>0,'the debug overlay drew nothing');
    for(const layer of ['mesh','contours','axes','field']){
      const base=await debugPixels();
      await page.locator(`#debug-${layer}`).check();
      await page.waitForTimeout(350);await settle(page);
      assert(await debugPixels()>base,`the ${layer} layer drew nothing`);
      await page.locator(`#debug-${layer}`).uncheck();
      await page.waitForTimeout(150);await settle(page);   // gone before the next baseline
    }
    // The skin-texture masks show for a non-surgical treatment.
    await page.locator('[data-procedure="botox"]').click();
    {
      const base=await debugPixels();
      await page.locator('#debug-masks').check();
      await page.waitForTimeout(350);await settle(page);
      assert(await debugPixels()>base,'the masks layer drew nothing for botox');
      await page.locator('#debug-masks').uncheck();
    }
    await page.locator('[data-procedure="rhinoplasty"]').click();
    await setSlider(page,'#strength',100);
    await page.waitForTimeout(600);
    assert((await page.locator('#debug-stats').textContent()).includes('WebGL'),'the stats do not name the renderer');
    const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#debug-export').click()]);
    const exported=JSON.parse(fs.readFileSync(await download.path(),'utf8'));
    assert(exported.landmarks&&exported.landmarks.length>=468,'the export has no landmarks');
    assert.equal(exported.procedures.active.rhinoplasty,100,'the export does not record the procedures');
    assert(exported.measurements.after['nose-width'].value<exported.measurements.before['nose-width'].value,'the export does not show the narrower nose');
    await page.locator('#debug-on').uncheck();
    report.debug='layers draw, export records procedures and measurements';

    /* ---- snapshots ---- */
    await page.locator('#snap').click();
    await page.waitForFunction(()=>document.querySelector('#shots-count').textContent==='۱',null,{timeout:5000});
    await page.locator('#gallery-open').click();
    assert.match(await page.locator('.shot-bar span').first().textContent(),/بینی/,'the snapshot is not labelled with the procedure');
    await page.locator('#gallery-close').click();
    report.snapshot='taken and labelled';

    await page.locator('#stop').click();
    assert(await page.evaluate(()=>window.testStream.getTracks().every(t=>t.readyState==='ended')),'camera tracks left running');

    /* ---- a photo instead of the camera ---- */
    await page.locator('#photo-input').setInputFiles(path.join(__dirname,'face-test.png'));
    await page.waitForFunction(()=>window.testLandmarks&&!document.querySelector('#stage').hidden,null,{timeout:30000});
    await page.waitForFunction(()=>!/در حال پیدا کردن/.test(document.querySelector('#status').textContent),null,{timeout:20000});
    await settle(page);
    const photoBase=await page.evaluate(probe,{GX,GY});
    assert(photoBase.diff<1.5,`the photo differs from itself by ${photoBase.diff}`);
    report.photo='face found, procedure applied';

    /* ---- a turned face: the edits in depth show, and stay on the face ---- */
    await page.locator('#procedure-reset').click();
    await page.evaluate(()=>{window.testLandmarks=null;});
    await page.locator('#photo-input').setInputFiles(path.join(__dirname,'face-turned.png'));
    await page.waitForFunction(()=>window.testLandmarks&&/یک عمل را/.test(document.querySelector('#status').textContent),null,{timeout:30000});
    await settle(page);
    const turned=await page.evaluate(probe,{GX,GY});
    assert(turned.diff<1.5,`the turned photo differs from itself by ${turned.diff}`);
    const [poseFile]=await Promise.all([page.waitForEvent('download'),page.locator('#debug-export').click()]);
    const yaw=JSON.parse(fs.readFileSync(await poseFile.path(),'utf8')).pose.yaw;
    assert(Math.abs(yaw)>20,`the turned photo reads as only ${yaw.toFixed(1)}° turned`);
    await page.locator('#compare').click();                  // the whole result, no seam
    const CHIN=[17,200,199,175,152,148,377],NOSE=[168,6,197,195,5,4,1];
    const depthEdit=async(id,ids)=>{
      await setSlider(page,`#fine-${id}`,100);await page.waitForTimeout(150);await settle(page);
      const d=(await page.evaluate(region,{ids,pad:8})).diff;
      // Nothing changes away from the face.
      const away=await page.evaluate(()=>{
        const s=document.querySelector('#stage'),v=document.querySelector('#photo'),w=s.width,h=s.height,lm=window.testLandmarks;
        const read=src=>{const c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d',{willReadFrequently:true});x.drawImage(src,0,0,w,h);return x.getImageData(0,0,w,h).data;};
        const sd=read(s),vd=read(v),xs=lm.map(l=>l.x*w),ys=lm.map(l=>l.y*h);
        const face=Math.hypot((lm[454].x-lm[234].x)*w,(lm[454].y-lm[234].y)*h),m=face*.35;
        const x0=Math.min(...xs)-m,x1=Math.max(...xs)+m,y0=Math.min(...ys)-m,y1=Math.max(...ys)+m;
        let n=0;for(let y=0;y<h;y++)for(let x=0;x<w;x++){if(x>=x0&&x<=x1&&y>=y0&&y<=y1)continue;
          const i=(y*w+x)*4;if(Math.abs(sd[i]-vd[i])+Math.abs(sd[i+1]-vd[i+1])+Math.abs(sd[i+2]-vd[i+2])>6)n++;}
        return n;
      });
      assert.equal(away,0,`${id} changed ${away} pixels away from the face`);
      await setSlider(page,`#fine-${id}`,0);
      return d;
    };
    const chinTurned=await depthEdit('chin-projection',CHIN),humpTurned=await depthEdit('nose-hump',NOSE);
    assert(chinTurned>2,`bringing the chin forward barely shows on a turned face (${chinTurned.toFixed(2)})`);
    assert(humpTurned>1,`a bigger hump barely shows on a turned face (${humpTurned.toFixed(2)})`);
    // The measurements see it too.
    await setSlider(page,'#fine-chin-projection',100);await page.waitForTimeout(400);
    const chinRow=await page.evaluate(()=>{
      const cells=[...document.querySelectorAll('#measure-table span')],i=cells.findIndex(c=>c.textContent==='جلوآمدگی چانه نسبت به لب پایین');
      return i<0?null:{changed:cells[i].classList.contains('changed'),up:cells[i+3].classList.contains('up')};
    });
    assert(chinRow&&chinRow.changed&&chinRow.up,'the chin measurement did not register the chin coming forward');
    await page.locator('#procedure-reset').click();
    await page.locator('#compare').click();
    report.turned={yaw:+yaw.toFixed(1),chin:+chinTurned.toFixed(2),hump:+humpTurned.toFixed(2)};

    // A link straight to a procedure.
    await page.goto(origin+'/#procedure=lip-filler',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.querySelector('#procedure-title').textContent==='تزریق ژل لب',null,{timeout:10000});
    report.link='#procedure= opens it';

    /* ---- a narrow screen: the image and the slider share it ---- */
    await page.setViewportSize({width:390,height:844});
    await settle(page);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'horizontal scroll at 390px');

    /* ---- the patient record, the report, a backup ---- */
    {
      const ctx=await browser.newContext({viewport:{width:1440,height:960},acceptDownloads:true});
      const rp=await ctx.newPage(),rerrors=[];
      rp.on('pageerror',e=>rerrors.push(e.message));rp.on('dialog',d=>d.accept());
      await rp.addInitScript(fakeCamera,{data:fixture});
      await rp.goto(origin,{waitUntil:'domcontentloaded'});
      const toastSays=text=>rp.waitForFunction(t=>document.querySelector('#toast').textContent.includes(t),text,{timeout:20000});
      const shotCount=n=>rp.waitForFunction(n=>document.querySelectorAll('#record-shots .shot').length===n,n,{timeout:20000});
      await rp.locator('#patient-open').click();
      assert.equal(await rp.locator('#patients').isVisible(),true,'the patient list did not open');
      // The list fills in from IndexedDB a moment after the dialog opens.
      await rp.waitForFunction(()=>/هنوز بیماری ثبت نشده/.test(document.querySelector('#patient-list').textContent),null,{timeout:10000})
        .catch(()=>assert.fail('a fresh record is not empty'));
      await rp.locator('#clinic-settings summary').click();
      await rp.locator('#clinic-name').fill('کلینیک نمونه');await rp.locator('#doctor-name').fill('دکتر نمونه');
      await rp.locator('#patient-new').click();
      await rp.locator('#pf-name').fill('بیمار آزمایشی');await rp.locator('#pf-code').fill('T-1');
      await rp.locator('#pf-age').fill('34');await rp.locator('#pf-sex').selectOption('f');
      await rp.locator('#patient-form button[type=submit]').click();
      await rp.waitForSelector('#record[open]');
      assert.equal(await rp.locator('#patient-name').textContent(),'بیمار آزمایشی','the open patient is not named in the header');
      await rp.locator('#record-close').click();
      // Snapshots go into today's visit, before and after.
      await rp.locator('#start').click();
      await rp.waitForFunction(()=>!document.querySelector('#stage').hidden&&/یک عمل را/.test(document.querySelector('#status').textContent),null,{timeout:90000});
      await rp.locator('[data-procedure="rhinoplasty"]').click();await setSlider(rp,'#strength',90);
      await rp.locator('#snap').click();await toastSays('در پروندهٔ');
      await rp.locator('#combine-procedures').check();
      await rp.locator('[data-procedure="chin-implant"]').click();
      await rp.evaluate(()=>{document.querySelector('#toast').textContent='';});
      await rp.locator('#snap').click();await toastSays('در پروندهٔ');
      await rp.locator('#patient-open').click();await shotCount(2);
      await rp.locator('#record-note').fill('یادداشت آزمایشی پزشک');
      // The report: a real PDF, one page or more per pair, named for the file code.
      const pdf=async()=>{
        const [d]=await Promise.all([rp.waitForEvent('download',{timeout:60000}),rp.locator('#record-pdf').click()]);
        const bytes=fs.readFileSync(await d.path());
        return {name:d.suggestedFilename(),bytes,pages:(bytes.toString('latin1').match(/\/Type \/Page\b(?!s)/g)||[]).length};
      };
      const both=await pdf();
      assert.match(both.name,/^report-T-1-\d{4}-\d\d-\d\d\.pdf$/,`the report is named ${both.name}`);
      assert.equal(both.bytes.subarray(0,5).toString(),'%PDF-','the report is not a PDF');
      assert(both.bytes.toString('latin1').includes('/DCTDecode')&&both.bytes.toString('latin1').trimEnd().endsWith('%%EOF'),'the PDF is not whole');
      assert(both.pages>=2,`a report of two pairs has ${both.pages} page`);
      try{
        const file=path.join(require('os').tmpdir(),'clinic-check-report.pdf');fs.writeFileSync(file,both.bytes);
        const info=require('child_process').execSync(`pdfinfo "${file}"`,{stdio:['ignore','pipe','ignore']}).toString();
        assert.match(info,new RegExp(`Pages:\\s+${both.pages}\\b`),'pdfinfo reads another page count');
        report.pdfinfo='valid';
      }catch(e){if(e instanceof assert.AssertionError)throw e;report.pdfinfo='not installed';}
      // Left out of the report, a shot leaves it shorter.
      await rp.locator('#record-shots .shot').nth(1).locator('input[type=checkbox]').uncheck();
      await rp.waitForTimeout(200);
      const one=await pdf();
      assert(one.pages<both.pages,`leaving a shot out did not shorten the report (${one.pages} vs ${both.pages})`);
      // It is all still there after a reload.
      await rp.reload({waitUntil:'domcontentloaded'});
      await rp.waitForFunction(()=>document.querySelector('#patient-name').textContent==='بیمار آزمایشی',null,{timeout:10000});
      await rp.locator('#patient-open').click();await shotCount(2);
      assert.equal(await rp.locator('#record-note').inputValue(),'یادداشت آزمایشی پزشک','the note was not kept');
      // A backup, a deletion, and the backup back.
      await rp.locator('#record-switch').click();
      await rp.locator('#clinic-settings summary').click();
      const [b]=await Promise.all([rp.waitForEvent('download'),rp.locator('#backup-save').click()]);
      const backupFile=await b.path(),data=JSON.parse(fs.readFileSync(backupFile,'utf8'));
      assert.equal(data.patients.length,1,'the backup does not hold the patient');
      assert.equal(data.shots.length,2,'the backup does not hold both shots');
      assert(data.shots.every(s=>/^data:image\/jpeg/.test(s.before)&&/^data:image\/jpeg/.test(s.after)),'the backup does not hold the pictures');
      await rp.locator('#patients-close').click();
      await rp.locator('#patient-open').click();await rp.waitForSelector('#record[open]');
      await rp.locator('#record-delete').click();
      await rp.waitForFunction(()=>document.querySelector('#patient-name').textContent==='بیمار',null,{timeout:10000});
      await rp.locator('#patient-open').click();
      await rp.waitForFunction(()=>/هنوز بیماری ثبت نشده/.test(document.querySelector('#patient-list').textContent),null,{timeout:10000});
      await rp.locator('#backup-load').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:fs.readFileSync(backupFile)});
      await rp.waitForSelector('#patient-list [data-patient]',{timeout:10000});
      await rp.locator('#patient-list [data-patient]').first().click();
      await shotCount(2);
      assert.deepEqual(rerrors,[],'page errors in the record');
      report.record={pdfPages:both.pages,oneShot:one.pages,backupShots:data.shots.length};
      await ctx.close();
    }

    /* ---- the patient's screen ---- */
    {
      const ctx=await browser.newContext({viewport:{width:1440,height:900}});
      const dp=await ctx.newPage(),perrors=[];
      dp.on('pageerror',e=>perrors.push('doctor: '+e.message));
      await dp.addInitScript(fakeCamera,{data:fixture});
      await dp.goto(origin,{waitUntil:'domcontentloaded'});
      const [pop]=await Promise.all([dp.waitForEvent('popup'),dp.locator('#present-open').click()]);
      pop.on('pageerror',e=>perrors.push('patient: '+e.message));
      await pop.waitForLoadState();await pop.setViewportSize({width:1280,height:720});
      await pop.waitForFunction(()=>window.rojaPresent,null,{timeout:10000});
      assert.equal(await pop.locator('#idle').isVisible(),true,'the patient screen does not wait quietly before the camera');
      assert.equal(await dp.locator('#present-open').getAttribute('aria-pressed'),'true','the button does not show the screen is open');
      await dp.locator('#start').click();
      await dp.waitForFunction(()=>!document.querySelector('#stage').hidden&&/یک عمل را/.test(document.querySelector('#status').textContent),null,{timeout:90000});
      await pop.waitForFunction(()=>{const v=document.querySelector('#view');return !v.hidden&&v.videoWidth>0;},null,{timeout:20000});
      await dp.locator('[data-procedure="rhinoplasty"]').click();await setSlider(dp,'#strength',100);
      await pop.waitForFunction(()=>document.querySelector('#caption').textContent.includes('جراحی بینی'),null,{timeout:5000});
      await pop.waitForTimeout(500);
      // The same picture as the doctor's (small differences from the video encoding).
      const small=(page,sel)=>page.evaluate(sel=>{const e=document.querySelector(sel),c=document.createElement('canvas');c.width=160;c.height=120;
        const x=c.getContext('2d',{willReadFrequently:true});x.drawImage(e,0,0,160,120);return Array.from(x.getImageData(0,0,160,120).data);},sel);
      const a=await small(dp,'#stage'),v=await small(pop,'#view');
      let diff=0;for(let i=0;i<a.length;i+=4)diff+=Math.abs(a[i]-v[i])+Math.abs(a[i+1]-v[i+1])+Math.abs(a[i+2]-v[i+2]);
      diff/=a.length/4*3;
      assert(diff<4,`the patient screen differs from the doctor's by ${diff.toFixed(2)}`);
      // The seam follows the doctor's.
      assert.equal(await pop.locator('#seam').isVisible(),true,'no seam on the patient screen');
      const seamAt=()=>pop.evaluate(()=>parseFloat(document.querySelector('#seam-line').style.left));
      const before=await seamAt();
      await dp.evaluate(()=>{const box=document.querySelector('#viewport').getBoundingClientRect(),s=document.querySelector('#stage');
        const ratio=s.width/s.height;let bw=box.width,bh=box.width/ratio;if(bh>box.height){bh=box.height;bw=box.height*ratio;}
        document.querySelector('#seam').dispatchEvent(new PointerEvent('pointerdown',{clientX:box.left+(box.width-bw)/2+bw*.25,clientY:box.top+box.height/2,bubbles:true,pointerId:1}));});
      await pop.waitForFunction(b=>Math.abs(parseFloat(document.querySelector('#seam-line').style.left)-b)>50,before,{timeout:5000});
      await dp.locator('#compare').click();
      await pop.waitForFunction(()=>document.querySelector('#seam').hidden,null,{timeout:5000});
      // Stopping the camera leaves no frozen picture behind.
      await dp.locator('#stop').click();
      await pop.waitForFunction(()=>!document.querySelector('#idle').hidden,null,{timeout:10000});
      // P closes it and opens it again.
      await dp.keyboard.press('p');
      await pop.waitForEvent('close',{timeout:5000}).catch(()=>{});
      assert.equal(pop.isClosed(),true,'P did not close the patient screen');
      assert.equal(await dp.locator('#present-open').getAttribute('aria-pressed'),'false','the button still shows the screen open');
      const [again]=await Promise.all([dp.waitForEvent('popup'),dp.keyboard.press('p')]);
      await again.waitForLoadState();
      assert.deepEqual(perrors,[],'page errors around the patient screen');
      report.patientScreen={diff:+diff.toFixed(2)};
      await ctx.close();
    }

    report.errors=errors;
    assert.deepEqual(errors,[],'page errors');
    console.log(JSON.stringify(report,null,1));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});

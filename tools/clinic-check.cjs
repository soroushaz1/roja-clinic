// Browser checks for Roja Clinic: every procedure changes the face and nothing else,
// variants, the seam, the measurements, the debug overlay, snapshots and a photo.
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
  const s=document.querySelector('#stage'),v=document.querySelector('#video');
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

    // A link straight to a procedure.
    await page.goto(origin+'/#procedure=lip-filler',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.querySelector('#procedure-title').textContent==='تزریق ژل لب',null,{timeout:10000});
    report.link='#procedure= opens it';

    /* ---- a narrow screen: the image and the slider share it ---- */
    await page.setViewportSize({width:390,height:844});
    await settle(page);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'horizontal scroll at 390px');

    report.errors=errors;
    assert.deepEqual(errors,[],'page errors');
    console.log(JSON.stringify(report,null,1));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});

// Every procedure on every face in a folder, at its usual strength: how much of the
// picture each one changes, and which change too little to see. A preview that shows
// nothing reads as broken, so the run fails when a procedure changes almost nothing.
//
//   node tools/preview.cjs     (PORT=4174 by default)
//   node tools/procedure-audit.cjs <faces folder> [out folder]
//
// The faces are front-on portraits (Roja's tools/showcase/faces and tools/calibrate/faces
// are made by AI for this). With an out folder, each face's before and after pictures are
// written there, to look at. Playwright as for clinic-check.cjs.
const fs=require('fs'),path=require('path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const ORIGIN=process.env.CLINIC_URL||'http://127.0.0.1:4174';
const [facesDir,outDir]=process.argv.slice(2);
if(!facesDir)throw new Error('usage: node tools/procedure-audit.cjs <faces folder> [out folder]');
// A procedure counts as showing nothing when, on some face, under this share of the
// face's pixels changed visibly (by more than 10 of 255) and the face as a whole changed
// by under MEAN levels on average: a reshaping moves few pixels a lot, a skin treatment
// many pixels a little.
const LEAST=.25,MEAN=.6;
const W=768,H=1024;
const BARE=`#viewport{position:fixed!important;top:0!important;left:0!important;width:100vw!important;height:100vh!important;max-height:none!important;min-height:0!important;z-index:2147483646!important;border:0!important;border-radius:0!important;margin:0!important}
#toolbar,#seam,#guide,#hud,#flash,#loading,#v3,.menu,#tap-start,.v3-capture,#welcome,#badge{display:none!important}`;

(async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.ROJA_CHROMIUM&&{executablePath:process.env.ROJA_CHROMIUM})});
  if(outDir)fs.mkdirSync(outDir,{recursive:true});
  const faces=fs.readdirSync(facesDir).filter(f=>/\.(png|jpe?g)$/i.test(f)).sort();
  const table={};
  for(const file of faces){
    const face=file.replace(/\.\w+$/,'');
    const page=await browser.newPage({viewport:{width:W,height:H}});
    // The tracker's landmarks for the face's box (as clinic-check.cjs reads them).
    await page.addInitScript(()=>{const N=window.Worker;window.Worker=class extends N{constructor(...a){super(...a);
      this.addEventListener('message',e=>{if(e.data.type==='result')window.testLandmarks=e.data.landmarks;});}};});
    await page.goto(ORIGIN+'/index.html');
    const data=fs.readFileSync(path.join(facesDir,file)).toString('base64');
    await page.evaluate(async d=>{const blob=await (await fetch('data:image/png;base64,'+d)).blob(),t=new DataTransfer();
      t.items.add(new File([blob],'face.png',{type:'image/png'}));
      document.querySelector('#viewport').dispatchEvent(new DragEvent('drop',{dataTransfer:t,bubbles:true,cancelable:true}));},data);
    try{await page.waitForFunction(()=>document.querySelector('#guide').hidden&&!document.querySelector('#toolbar').hidden&&window.testLandmarks,null,{timeout:240000});}
    catch{console.log(`${face}: no face found`);await page.close();continue;}
    await page.addStyleTag({content:BARE});await page.waitForTimeout(2000);
    // The face's box on screen: the frame is contained in the window and mirrored.
    const box=await page.evaluate(({W,H})=>{
      const c=document.querySelector('#stage'),fw=c.width,fh=c.height,k=Math.min(W/fw,H/fh),ox=(W-fw*k)/2,oy=(H-fh*k)/2;
      let x0=W,x1=0,y0=H,y1=0;
      for(const p of window.testLandmarks){const x=ox+(1-p.x)*fw*k,y=oy+p.y*fh*k;x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}
      const m=.08*(x1-x0);return {x:Math.max(0,Math.round(x0-m)),y:Math.max(0,Math.round(y0-m)),width:Math.round(x1-x0+2*m),height:Math.round(y1-y0+2*m)};
    },{W,H});
    const before=await page.screenshot({clip:box});
    if(outDir)fs.writeFileSync(path.join(outDir,`${face}-before.png`),before);
    const ids=await page.evaluate(()=>[...document.querySelectorAll('[data-procedure]')].map(b=>b.dataset.procedure));
    table[face]={};
    for(const id of ids){
      await page.evaluate(id=>document.querySelector(`[data-procedure="${id}"]`).click(),id);
      await page.evaluate(()=>{const c=document.querySelector('#compare');if(c.getAttribute('aria-pressed')==='true')c.click();});
      await page.waitForTimeout(1500);
      const after=await page.screenshot({clip:box});
      if(outDir)fs.writeFileSync(path.join(outDir,`${face}-${id}.png`),after);
      // The share of the box's pixels that changed by more than 10 in any channel.
      table[face][id]=await page.evaluate(async([a,b])=>{
        const load=async s=>{const i=new Image();i.src='data:image/png;base64,'+s;await i.decode();
          const c=document.createElement('canvas');c.width=i.width;c.height=i.height;const x=c.getContext('2d');x.drawImage(i,0,0);
          return x.getImageData(0,0,c.width,c.height).data;};
        const A=await load(a),B=await load(b);let n=0,sum=0;
        for(let k=0;k<A.length;k+=4){
          const d=Math.max(Math.abs(A[k]-B[k]),Math.abs(A[k+1]-B[k+1]),Math.abs(A[k+2]-B[k+2]));
          if(d>10)n++;sum+=d;
        }
        return {changed:+(n/(A.length/4)*100).toFixed(2),mean:+(sum/(A.length/4)).toFixed(2)};
      },[before.toString('base64'),after.toString('base64')]);
      await page.evaluate(()=>{const r=document.querySelector('#procedure-reset');if(!r.hidden)r.click();});
      await page.waitForTimeout(400);
    }
    console.log(face,JSON.stringify(table[face]));
    await page.close();
  }
  await browser.close();
  // Per procedure, the least any face showed.
  const ids=[...new Set(Object.values(table).flatMap(t=>Object.keys(t)))];
  const weak=[];
  for(const id of ids){
    const values=Object.values(table).map(t=>t[id]).filter(v=>v!=null);
    const nothing=values.some(v=>v.changed<LEAST&&v.mean<MEAN);
    const least=Math.min(...values.map(v=>v.changed)),flat=Math.min(...values.map(v=>v.mean));
    console.log(`${id.padEnd(16)} changed at least ${least.toFixed(2)}% · mean change at least ${flat.toFixed(2)}${nothing?'  ← shows almost nothing':''}`);
    if(nothing)weak.push(id);
  }
  if(weak.length){console.log(`\nshow almost nothing at their usual strength: ${weak.join(', ')}`);process.exitCode=1;}
})().catch(e=>{console.error(e);process.exit(1);});

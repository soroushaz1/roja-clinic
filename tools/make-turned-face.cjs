// Makes tools/face-turned.png, a three-quarter view for the tests, from the front-on
// test portrait: the tracker's own 3D landmarks for that face, turned about the
// head's vertical axis, and the portrait's texture drawn again triangle by triangle
// onto the turned mesh, farthest first. Hair, ears and neck are not part of the mesh
// and are left out; what the test needs is a face the tracker reads as turned.
//
//   node tools/preview.cjs                # in one terminal
//   node tools/make-turned-face.cjs [yaw] # in another; yaw in degrees, default 50
const fs=require('fs'),path=require('path');
function loadPlaywright(){
  const tries=[process.env.PLAYWRIGHT_MODULE,'playwright'];
  try{tries.push(path.join(require('child_process').execSync('npm root -g',{stdio:['ignore','pipe','ignore']}).toString().trim(),'playwright'));}catch{}
  for(const name of tries.filter(Boolean)){try{return require(name);}catch{}}
  throw new Error('Playwright not found.');
}
const {chromium}=loadPlaywright();
const origin=process.env.CLINIC_URL||'http://127.0.0.1:4174';
const yaw=Number(process.argv[2]||50);
const portrait='data:image/png;base64,'+fs.readFileSync(path.join(__dirname,'face-test.png')).toString('base64');

(async()=>{
  const attempts=[{channel:'chrome'},{}];
  try{for(const d of fs.readdirSync('/opt/pw-browsers').filter(n=>/^chromium-\d+$/.test(n)))
    attempts.push({executablePath:path.join('/opt/pw-browsers',d,'chrome-linux','chrome')});}catch{}
  let browser;for(const o of attempts){try{browser=await chromium.launch({headless:true,...o});break;}catch{}}
  const page=await browser.newPage();
  await page.goto(origin,{waitUntil:'domcontentloaded'});
  const png=await page.evaluate(async({portrait,yaw})=>{
    const {points3,headFrame}=await import('./deform.js?v=5');
    const {WARP_TRIANGLES}=await import('./facemesh.js?v=5');
    const Vision=await import('./vendor/vision_bundle.mjs');
    await import('./face-core.js?v=5');
    const core=self.rojaFaceCore(Vision,new URL('./',location.href).href);
    await core.init('CPU');
    // The portrait framed as the test camera frames it.
    const image=new Image();image.src=portrait;await image.decode();
    const W=640,H=480,src=document.createElement('canvas');src.width=W;src.height=H;
    const sx=src.getContext('2d');sx.fillStyle='#777';sx.fillRect(0,0,W,H);sx.drawImage(image,100,0,300,300,80,0,480,480);
    const found=core.handle({frame:sx.getImageData(0,0,W,H),timestamp:1}).landmarks;
    if(!found)throw new Error('no face in the portrait');
    const P=points3(found,W,H),{ex,ey,ez,center}=headFrame(P);
    const c=Math.cos(yaw*Math.PI/180),s=Math.sin(yaw*Math.PI/180);
    // Each point in the head's frame, turned about its vertical axis.
    const turned=P.map(q=>{
      const v={x:q.x-center.x,y:q.y-center.y,z:q.z-center.z};
      const a=v.x*ex.x+v.y*ex.y+v.z*ex.z,b=v.x*ey.x+v.y*ey.y+v.z*ey.z,f=v.x*ez.x+v.y*ez.y+v.z*ez.z;
      const a2=a*c+f*s,f2=-a*s+f*c;
      return {x:center.x+ex.x*a2+ey.x*b+ez.x*f2,y:center.y+ex.y*a2+ey.y*b+ez.y*f2,z:center.z+ex.z*a2+ey.z*b+ez.z*f2};
    });
    const out=document.createElement('canvas');out.width=W;out.height=H;
    const ox=out.getContext('2d');ox.fillStyle='#777';ox.fillRect(0,0,W,H);
    // Farthest first; each triangle mapped affinely from the portrait, a hair larger
    // than itself so no seams show between them.
    const tris=[];
    for(let t=0;t<WARP_TRIANGLES.length;t+=3){
      const i=WARP_TRIANGLES[t],j=WARP_TRIANGLES[t+1],k=WARP_TRIANGLES[t+2];
      tris.push([i,j,k,(turned[i].z+turned[j].z+turned[k].z)/3]);
    }
    tris.sort((a,b)=>b[3]-a[3]);                                  // larger z is farther
    for(const [i,j,k] of tris){
      const s0=P[i],s1=P[j],s2=P[k],d0=turned[i],d1=turned[j],d2=turned[k];
      const den=(s1.x-s0.x)*(s2.y-s0.y)-(s2.x-s0.x)*(s1.y-s0.y);
      if(Math.abs(den)<1e-6)continue;
      const m11=((d1.x-d0.x)*(s2.y-s0.y)-(d2.x-d0.x)*(s1.y-s0.y))/den,m12=((d2.x-d0.x)*(s1.x-s0.x)-(d1.x-d0.x)*(s2.x-s0.x))/den;
      const m21=((d1.y-d0.y)*(s2.y-s0.y)-(d2.y-d0.y)*(s1.y-s0.y))/den,m22=((d2.y-d0.y)*(s1.x-s0.x)-(d1.y-d0.y)*(s2.x-s0.x))/den;
      const cx=(d0.x+d1.x+d2.x)/3,cy=(d0.y+d1.y+d2.y)/3,grow=p=>({x:cx+(p.x-cx)*1.04,y:cy+(p.y-cy)*1.04});
      const g0=grow(d0),g1=grow(d1),g2=grow(d2);
      ox.save();ox.beginPath();ox.moveTo(g0.x,g0.y);ox.lineTo(g1.x,g1.y);ox.lineTo(g2.x,g2.y);ox.closePath();ox.clip();
      ox.setTransform(m11,m21,m12,m22,d0.x-m11*s0.x-m12*s0.y,d0.y-m21*s0.x-m22*s0.y);
      ox.drawImage(src,0,0);ox.restore();
    }
    core.close();
    return out.toDataURL('image/png');
  },{portrait,yaw});
  const file=path.join(__dirname,'face-turned.png');
  fs.writeFileSync(file,Buffer.from(png.split(',')[1],'base64'));
  console.log(`wrote ${file} (${yaw}°)`);
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});

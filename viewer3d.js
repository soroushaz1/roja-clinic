// The 3D view: the patient's face as a model to turn by hand, from the front round to
// the profile, before or after.
//
// The model is the tracker's own face mesh (468 points with their depth), placed in
// the head's frame as the front picture has it, with a skirt of three rings round its
// edge that reach back over the hair, the ears and the neck and fade out. Its texture
// comes from up to three pictures of the patient: one front-on and one turned each
// way. Each point of the model takes its colour from the pictures that saw it
// squarely, weighted by how squarely, and only where nothing hid it from that picture
// (each picture's own depth map, as the stage does for the live view), so the turned
// pictures fill in the side of the nose and cheek that the front one sees only
// edge-on. The edits move the model's points in 3D (deform.js) and the points keep the
// texture of where they were, exactly as on the live picture.
//
// It is all drawn on this device, from frames already on screen.
import {points3,headFrame,displacements} from './deform.js?v=11';
import {WARP_TRIANGLES} from './facemesh.js?v=11';
import {PRECISION,SEEN_VERT,SEEN_FRAG} from './shaders.js?v=11';

const MESH=468, VIEWS=3;
// The face's outline, in order round it (MediaPipe's face oval).
export const OVAL=[10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,
  152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109];
// The skirt: how far each ring reaches out from the outline and back round the head,
// in face widths, how much of it shows, and how much of the outline's own move under
// an edit it follows.
const RINGS=[{out:.07,back:.05,alpha:1,follow:.8},{out:.17,back:.17,alpha:.9,follow:.45},{out:.28,back:.34,alpha:0,follow:.15}];
const COUNT=MESH+OVAL.length*RINGS.length;
// How sharply the picture that saw a point most squarely wins over the others.
const SHARP=25;
// The limits of turning, in degrees. Past ~80° the model is mostly what no picture saw.
export const LIMITS={yaw:80,pitch:30};

const VERT=`attribute vec3 a_pos;attribute vec2 a_uv0;attribute vec2 a_uv1;attribute vec2 a_uv2;
attribute vec3 a_dep;attribute vec3 a_w;attribute float a_alpha;uniform mat4 u_mvp;
varying vec2 v_uv0;varying vec2 v_uv1;varying vec2 v_uv2;varying vec3 v_dep;varying vec3 v_w;varying float v_alpha;
void main(){v_uv0=a_uv0;v_uv1=a_uv1;v_uv2=a_uv2;v_dep=a_dep*.5+.5;v_w=a_w;v_alpha=a_alpha;gl_Position=u_mvp*vec4(a_pos,1.);}`;
// Each picture counts by how squarely it saw the point (a_w), if it saw it at all:
// inside the frame, and nothing nearer at that pixel in its depth map. Where none did,
// the front picture still gives the colour.
const FRAG=`uniform sampler2D u_img0;uniform sampler2D u_img1;uniform sampler2D u_img2;
uniform sampler2D u_seen0;uniform sampler2D u_seen1;uniform sampler2D u_seen2;uniform float u_tol;
varying vec2 v_uv0;varying vec2 v_uv1;varying vec2 v_uv2;varying vec3 v_dep;varying vec3 v_w;varying float v_alpha;
float seen(sampler2D s,vec2 uv){vec4 d=texture2D(s,uv);return d.r+d.g/255.;}
float inside(vec2 uv){return step(0.,uv.x)*step(uv.x,1.)*step(0.,uv.y)*step(uv.y,1.);}
void main(){
  if(v_alpha<.01)discard;
  float w0=v_w.x*inside(v_uv0)*step(v_dep.x-u_tol,seen(u_seen0,v_uv0));
  float w1=v_w.y*inside(v_uv1)*step(v_dep.y-u_tol,seen(u_seen1,v_uv1));
  float w2=v_w.z*inside(v_uv2)*step(v_dep.z-u_tol,seen(u_seen2,v_uv2));
  vec3 c0=texture2D(u_img0,v_uv0).rgb,c=c0;
  float sum=w0+w1+w2;
  if(sum>1e-5)c=(c0*w0+texture2D(u_img1,v_uv1).rgb*w1+texture2D(u_img2,v_uv2).rgb*w2)/sum;
  gl_FragColor=vec4(c,v_alpha);
}`;

const sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z});
const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
const cross=(a,b)=>({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});
const unit=v=>{const l=Math.hypot(v.x,v.y,v.z)||1;return {x:v.x/l,y:v.y/l,z:v.z/l};};

// The triangles: the face mesh, then the skirt, ring by ring from the outline out.
function skirtTriangles(){
  const out=[...WARP_TRIANGLES],n=OVAL.length;
  const ring=(k,j)=>k<0?OVAL[j%n]:MESH+k*n+(j%n);
  for(let k=0;k<RINGS.length;k++)for(let j=0;j<n;j++){
    const a=ring(k-1,j),b=ring(k-1,j+1),c=ring(k,j),d=ring(k,j+1);
    out.push(a,b,c,b,d,c);
  }
  return new Uint16Array(out);
}
const TRIANGLES=skirtTriangles();

// Column-major 4×4 matrices, as WebGL takes them.
function perspective(fov,aspect,near,far){
  const f=1/Math.tan(fov/2),nf=1/(near-far);
  return [f/aspect,0,0,0, 0,f,0,0, 0,0,(far+near)*nf,-1, 0,0,2*far*near*nf,0];
}
function multiply(a,b){
  const o=new Array(16);
  for(let c=0;c<4;c++)for(let r=0;r<4;r++){let s=0;for(let k=0;k<4;k++)s+=a[k*4+r]*b[c*4+k];o[c*4+r]=s;}
  return o;
}
// Turned by `yaw` about the vertical, then tilted by `pitch`, `distance` from the eye;
// the model's down (y) made up, and raised by `lift` so the face, which sits a little
// below the middle of the head, is in the middle of the picture.
function modelView(yaw,pitch,distance,lift){
  const cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
  // R = Rx(pitch)·Ry(yaw)·diag(1,-1,1), then moved back along z.
  return [cy,sp*sy,-cp*sy,0, 0,-cp,-sp,0, sy,-sp*cy,cp*cy,0, 0,lift,-distance,1];
}
// The vertical field of view that fits the head with its skirt (about 2.1 face widths
// tall and 1.7 wide) at `distance`, whatever the shape of the picture.
const fov=(aspect,distance)=>2*Math.atan(Math.max(1.05,.85/aspect)/distance);

export function createViewer3d(canvas){
  const options={alpha:false,antialias:true,depth:true,preserveDrawingBuffer:true};
  let gl;
  try{gl=canvas.getContext('webgl',options)||canvas.getContext('experimental-webgl',options);}catch{return null;}
  if(!gl)return null;
  let main,seen;
  try{
    const compile=(type,src)=>{const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);
      if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;};
    const link=(v,f)=>{const p=gl.createProgram();gl.attachShader(p,compile(gl.VERTEX_SHADER,v));gl.attachShader(p,compile(gl.FRAGMENT_SHADER,PRECISION+f));
      gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p));
      const a=n=>gl.getAttribLocation(p,n),u=n=>gl.getUniformLocation(p,n);return {p,a,u};};
    main=link(VERT,FRAG);seen=link(SEEN_VERT,SEEN_FRAG);
  }catch{return null;}

  const buffer=(data,target=gl.ARRAY_BUFFER)=>{const b=gl.createBuffer();gl.bindBuffer(target,b);gl.bufferData(target,data,gl.STATIC_DRAW);return b;};
  const index=buffer(TRIANGLES,gl.ELEMENT_ARRAY_BUFFER);
  const before=new Float32Array(COUNT*3), after=new Float32Array(COUNT*3);
  const uvs=[0,1,2].map(()=>new Float32Array(COUNT*2)), deps=new Float32Array(COUNT*3);
  const viewDep=[0,1,2].map(()=>new Float32Array(COUNT));
  const weights=new Float32Array(COUNT*3), alpha=new Float32Array(COUNT);
  const buf={before:buffer(before),after:buffer(after),uv:uvs.map(u=>buffer(u)),dep:buffer(deps),w:buffer(weights),alpha:buffer(alpha),
    viewDep:viewDep.map(d=>buffer(d))};
  const texture=()=>{const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);
    for(const [k,v] of [[gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE],[gl.TEXTURE_MIN_FILTER,gl.LINEAR],[gl.TEXTURE_MAG_FILTER,gl.LINEAR]])gl.texParameteri(gl.TEXTURE_2D,k,v);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([0,0,0,255]));return t;};
  const images=[0,1,2].map(texture);
  const seens=[0,1,2].map(()=>({tex:texture(),fbo:gl.createFramebuffer(),rb:gl.createRenderbuffer(),w:1,h:1}));

  let model=null;            // what build() worked out from the pictures
  let state={mode:'after',yaw:0,pitch:0};
  let spin=0,spinStart=0,raf=0,disposed=false,ready=false;

  function set(buffer,data){gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);}
  function attrib(loc,buffer,size){if(loc<0)return;gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,size,gl.FLOAT,false,0,0);}

  // From the pictures: views[0] front-on, then up to two turned ones; each
  // {image (a canvas), landmarks (as the tracker gives them), width, height}.
  function build(views){
    views=views.slice(0,VIEWS);
    const frames=views.map(v=>{const P=points3(v.landmarks,v.width,v.height);return {P,f:headFrame(P),v};});
    const {P,f}=frames[0];
    const toLocal=p=>{const d=sub(p,f.center);return {x:dot(d,f.ex)/f.face,y:dot(d,f.ey)/f.face,z:dot(d,f.ez)/f.face};};
    const L=new Array(COUNT);
    for(let i=0;i<MESH;i++)L[i]=toLocal(P[i]);
    // The skirt, out from the outline's middle and back round the head.
    let cx=0,cy=0;for(const i of OVAL){cx+=L[i].x/OVAL.length;cy+=L[i].y/OVAL.length;}
    const n=OVAL.length;
    RINGS.forEach((ring,k)=>OVAL.forEach((b,j)=>{
      const q=L[b],dx=q.x-cx,dy=q.y-cy,l=Math.hypot(dx,dy)||1;
      L[MESH+k*n+j]={x:q.x+dx/l*ring.out,y:q.y+dy/l*ring.out,z:q.z-ring.back};
    }));
    const base=i=>i<MESH?i:OVAL[(i-MESH)%n];
    // Normals, each triangle's turned away from the middle of the head.
    const N=L.map(()=>({x:0,y:0,z:0}));
    for(let t=0;t<TRIANGLES.length;t+=3){
      const a=L[TRIANGLES[t]],b=L[TRIANGLES[t+1]],c=L[TRIANGLES[t+2]];
      let nn=cross(sub(b,a),sub(c,a));
      const mid={x:(a.x+b.x+c.x)/3,y:(a.y+b.y+c.y)/3,z:(a.z+b.z+c.z)/3};
      if(dot(nn,mid)<0)nn={x:-nn.x,y:-nn.y,z:-nn.z};
      for(const i of [TRIANGLES[t],TRIANGLES[t+1],TRIANGLES[t+2]]){N[i].x+=nn.x;N[i].y+=nn.y;N[i].z+=nn.z;}
    }
    for(let i=0;i<COUNT;i++)N[i]=unit(N[i]);
    weights.fill(0);
    frames.forEach(({P:Pv,f:fv,v},s)=>{
      // Towards this camera, in the head's frame: image z grows away from the camera.
      const toward=unit({x:-fv.ex.z,y:-fv.ey.z,z:-fv.ez.z});
      for(let i=0;i<COUNT;i++){
        const b=base(i),q=L[i],o=L[b];
        // The point in this picture: the landmark itself, or the skirt carried by its
        // outline point.
        const off={x:q.x-o.x,y:q.y-o.y,z:q.z-o.z},pb=Pv[b];
        const p=i<MESH?pb:{x:pb.x+fv.face*(off.x*fv.ex.x+off.y*fv.ey.x+off.z*fv.ez.x),
          y:pb.y+fv.face*(off.x*fv.ex.y+off.y*fv.ey.y+off.z*fv.ez.y),z:pb.z+fv.face*(off.x*fv.ex.z+off.y*fv.ey.z+off.z*fv.ez.z)};
        uvs[s][i*2]=p.x/v.width;uvs[s][i*2+1]=p.y/v.height;
        const depth=Math.max(-.99,Math.min(.99,(p.z-fv.center.z)/(fv.face*2)));
        deps[i*3+s]=depth;viewDep[s][i]=depth;
        // Sharply in favour of the picture that saw the point most squarely, so each
        // part of the face comes mostly from one picture and they blend only where one
        // hands over to the next: averaged everywhere, their small misalignments blur.
        const c=dot(N[i],toward);
        weights[i*3+s]=c>.05?Math.exp(SHARP*(c-1)):0;
      }
      // The picture, and its depth map.
      gl.bindTexture(gl.TEXTURE_2D,images[s]);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,v.image);
    });
    for(let s=frames.length;s<VIEWS;s++){uvs[s].fill(-1);for(let i=0;i<COUNT;i++)deps[i*3+s]=0;}
    // Each point's weights relative to its best picture; the front one keeps a trace
    // everywhere, so no point is left with none.
    for(let i=0;i<COUNT;i++){
      const m=Math.max(weights[i*3],weights[i*3+1],weights[i*3+2])||1;
      for(let s=0;s<VIEWS;s++)weights[i*3+s]/=m;
      weights[i*3]=Math.max(weights[i*3],1e-3);
    }
    for(let i=0;i<COUNT;i++)alpha[i]=i<MESH?1:RINGS[Math.floor((i-MESH)/n)].alpha;
    uvs.forEach((u,s)=>set(buf.uv[s],u));viewDep.forEach((d,s)=>set(buf.viewDep[s],d));
    set(buf.dep,deps);set(buf.w,weights);set(buf.alpha,alpha);
    for(let i=0;i<COUNT;i++){before[i*3]=L[i].x;before[i*3+1]=L[i].y;before[i*3+2]=L[i].z;}
    set(buf.before,before);
    model={P,f,L,n,views:frames.length,size:frames.map(({v})=>[v.width,v.height])};
    frames.forEach((_,s)=>drawSeen(s));
    after.set(before);set(buf.after,after);
    ready=true;
    draw();
  }

  // One picture's depth map: the model where that picture saw it, nearest surface kept.
  function drawSeen(s){
    const [w,h]=model.size[s],k=Math.min(1,1024/Math.max(w,h)),t=seens[s];
    t.w=Math.max(1,Math.round(w*k));t.h=Math.max(1,Math.round(h*k));
    gl.bindTexture(gl.TEXTURE_2D,t.tex);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,t.w,t.h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.bindRenderbuffer(gl.RENDERBUFFER,t.rb);gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT16,t.w,t.h);
    gl.bindFramebuffer(gl.FRAMEBUFFER,t.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,t.tex,0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,t.rb);
    gl.viewport(0,0,t.w,t.h);gl.disable(gl.BLEND);
    gl.clearColor(1,1,0,1);gl.clearDepth(1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    gl.useProgram(seen.p);
    attrib(seen.a('a_uv'),buf.uv[s],2);attrib(seen.a('a_src'),buf.viewDep[s],1);
    gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LESS);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,index);gl.drawElements(gl.TRIANGLES,TRIANGLES.length,gl.UNSIGNED_SHORT,0);
    gl.disable(gl.DEPTH_TEST);
    for(let k=0;k<8;k++)gl.disableVertexAttribArray(k);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
  }

  // The edits, on the front picture's landmarks, carried into the model; the skirt
  // follows its outline point, less and less towards its edge.
  function setAmounts(amounts){
    if(!model)return;
    const {P,f,L,n}=model,d=displacements(P,amounts);
    for(let i=0;i<COUNT;i++){
      const b=i<MESH?i:OVAL[(i-MESH)%n],k=i<MESH?1:RINGS[Math.floor((i-MESH)/n)].follow;
      let x=0,y=0,z=0;
      if(d){const dx=d[b*3],dy=d[b*3+1],dz=d[b*3+2];
        x=(dx*f.ex.x+dy*f.ex.y+dz*f.ex.z)/f.face*k;y=(dx*f.ey.x+dy*f.ey.y+dz*f.ey.z)/f.face*k;z=(dx*f.ez.x+dy*f.ez.y+dz*f.ez.z)/f.face*k;}
      after[i*3]=L[i].x+x;after[i*3+1]=L[i].y+y;after[i*3+2]=L[i].z+z;
    }
    set(buf.after,after);
    draw();
  }

  function render(mode,yaw,pitch,width,height){
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    gl.viewport(0,0,width,height);
    gl.clearColor(.078,.047,.067,1);gl.clearDepth(1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    if(!model)return;
    gl.useProgram(main.p);
    const deg=Math.PI/180,aspect=width/height;
    const mvp=multiply(perspective(fov(aspect,4.4),aspect,.5,20),modelView(yaw*deg,pitch*deg,4.4,.1));
    gl.uniformMatrix4fv(main.u('u_mvp'),false,new Float32Array(mvp));
    gl.uniform1f(main.u('u_tol'),.006);
    attrib(main.a('a_pos'),mode==='before'?buf.before:buf.after,3);
    attrib(main.a('a_uv0'),buf.uv[0],2);attrib(main.a('a_uv1'),buf.uv[1],2);attrib(main.a('a_uv2'),buf.uv[2],2);
    attrib(main.a('a_dep'),buf.dep,3);attrib(main.a('a_w'),buf.w,3);attrib(main.a('a_alpha'),buf.alpha,1);
    for(let s=0;s<VIEWS;s++){
      gl.activeTexture(gl.TEXTURE0+s);gl.bindTexture(gl.TEXTURE_2D,images[s]);gl.uniform1i(main.u(`u_img${s}`),s);
      gl.activeTexture(gl.TEXTURE3+s);gl.bindTexture(gl.TEXTURE_2D,seens[s].tex);gl.uniform1i(main.u(`u_seen${s}`),3+s);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,index);gl.drawElements(gl.TRIANGLES,TRIANGLES.length,gl.UNSIGNED_SHORT,0);
    gl.disable(gl.BLEND);gl.disable(gl.DEPTH_TEST);
    for(let k=0;k<8;k++)gl.disableVertexAttribArray(k);
  }
  function fitCanvas(){
    const r=Math.min(2,window.devicePixelRatio||1);
    const w=Math.max(1,Math.round(canvas.clientWidth*r)),h=Math.max(1,Math.round(canvas.clientHeight*r));
    if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
  }
  function draw(){
    if(disposed||gl.isContextLost())return;
    fitCanvas();
    render(state.mode,state.yaw,state.pitch,canvas.width,canvas.height);
  }

  // Turning by hand: the canvas is mirrored on screen like the live picture, so a drag
  // to the right turns the face to the right as seen.
  let drag=null;
  canvas.addEventListener('pointerdown',e=>{
    if(!ready)return;
    drag={x:e.clientX,y:e.clientY,yaw:state.yaw,pitch:state.pitch};stopSpin();
    canvas.setPointerCapture?.(e.pointerId);
  });
  canvas.addEventListener('pointermove',e=>{
    if(!drag)return;
    const k=180/Math.max(240,canvas.clientWidth);
    turn(drag.yaw-(e.clientX-drag.x)*k,drag.pitch+(e.clientY-drag.y)*k);
  });
  const end=()=>{drag=null;};
  canvas.addEventListener('pointerup',end);canvas.addEventListener('pointercancel',end);
  canvas.addEventListener('dblclick',()=>{stopSpin();animateTo(0,0);});
  window.addEventListener('resize',()=>{if(ready&&canvas.clientWidth)draw();});

  function turn(yaw,pitch){
    state.yaw=Math.max(-LIMITS.yaw,Math.min(LIMITS.yaw,yaw));
    state.pitch=Math.max(-LIMITS.pitch,Math.min(LIMITS.pitch,pitch));
    draw();onTurn?.(state);
  }
  // A smooth turn to an angle, for the presets.
  function animateTo(yaw,pitch=0){
    cancelAnimationFrame(raf);
    const from={yaw:state.yaw,pitch:state.pitch},t0=performance.now();
    const step=now=>{
      const t=Math.min(1,(now-t0)/450),e=t*t*(3-2*t);
      turn(from.yaw+(yaw-from.yaw)*e,from.pitch+(pitch-from.pitch)*e);
      if(t<1)raf=requestAnimationFrame(step);
    };
    raf=requestAnimationFrame(step);
  }
  // Turning slowly from one side to the other and back, for showing the patient.
  function startSpin(){
    cancelAnimationFrame(raf);spin=1;spinStart=performance.now();
    const amp=55,phase=Math.asin(Math.max(-1,Math.min(1,state.yaw/amp)));
    const step=now=>{
      if(!spin)return;
      turn(amp*Math.sin(phase+(now-spinStart)/1000*.9),state.pitch*.96);
      raf=requestAnimationFrame(step);
    };
    raf=requestAnimationFrame(step);
  }
  function stopSpin(){if(spin){spin=0;cancelAnimationFrame(raf);onSpin?.(false);}}
  let onTurn=null,onSpin=null;

  return {
    build,setAmounts,draw,animateTo,
    get state(){return {...state};},
    get views(){return model?.views||0;},
    get spinning(){return !!spin;},
    setMode(mode){state.mode=mode;draw();},
    spin(on){if(on){startSpin();onSpin?.(true);}else stopSpin();},
    on(handlers){onTurn=handlers.turn||null;onSpin=handlers.spin||null;},
    // A picture of the model at the current angle, `mode` before or after, in a
    // canvas of its own, as the WebGL canvas has it (not mirrored).
    picture(mode,width,height){
      const keep=[canvas.width,canvas.height];
      canvas.width=width;canvas.height=height;
      render(mode,state.yaw,state.pitch,width,height);
      const c=document.createElement('canvas');c.width=width;c.height=height;
      c.getContext('2d').drawImage(canvas,0,0);
      [canvas.width,canvas.height]=keep;
      draw();
      return c;
    },
    clear(){model=null;ready=false;stopSpin();draw();},
    dispose(){
      if(disposed)return;disposed=true;stopSpin();cancelAnimationFrame(raf);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  };
}

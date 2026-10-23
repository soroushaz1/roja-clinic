// The 3D view: the patient's face as a model to turn by hand, from the front round to
// the profile, before or after.
//
// The model is the tracker's own face mesh (468 points with their depth), placed in
// the head's frame as the front picture has it: the face alone, not the head, with a
// narrow rim round its edge that fades out so the edge is soft. It is smoothed by two rounds of
// subdivision that keep every original point where it is (each new point sits on the
// curved surface the points' normals describe, as in Phong tessellation): an
// approximating scheme like Catmull–Clark would pull in the tip of the nose and the
// chin, the very shape being simulated.
//
// Its texture comes from up to three pictures: one front-on and one turned each way,
// each the sharpest of a few frames. Every pixel of the model takes its colour from the
// picture that saw it most squarely, judged per pixel from the smoothed surface's
// normal, blending into the next only where one hands over to it, and only where
// nothing hid that spot from the picture (each picture's own depth map, as on the live
// view). The turned pictures are brought to the front one's colour first, since the
// camera's exposure changes as the head turns.
//
// The edits move the model's points in 3D (deform.js), and the points keep the texture
// of where they were, exactly as on the live picture. It is all done on this device,
// from frames already on screen.
import {points3,headFrame,displacements} from './deform.js?v=12';
import {WARP_TRIANGLES} from './facemesh.js?v=12';
import {PRECISION,SEEN_VERT,SEEN_FRAG} from './shaders.js?v=12';

const MESH=468, VIEWS=3, LEVELS=2;
// The face's outline, in order round it (MediaPipe's face oval).
export const OVAL=[10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,
  152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109];
// No rim past the outline: the face's own edge fades instead (EDGE below). The skirt
// code stays for a rim, should one be wanted: each ring's reach round the head past the
// outline (radians; below the chin down the neck by `neck` face widths instead), and how
// much of the outline's move under an edit it follows.
const RINGS=[];
const BASE=MESH+OVAL.length*RINGS.length;
// How sharply the picture that saw a point most squarely wins over the others.
const SHARP=25;
// The limits of turning, in degrees. Past ~80° the model is mostly what no picture saw.
export const LIMITS={yaw:80,pitch:30};

const VERT=`attribute vec3 a_pos;attribute vec2 a_uv0;attribute vec2 a_uv1;attribute vec2 a_uv2;
attribute vec3 a_dep;attribute vec3 a_n;attribute vec2 a_edge;uniform mat4 u_mvp;
varying vec2 v_uv0;varying vec2 v_uv1;varying vec2 v_uv2;varying vec3 v_dep;varying vec3 v_n;varying vec2 v_edge;
void main(){v_uv0=a_uv0;v_uv1=a_uv1;v_uv2=a_uv2;v_dep=a_dep*.5+.5;v_n=a_n;v_edge=a_edge;gl_Position=u_mvp*vec4(a_pos,1.);}`;
// Per pixel: how squarely each picture saw this spot (the surface's normal against the
// way to that camera), if it saw it at all (inside its frame, nothing nearer in its
// depth map). Where none did, the front picture still gives the colour. v_edge: x how
// much shows (the rim fades out), y how near the face's edge this is.
const FRAG=`uniform sampler2D u_img0;uniform sampler2D u_img1;uniform sampler2D u_img2;
uniform sampler2D u_seen0;uniform sampler2D u_seen1;uniform sampler2D u_seen2;
uniform vec3 u_to0;uniform vec3 u_to1;uniform vec3 u_to2;uniform vec3 u_gain1;uniform vec3 u_gain2;uniform vec3 u_has;uniform float u_tol;
varying vec2 v_uv0;varying vec2 v_uv1;varying vec2 v_uv2;varying vec3 v_dep;varying vec3 v_n;varying vec2 v_edge;
float inside(vec2 uv){return step(0.,uv.x)*step(uv.x,1.)*step(0.,uv.y)*step(uv.y,1.);}
float depth(vec4 d){return d.r+d.g/255.;}
void main(){
  if(v_edge.x<.02)discard;
  vec3 n=normalize(v_n);
  vec3 c=vec3(dot(n,u_to0),dot(n,u_to1),dot(n,u_to2))*u_has-(1.-u_has)*2.;
  float top=max(c.x,max(c.y,c.z));
  vec3 w=exp(${SHARP}.*(c-top))*step(.05,c)*u_has;
  w*=vec3(inside(v_uv0),inside(v_uv1),inside(v_uv2));
  w*=step(v_dep-u_tol,vec3(depth(texture2D(u_seen0,v_uv0)),depth(texture2D(u_seen1,v_uv1)),depth(texture2D(u_seen2,v_uv2))));
  float sum=w.x+w.y+w.z;
  vec3 c0=texture2D(u_img0,v_uv0).rgb,col=c0;
  if(sum>1e-5)col=(c0*w.x+texture2D(u_img1,v_uv1).rgb*u_gain1*w.y+texture2D(u_img2,v_uv2).rgb*u_gain2*w.z)/sum;
  // Near the edge, faded where no picture saw it squarely enough to give it more than a
  // stretched smear (the side of the face by the ear and down the jaw, with only a front
  // picture). Never inside the face: under the nose and between the lips no picture
  // sees squarely either.
  float a=v_edge.x*mix(1.,smoothstep(.2,.5,top),v_edge.y);
  if(a<.02)discard;
  gl_FragColor=vec4(col,a);
}`;

const sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z});
const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
const unit=v=>{const l=Math.hypot(v.x,v.y,v.z)||1;return {x:v.x/l,y:v.y/l,z:v.z/l};};

// The triangles: the face mesh, then the skirt, ring by ring from the outline out.
function baseTriangles(){
  const out=[...WARP_TRIANGLES],n=OVAL.length;
  const ring=(k,j)=>k<0?OVAL[j%n]:MESH+k*n+(j%n);
  for(let k=0;k<RINGS.length;k++)for(let j=0;j<n;j++){
    const a=ring(k-1,j),b=ring(k-1,j+1),c=ring(k,j),d=ring(k,j+1);
    out.push(a,b,c,b,d,c);
  }
  return out;
}
// Each round of subdivision: every edge gets a point (its two ends listed in `edges`,
// numbered on from `from`), every triangle becomes four.
function subdivideTopology(tris,count){
  const index=new Map(),edges=[],out=[];
  const mid=(a,b)=>{
    const key=a<b?a*65536+b:b*65536+a;
    let i=index.get(key);
    if(i===undefined){i=count+edges.length/2;index.set(key,i);edges.push(a,b);}
    return i;
  };
  for(let t=0;t<tris.length;t+=3){
    const a=tris[t],b=tris[t+1],c=tris[t+2],ab=mid(a,b),bc=mid(b,c),ca=mid(c,a);
    out.push(a,ab,ca, ab,b,bc, ca,bc,c, ab,bc,ca);
  }
  return {from:count,edges:Uint16Array.from(edges),tris:out,count:count+edges.length/2};
}
const ROUNDS=[];
{
  let tris=baseTriangles(),count=BASE;
  ROUNDS.push({tris,count});
  for(let l=0;l<LEVELS;l++){const r=subdivideTopology(tris,count);ROUNDS.push(r);tris=r.tris;count=r.count;}
}
const COUNT=ROUNDS[ROUNDS.length-1].count;
// The face's edge, per point of the mesh: how much of it shows (the outline itself not
// at all and the step in partly, so the edge is soft; the chin's outline in full, as
// its line in profile is part of what is simulated), and how near the outline it is
// (1 on it, less by a fifth for each step in across the mesh), for fading what no
// picture saw squarely.
const CHIN=new Set([378,400,377,152,148,176,149]);
const EDGE=(()=>{
  const steps=new Array(MESH).fill(Infinity),next=new Map();
  for(let t=0;t<WARP_TRIANGLES.length;t+=3)for(let k=0;k<3;k++){
    const a=WARP_TRIANGLES[t+k],b=WARP_TRIANGLES[t+(k+1)%3];
    if(!next.has(a))next.set(a,[]);if(!next.has(b))next.set(b,[]);next.get(a).push(b);next.get(b).push(a);
  }
  let ring=[...OVAL];for(const i of ring)steps[i]=0;
  for(let d=1;d<5;d++){const out=[];for(const i of ring)for(const j of next.get(i)||[])if(steps[j]===Infinity){steps[j]=d;out.push(j);}ring=out;}
  return steps.map((d,i)=>({show:CHIN.has(i)?1:d===0?0:d===1?.75:1,near:Math.max(0,1-d/5)}));
})();
const TRIANGLES=new Uint16Array(ROUNDS[ROUNDS.length-1].tris);

// Normals at the points of `pos` (x,y,z triples, the first `count` points), from the
// triangles round each, each turned away from the middle of the head.
function normals(pos,tris,count,out){
  out.fill(0,0,count*3);
  for(let t=0;t<tris.length;t+=3){
    const a=tris[t]*3,b=tris[t+1]*3,c=tris[t+2]*3;
    const ux=pos[b]-pos[a],uy=pos[b+1]-pos[a+1],uz=pos[b+2]-pos[a+2],vx=pos[c]-pos[a],vy=pos[c+1]-pos[a+1],vz=pos[c+2]-pos[a+2];
    let nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;
    if(nx*(pos[a]+pos[b]+pos[c])+ny*(pos[a+1]+pos[b+1]+pos[c+1])+nz*(pos[a+2]+pos[b+2]+pos[c+2])<0){nx=-nx;ny=-ny;nz=-nz;}
    for(const i of [a,b,c]){out[i]+=nx;out[i+1]+=ny;out[i+2]+=nz;}
  }
  for(let i=0;i<count*3;i+=3){const l=Math.hypot(out[i],out[i+1],out[i+2])||1;out[i]/=l;out[i+1]/=l;out[i+2]/=l;}
}
// Two rounds of subdivision on `pos` (the base points filled in, room for the rest),
// each new point on the curved surface the normals describe between an edge's ends
// (Phong tessellation, α = 3/4). `each(i,a,b,ox,oy,oz)` hears of every new point i,
// with its edge's ends and how far it stands off the straight line between them.
const ALPHA=.75;
function subdivide(pos,nrm,each){
  for(let r=1;r<ROUNDS.length;r++){
    const {from,edges}=ROUNDS[r],{tris,count}=ROUNDS[r-1];
    normals(pos,tris,count,nrm);
    for(let e=0;e<edges.length;e+=2){
      const a=edges[e]*3,b=edges[e+1]*3,i=from+e/2;
      const mx=(pos[a]+pos[b])/2,my=(pos[a+1]+pos[b+1])/2,mz=(pos[a+2]+pos[b+2])/2;
      // The midpoint onto each end's tangent plane, and the mean of the two.
      const da=(mx-pos[a])*nrm[a]+(my-pos[a+1])*nrm[a+1]+(mz-pos[a+2])*nrm[a+2];
      const db=(mx-pos[b])*nrm[b]+(my-pos[b+1])*nrm[b+1]+(mz-pos[b+2])*nrm[b+2];
      const ox=-ALPHA*(da*nrm[a]+db*nrm[b])/2,oy=-ALPHA*(da*nrm[a+1]+db*nrm[b+1])/2,oz=-ALPHA*(da*nrm[a+2]+db*nrm[b+2])/2;
      pos[i*3]=mx+ox;pos[i*3+1]=my+oy;pos[i*3+2]=mz+oz;
      each?.(i,edges[e],edges[e+1],ox,oy,oz);
    }
  }
  normals(pos,TRIANGLES,COUNT,nrm);
}

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
// Turned about `pivot` by `yaw` about the vertical, then tilted by `pitch`, `distance`
// from the eye; the model's down (y) made up.
function modelView(yaw,pitch,distance,pivot){
  const cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
  // R = Rx(pitch)·Ry(yaw)·diag(1,-1,1), applied to (point − pivot), then moved back.
  const m=[cy,sp*sy,-cp*sy,0, 0,-cp,-sp,0, sy,-sp*cy,cp*cy,0, 0,0,-distance,1];
  for(let r=0;r<3;r++)m[12+r]-=m[r]*pivot.x+m[4+r]*pivot.y+m[8+r]*pivot.z;
  return m;
}
// The vertical field of view that fits a ball of `radius` at `distance`, whatever the
// shape of the picture, with a little room round it.
const fov=(aspect,distance,radius)=>2*Math.asin(Math.min(.99,radius*1.08/distance/Math.min(1,aspect)));

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
  const before=new Float32Array(COUNT*3), after=new Float32Array(COUNT*3), nrm=new Float32Array(COUNT*3), scratch=new Float32Array(COUNT*3);
  const uvs=[0,1,2].map(()=>new Float32Array(COUNT*2)), deps=new Float32Array(COUNT*3);
  const viewDep=[0,1,2].map(()=>new Float32Array(COUNT));
  const edge=new Float32Array(COUNT*2);
  const buf={before:buffer(before),after:buffer(after),n:buffer(nrm),uv:uvs.map(u=>buffer(u)),dep:buffer(deps),edge:buffer(edge),
    viewDep:viewDep.map(d=>buffer(d))};
  const texture=(filter=gl.LINEAR)=>{const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);
    for(const [k,v] of [[gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE],[gl.TEXTURE_MIN_FILTER,filter],[gl.TEXTURE_MAG_FILTER,filter]])gl.texParameteri(gl.TEXTURE_2D,k,v);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([0,0,0,255]));return t;};
  const images=[0,1,2].map(()=>texture());
  const seens=[0,1,2].map(()=>({tex:texture(gl.NEAREST),fbo:gl.createFramebuffer(),rb:gl.createRenderbuffer(),w:1,h:1}));

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
    const L=new Array(BASE);
    for(let i=0;i<MESH;i++)L[i]=toLocal(P[i]);
    // The rim. The head round the face is taken as an ellipsoid as wide as the outline,
    // a quarter higher than it is above its middle, and 0.6 of a face width deep; the
    // rim carries the outline a little way round it, towards the back. Below the chin
    // it runs a little way down the neck instead.
    let cx=0,cy=0,wide=0,top=Infinity;
    for(const i of OVAL){cx+=L[i].x/OVAL.length;cy+=L[i].y/OVAL.length;}
    for(const i of OVAL){wide=Math.max(wide,Math.abs(L[i].x-cx));top=Math.min(top,L[i].y);}
    const C={x:cx,y:cy,z:-.05},R={x:wide*1.05,y:(cy-top)*1.25,z:.6};
    const n=OVAL.length;
    RINGS.forEach((ring,k)=>OVAL.forEach((b,j)=>{
      const q=L[b];
      let u={x:(q.x-C.x)/R.x,y:(q.y-C.y)/R.y,z:(q.z-C.z)/R.z};
      const r=Math.hypot(u.x,u.y,u.z)||1;u={x:u.x/r,y:u.y/r,z:u.z/r};
      // Along the ellipsoid towards the back of the head.
      const t=unit({x:u.z*u.x,y:u.z*u.y,z:u.z*u.z-1}),cs=Math.cos(ring.turn),sn=Math.sin(ring.turn);
      const v={x:u.x*cs+t.x*sn,y:u.y*cs+t.y*sn,z:u.z*cs+t.z*sn};
      const round={x:C.x+R.x*v.x*r,y:C.y+R.y*v.y*r,z:C.z+R.z*v.z*r};
      const down={x:q.x,y:q.y+ring.neck,z:q.z-ring.neck*.3};
      const dx=q.x-cx,dy=q.y-cy,l=Math.hypot(dx,dy)||1,s=Math.max(0,Math.min(1,(dy/l-.3)/.5)),m=s*s*(3-2*s);
      L[MESH+k*n+j]={x:round.x+(down.x-round.x)*m,y:round.y+(down.y-round.y)*m,z:round.z+(down.z-round.z)*m};
    }));
    for(let i=0;i<BASE;i++){before[i*3]=L[i].x;before[i*3+1]=L[i].y;before[i*3+2]=L[i].z;}
    const base=i=>i<MESH?i:OVAL[(i-MESH)%n];
    // Each picture's view of the base points: where they are in it, and how deep.
    frames.forEach(({P:Pv,f:fv,v},s)=>{
      for(let i=0;i<BASE;i++){
        const b=base(i),q=L[i],o=L[b],pb=Pv[b];
        // The landmark itself, or the skirt carried by its outline point.
        const off={x:q.x-o.x,y:q.y-o.y,z:q.z-o.z};
        const p=i<MESH?pb:{x:pb.x+fv.face*(off.x*fv.ex.x+off.y*fv.ey.x+off.z*fv.ez.x),
          y:pb.y+fv.face*(off.x*fv.ex.y+off.y*fv.ey.y+off.z*fv.ez.y),z:pb.z+fv.face*(off.x*fv.ex.z+off.y*fv.ey.z+off.z*fv.ez.z)};
        uvs[s][i*2]=p.x/v.width;uvs[s][i*2+1]=p.y/v.height;
        deps[i*3+s]=Math.max(-.99,Math.min(.99,(p.z-fv.center.z)/(fv.face*2)));
      }
    });
    for(let i=0;i<BASE;i++){edge[i*2]=i<MESH?EDGE[i].show:0;edge[i*2+1]=i<MESH?EDGE[i].near:1;}
    // Subdivided: each new point's place in each picture is its edge's midpoint there,
    // moved by how far the curved surface stands off that edge, as that picture sees it.
    subdivide(before,nrm,(i,a,b,ox,oy,oz)=>{
      frames.forEach(({f:fv,v},s)=>{
        const k=fv.face;
        uvs[s][i*2]=(uvs[s][a*2]+uvs[s][b*2])/2+k*(ox*fv.ex.x+oy*fv.ey.x+oz*fv.ez.x)/v.width;
        uvs[s][i*2+1]=(uvs[s][a*2+1]+uvs[s][b*2+1])/2+k*(ox*fv.ex.y+oy*fv.ey.y+oz*fv.ez.y)/v.height;
        deps[i*3+s]=Math.max(-.99,Math.min(.99,(deps[a*3+s]+deps[b*3+s])/2+(ox*fv.ex.z+oy*fv.ey.z+oz*fv.ez.z)/2));
      });
      edge[i*2]=(edge[a*2]+edge[b*2])/2;edge[i*2+1]=(edge[a*2+1]+edge[b*2+1])/2;
    });
    for(let s=frames.length;s<VIEWS;s++){uvs[s].fill(-1);for(let i=0;i<COUNT;i++)deps[i*3+s]=0;}
    for(let s=0;s<VIEWS;s++)for(let i=0;i<COUNT;i++)viewDep[s][i]=deps[i*3+s];
    // Towards each camera, in the head's frame: image z grows away from the camera.
    const toward=frames.map(({f:fv})=>unit({x:-fv.ex.z,y:-fv.ey.z,z:-fv.ez.z}));
    frames.forEach(({v},s)=>{gl.bindTexture(gl.TEXTURE_2D,images[s]);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,v.image);});
    uvs.forEach((u,s)=>set(buf.uv[s],u));viewDep.forEach((d,s)=>set(buf.viewDep[s],d));
    set(buf.dep,deps);set(buf.edge,edge);set(buf.before,before);set(buf.n,nrm);
    // The face turns about its own middle, and is framed to the ball round it.
    let lo={x:Infinity,y:Infinity,z:Infinity},hi={x:-Infinity,y:-Infinity,z:-Infinity};
    for(let i=0;i<MESH;i++){const q=L[i];lo={x:Math.min(lo.x,q.x),y:Math.min(lo.y,q.y),z:Math.min(lo.z,q.z)};hi={x:Math.max(hi.x,q.x),y:Math.max(hi.y,q.y),z:Math.max(hi.z,q.z)};}
    const pivot={x:(lo.x+hi.x)/2,y:(lo.y+hi.y)/2,z:(lo.z+hi.z)/2};
    let radius=0;for(let i=0;i<COUNT;i++)radius=Math.max(radius,Math.hypot(before[i*3]-pivot.x,before[i*3+1]-pivot.y,before[i*3+2]-pivot.z));
    model={P,f,L,n,views:frames.length,size:frames.map(({v})=>[v.width,v.height]),toward,gains:colourGains(frames,toward),pivot,radius};
    frames.forEach((_,s)=>drawSeen(s));
    after.set(before);set(buf.after,after);
    ready=true;
    draw();
  }

  // Each turned picture's colour against the front one's: per channel, the ratio of the
  // two over the points both saw squarely. Clamped, so a bad match does little harm.
  function colourGains(frames,toward){
    const gains=[[1,1,1],[1,1,1],[1,1,1]];
    if(frames.length<2)return gains;
    const pixels=frames.map(({v})=>{
      const c=document.createElement('canvas'),k=Math.min(1,640/v.width);c.width=Math.round(v.width*k);c.height=Math.round(v.height*k);
      const x=c.getContext('2d',{willReadFrequently:true});x.drawImage(v.image,0,0,c.width,c.height);
      return {d:x.getImageData(0,0,c.width,c.height).data,w:c.width,h:c.height};
    });
    const sample=(s,i)=>{
      const {d,w,h}=pixels[s],u=uvs[s][i*2]*w,t=uvs[s][i*2+1]*h,out=[0,0,0];
      if(u<2||t<2||u>w-3||t>h-3)return null;
      for(let y=-1;y<=1;y++)for(let x=-1;x<=1;x++){const p=((Math.round(t)+y)*w+Math.round(u)+x)*4;out[0]+=d[p];out[1]+=d[p+1];out[2]+=d[p+2];}
      return out;
    };
    for(let s=1;s<frames.length;s++){
      const sum=[[0,0,0],[0,0,0]];let count=0;
      for(let i=0;i<MESH;i++){
        const nx=nrm[i*3],ny=nrm[i*3+1],nz=nrm[i*3+2];
        const c0=nx*toward[0].x+ny*toward[0].y+nz*toward[0].z,cs=nx*toward[s].x+ny*toward[s].y+nz*toward[s].z;
        if(c0<.8||cs<.8)continue;
        const a=sample(0,i),b=sample(s,i);if(!a||!b)continue;
        for(let k=0;k<3;k++){sum[0][k]+=a[k];sum[1][k]+=b[k];}count++;
      }
      if(count>=20)gains[s]=sum[0].map((v,k)=>Math.max(.75,Math.min(1.33,v/(sum[1][k]||1))));
    }
    return gains;
  }

  // One picture's depth map: the model where that picture saw it, nearest surface kept.
  function drawSeen(s){
    const [w,h]=model.size[s],k=Math.min(1,1024/Math.max(w,h)),t=seens[s];
    t.w=Math.max(1,Math.round(w*k));t.h=Math.max(1,Math.round(h*k));
    gl.bindTexture(gl.TEXTURE_2D,t.tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,t.w,t.h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.bindRenderbuffer(gl.RENDERBUFFER,t.rb);gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT16,t.w,t.h);
    gl.bindFramebuffer(gl.FRAMEBUFFER,t.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,t.tex,0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,t.rb);
    gl.viewport(0,0,t.w,t.h);gl.disable(gl.BLEND);
    gl.clearColor(1,1,1,1);gl.clearDepth(1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    gl.useProgram(seen.p);
    attrib(seen.a('a_uv'),buf.uv[s],2);attrib(seen.a('a_src'),buf.viewDep[s],1);
    gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LESS);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,index);gl.drawElements(gl.TRIANGLES,TRIANGLES.length,gl.UNSIGNED_SHORT,0);
    gl.disable(gl.DEPTH_TEST);
    for(let k=0;k<8;k++)gl.disableVertexAttribArray(k);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
  }

  // The edits, on the front picture's landmarks, carried into the model; the skirt
  // follows its outline point, less and less towards its edge. Then subdivided as
  // before, so the smoothed surface follows the edit.
  function setAmounts(amounts){
    if(!model)return;
    const {P,f,L,n}=model,d=displacements(P,amounts);
    for(let i=0;i<BASE;i++){
      const b=i<MESH?i:OVAL[(i-MESH)%n],k=i<MESH?1:RINGS[Math.floor((i-MESH)/n)].follow;
      let x=0,y=0,z=0;
      if(d){const dx=d[b*3],dy=d[b*3+1],dz=d[b*3+2];
        x=(dx*f.ex.x+dy*f.ex.y+dz*f.ex.z)/f.face*k;y=(dx*f.ey.x+dy*f.ey.y+dz*f.ey.z)/f.face*k;z=(dx*f.ez.x+dy*f.ez.y+dz*f.ez.z)/f.face*k;}
      after[i*3]=L[i].x+x;after[i*3+1]=L[i].y+y;after[i*3+2]=L[i].z+z;
    }
    subdivide(after,scratch);
    set(buf.after,after);
    draw();
  }

  function render(mode,yaw,pitch,width,height){
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    gl.viewport(0,0,width,height);
    gl.clearColor(.078,.047,.067,1);gl.clearDepth(1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    if(!model)return;
    gl.useProgram(main.p);
    const deg=Math.PI/180,aspect=width/height,u=main.u;
    const mvp=multiply(perspective(fov(aspect,4.4,model.radius),aspect,.5,20),modelView(yaw*deg,pitch*deg,4.4,model.pivot));
    gl.uniformMatrix4fv(u('u_mvp'),false,new Float32Array(mvp));
    gl.uniform1f(u('u_tol'),.006);
    for(let s=0;s<VIEWS;s++){const t=model.toward[s]||{x:0,y:0,z:0};gl.uniform3f(u(`u_to${s}`),t.x,t.y,t.z);}
    gl.uniform3f(u('u_has'),1,model.views>1?1:0,model.views>2?1:0);
    gl.uniform3fv(u('u_gain1'),model.gains[1]);gl.uniform3fv(u('u_gain2'),model.gains[2]);
    attrib(main.a('a_pos'),mode==='before'?buf.before:buf.after,3);
    attrib(main.a('a_uv0'),buf.uv[0],2);attrib(main.a('a_uv1'),buf.uv[1],2);attrib(main.a('a_uv2'),buf.uv[2],2);
    attrib(main.a('a_dep'),buf.dep,3);attrib(main.a('a_n'),buf.n,3);attrib(main.a('a_edge'),buf.edge,2);
    for(let s=0;s<VIEWS;s++){
      gl.activeTexture(gl.TEXTURE0+s);gl.bindTexture(gl.TEXTURE_2D,images[s]);gl.uniform1i(u(`u_img${s}`),s);
      gl.activeTexture(gl.TEXTURE3+s);gl.bindTexture(gl.TEXTURE_2D,seens[s].tex);gl.uniform1i(u(`u_seen${s}`),3+s);
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

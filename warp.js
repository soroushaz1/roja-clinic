// How the 3D edits reach the picture.
//
// deform.js moves every landmark in 3D. Here each frame those moves become a warp of
// the camera picture, in two layers the stage draws one over the other:
//
// - the face itself, through MediaPipe's own mesh: every triangle is drawn where its
//   corners have moved to, textured from where they were, with a depth test, so what
//   is nearer the camera covers what is behind it whichever way the head is turned;
// - around it, a grid over the whole frame, displaced by a smooth field spread out
//   from the mesh's visible points, so that where the face's outline moves the
//   background follows it instead of leaving the old outline showing.
//
// Both use the same displacements, projected straight onto the picture: at the
// distance of a face from a camera, perspective changes them by a few percent at most.
//
// The mesh also carries each point's depth where it was. Turned away from the camera,
// part of the face is hidden in the picture (the far cheek behind the nose): what the
// picture shows there is whatever hid it. An edit that uncovers it (a narrower nose,
// a hump taken off) would otherwise show the old nose there again; the stage compares
// these depths with the face as the camera saw it and fills those places from the
// nearest skin the camera did see.
import {points3,headFrame,displacements} from './deform.js?v=6';
import {WARP_TRIANGLES} from './facemesh.js?v=6';

export const COLS=64, ROWS=48;           // the background grid
export const GRID=(COLS+1)*(ROWS+1);
export const MESH=468;                   // mesh points (the iris points are not in it)

// The spread of the background field, in face widths, and how much of a point's own
// move a background point keeps when no mesh point is near: none, past ~2.5 spreads.
const SPREAD=.06, FLOOR=.044;

export function createWarp(){
  const grid=new Float32Array(GRID*2);
  const pos=new Float32Array(MESH*3), uv=new Float32Array(MESH*2), src=new Float32Array(MESH);
  const facing=new Float32Array(MESH), normals=new Float32Array(MESH*3);
  let last=null;

  // How squarely each mesh point faces the camera: 1 facing it, falling to 0 edge-on
  // and behind. Normals are summed from the triangles around each point and turned
  // outwards, away from the middle of the head.
  function face(P,frame){
    normals.fill(0);
    for(let t=0;t<WARP_TRIANGLES.length;t+=3){
      const a=P[WARP_TRIANGLES[t]],b=P[WARP_TRIANGLES[t+1]],c=P[WARP_TRIANGLES[t+2]];
      const ux=b.x-a.x,uy=b.y-a.y,uz=b.z-a.z,vx=c.x-a.x,vy=c.y-a.y,vz=c.z-a.z;
      const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;
      for(let k=0;k<3;k++){const i=WARP_TRIANGLES[t+k]*3;normals[i]+=nx;normals[i+1]+=ny;normals[i+2]+=nz;}
    }
    let outward=0;
    for(let i=0;i<MESH;i++){
      const q=P[i];
      outward+=normals[i*3]*(q.x-frame.center.x)+normals[i*3+1]*(q.y-frame.center.y)+normals[i*3+2]*(q.z-frame.center.z);
    }
    const sign=outward<0?-1:1;
    for(let i=0;i<MESH;i++){
      const nx=normals[i*3],ny=normals[i*3+1],nz=normals[i*3+2],l=Math.hypot(nx,ny,nz)||1;
      // Towards the camera is −z. Anything more than ~15° from edge-on counts fully.
      facing[i]=Math.max(0,Math.min(1,-sign*nz/l/.25));
    }
  }

  // The background field at each grid point: the moves of the visible mesh points
  // near it, weighted by closeness and by how squarely each faces the camera.
  function background(P,d,frame,W,H){
    grid.fill(0);
    const sigma=frame.face*SPREAD,s2=2*sigma*sigma,cut2=(3*sigma)**2;
    const vis=[];
    let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
    for(let i=0;i<MESH;i++){
      if(!facing[i])continue;
      const q=P[i];vis.push(i);
      if(q.x<x0)x0=q.x;if(q.x>x1)x1=q.x;if(q.y<y0)y0=q.y;if(q.y>y1)y1=q.y;
    }
    if(!vis.length)return;
    const pad=3*sigma;
    const c0=Math.max(0,Math.floor((x0-pad)/W*COLS)),c1=Math.min(COLS,Math.ceil((x1+pad)/W*COLS));
    const r0=Math.max(0,Math.floor((y0-pad)/H*ROWS)),r1=Math.min(ROWS,Math.ceil((y1+pad)/H*ROWS));
    for(let r=r0;r<=r1;r++){
      const py=r/ROWS*H;
      for(let c=c0;c<=c1;c++){
        const px=c/COLS*W;
        let sw=FLOOR,sx=0,sy=0;
        for(const i of vis){
          const q=P[i],dx=px-q.x,dy=py-q.y,d2=dx*dx+dy*dy;
          if(d2>=cut2)continue;
          const w=facing[i]*Math.exp(-d2/s2);
          sw+=w;sx+=w*d[i*3];sy+=w*d[i*3+1];
        }
        const g=(r*(COLS+1)+c)*2;
        grid[g]=sx/sw;grid[g+1]=sy/sw;
      }
    }
  }

  // The mesh where it has moved to (clip space, with depth: nearer is smaller), where
  // its texture comes from (the frame, row 0 at the top), and its depth there, on the
  // same scale.
  function mesh(P,d,frame,W,H){
    const depth=z=>Math.max(-.99,Math.min(.99,(z-frame.center.z)/(frame.face*2)));
    for(let i=0;i<MESH;i++){
      const q=P[i];
      pos[i*3]=(q.x+d[i*3])/W*2-1;
      pos[i*3+1]=1-(q.y+d[i*3+1])/H*2;
      pos[i*3+2]=depth(q.z+d[i*3+2]);
      uv[i*2]=q.x/W;uv[i*2+1]=q.y/H;
      src[i]=depth(q.z);
    }
  }

  return {
    // The warp for these landmarks and amounts, or null when nothing moves. The
    // arrays are reused from frame to frame.
    compute(landmarks,W,H,amounts){
      last=null;
      if(!landmarks||landmarks.length<MESH)return null;
      const P=points3(landmarks,W,H),d=displacements(P,amounts);
      if(!d)return null;
      const frame=headFrame(P);
      face(P,frame);
      background(P,d,frame,W,H);
      mesh(P,d,frame,W,H);
      last={P,d,facing,frame};
      return {grid,mesh:{pos,uv,src,face:frame.face}};
    },
    // The landmarks, their moves and how squarely each faces the camera, from the
    // last compute(): for the debug overlay.
    get last(){return last;}
  };
}

// Developer overlay: every landmark the model returns, numbered, with the ones that
// are driving the current selection picked out — the nose anchors while rhinoplasty
// is applied, and so on. Optional layers show the tracking mesh, the named contours,
// the face-local axes every size is measured in, the displacement field of the
// procedures and the skin-treatment masks.

const PLAIN='#3FD0F0';   // a point nothing is currently using
const ACTIVE='#FFC53D';  // a point driving what is on screen right now
const MESH='rgba(63,208,240,0.28)';
const CONTOUR={oval:'#B39DFF',lips:'#FF7AA2',eyes:'#7CF2B5',brows:'#FFB86B',irises:'#FFFFFF'};
const FIELD='#FF5FD2';

function line(ctx,a,b){ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);}

export function renderDebug(context, landmarks, options={}) {
  const {labelSize=10, highlight=true, onlyActive=false, active=null, points=true,
    mesh=false, contours=false, topology=null, axes=false, field=null,
    masks=null, find=null}=options;
  const {width,height}=context.canvas;
  context.clearRect(0,0,width,height);
  if(!landmarks||!landmarks.length) return 0;
  const scale=Math.max(width,height)/640;
  const at=i=>({x:landmarks[i].x*width,y:landmarks[i].y*height});
  const lit=i=>highlight&&!!active&&active.has(i);
  // 468 labels at once are unreadable over the middle of a face, so the overlay can
  // be narrowed to whatever is in play.
  const shown=i=>!onlyActive||(!!active&&active.has(i));

  context.save();
  if(masks){context.globalAlpha=.55;context.drawImage(masks,0,0);context.globalAlpha=1;}

  if(mesh&&topology?.tesselation){
    context.beginPath();
    for(const [a,b] of topology.tesselation)if(a<landmarks.length&&b<landmarks.length)line(context,at(a),at(b));
    context.strokeStyle=MESH;context.lineWidth=.6*scale;context.stroke();
  }
  if(contours&&topology?.contours){
    context.lineWidth=1.4*scale;
    for(const [name,pairs] of Object.entries(topology.contours)){
      context.beginPath();
      for(const [a,b] of pairs)if(a<landmarks.length&&b<landmarks.length)line(context,at(a),at(b));
      context.strokeStyle=CONTOUR[name]||PLAIN;context.stroke();
    }
  }

  if(axes&&landmarks.length>454){
    const left=at(234),right=at(454),face=Math.hypot(right.x-left.x,right.y-left.y)||1;
    const ex={x:(right.x-left.x)/face,y:(right.y-left.y)/face},ey={x:-ex.y,y:ex.x};
    const o=at(1),len=face*.42;
    context.lineWidth=2*scale;
    context.beginPath();line(context,o,{x:o.x+ex.x*len,y:o.y+ex.y*len});context.strokeStyle='#FF6B6B';context.stroke();
    context.beginPath();line(context,o,{x:o.x+ey.x*len,y:o.y+ey.y*len});context.strokeStyle='#7CF2B5';context.stroke();
    context.setLineDash([4*scale,4*scale]);context.lineWidth=1*scale;
    context.beginPath();line(context,at(168),at(152));context.strokeStyle='rgba(255,255,255,.7)';context.stroke();
    context.beginPath();line(context,left,right);context.stroke();
    context.setLineDash([]);
  }

  if(field){
    // Every deformer's anchor and reach (its reach is in 3D, so this is where it is
    // centred, drawn as seen face-on), then each visible mesh point's move, ×3 so a
    // subtle edit is still legible.
    context.lineWidth=1*scale;context.strokeStyle='rgba(255,95,210,.45)';context.setLineDash([3*scale,3*scale]);
    for(const d of field.anchors){context.beginPath();context.arc(d.x,d.y,d.r,0,Math.PI*2);context.stroke();}
    context.setLineDash([]);
    context.strokeStyle=FIELD;context.lineWidth=1.2*scale;
    const a=field.arrows;
    for(let i=0;i<a.length;i+=4){
      const x=a[i],y=a[i+1],tx=x+a[i+2]*3,ty=y+a[i+3]*3,len=Math.hypot(a[i+2],a[i+3]);
      const ang=Math.atan2(a[i+3],a[i+2]),head=Math.min(4*scale,len*1.5);
      context.beginPath();context.moveTo(x,y);context.lineTo(tx,ty);
      context.moveTo(tx,ty);context.lineTo(tx-Math.cos(ang-.5)*head,ty-Math.sin(ang-.5)*head);
      context.moveTo(tx,ty);context.lineTo(tx-Math.cos(ang+.5)*head,ty-Math.sin(ang+.5)*head);
      context.stroke();
    }
  }

  if(points&&labelSize>0){
    const size=labelSize*scale;
    context.font=`${size}px ui-monospace,Consolas,monospace`;
    context.textBaseline='middle';
    context.lineJoin='round';
    context.lineWidth=Math.max(2,size*0.3);
    context.strokeStyle='rgba(6,4,6,0.9)';
    for(let i=0;i<landmarks.length;i++){
      if(!shown(i))continue;
      context.save();
      // The canvas is mirrored in CSS, so flip each glyph back to stay readable.
      context.translate(landmarks[i].x*width, landmarks[i].y*height);
      context.scale(-1,1);
      const label=String(i);
      context.strokeText(label, size*0.35, -size*0.45);
      context.fillStyle=lit(i)?ACTIVE:'#E8F7FC';
      context.fillText(label, size*0.35, -size*0.45);
      context.restore();
    }
  }

  // Dots last, over every label: where a landmark is matters more than its number,
  // and in dense places (the nose, the lips) neighbouring labels would hide it.
  let count=0;
  if(points){
    for(let i=0;i<landmarks.length;i++){
      if(!shown(i))continue;
      count++;
      const marked=lit(i);
      context.beginPath();
      context.arc(landmarks[i].x*width, landmarks[i].y*height, (marked?2.4:1.3)*scale, 0, Math.PI*2);
      context.fillStyle=marked?ACTIVE:PLAIN;
      context.globalAlpha=marked?1:0.65;
      context.fill();
    }
    context.globalAlpha=1;
  }

  if(find!==null&&find>=0&&find<landmarks.length){
    const q=at(find);
    context.lineWidth=2*scale;context.strokeStyle='#fff';
    context.beginPath();context.arc(q.x,q.y,9*scale,0,Math.PI*2);context.stroke();
    context.strokeStyle=ACTIVE;context.beginPath();context.arc(q.x,q.y,12*scale,0,Math.PI*2);context.stroke();
    context.beginPath();line(context,{x:q.x-18*scale,y:q.y},{x:q.x-13*scale,y:q.y});line(context,{x:q.x+13*scale,y:q.y},{x:q.x+18*scale,y:q.y});
    line(context,{x:q.x,y:q.y-18*scale},{x:q.x,y:q.y-13*scale});line(context,{x:q.x,y:q.y+13*scale},{x:q.x,y:q.y+18*scale});
    context.stroke();
  }
  context.restore();
  return count;
}

// The landmark nearest a point in frame pixels, for the inspector.
export function nearest(landmarks,width,height,x,y){
  let best=-1,bestD=Infinity;
  for(let i=0;i<landmarks.length;i++){
    const d=(landmarks[i].x*width-x)**2+(landmarks[i].y*height-y)**2;
    if(d<bestD){bestD=d;best=i;}
  }
  return {index:best,distance:Math.sqrt(bestD)};
}

// The visit report, drawn page by page on A4 canvases (150 dpi) for pdf.js: the
// clinic, the patient, what was looked at, each before/after pair cropped to the face
// with the measurements it changed, the doctor's note, and the statement the patient
// signs. Drawn rather than printed, so the PDF is the same on every machine.
//
// r: {clinic, doctor, date (Date), patient: {name, code, age, sex}, note,
//     plan: [{name, variant, strength, detail}],
//     shots: [{before, after (images), box: {x, y, w, h} (fractions), label, yaw,
//              measures: {before, after}}]}
import {metrics} from './measure.js?v=3';

export const PAGE={w:1240,h:1754};
const W=PAGE.w,H=PAGE.h,M=96,INNER=W-2*M,FOOT=70;
const C={ink:'#1E1418',muted:'#65545D',faint:'#978891',line:'#E4D9DE',soft:'#F7F2F4',accent:'#A8365A',up:'#2E7D4F',down:'#B23B3B'};
const FONT='Estedad, Tahoma, sans-serif';
const fa=new Intl.NumberFormat('fa-IR'),fa1=new Intl.NumberFormat('fa-IR',{minimumFractionDigits:1,maximumFractionDigits:1});
const fa2=new Intl.NumberFormat('fa-IR',{minimumFractionDigits:2,maximumFractionDigits:2});
const persian=new Intl.DateTimeFormat('fa-IR-u-ca-persian',{year:'numeric',month:'long',day:'numeric'});
const SEX={f:'زن',m:'مرد'};

export const STATEMENT='این تصاویر با نرم‌افزار ساخته شده‌اند و تغییر ظاهری احتمالی را فقط به‌طور تقریبی نشان می‌دهند. نتیجهٔ واقعی به عوامل بسیاری بستگی دارد، از جمله ساختار پوست، غضروف و استخوان، روند بهبود و روش درمان، و ممکن است با این تصاویر متفاوت باشد. این گزارش پیش‌بینی یا تضمین نتیجه نیست. تورم، کبودی و دورهٔ بهبودی در تصاویر دیده نمی‌شوند. عمق صورت از روی تصویر یک دوربین تخمین زده شده و اندازه‌ها برای مقایسهٔ پیش و پس‌اند، نه اندازهٔ دقیق.';
export const CONSENT='اینجانب توضیحات بالا را خواندم و فهمیدم که تصاویر شبیه‌سازی‌اند، و با گرفتن و نگه‌داشتن این تصاویر در پروندهٔ پزشکی‌ام در این مطب موافقم.';

const format=(m,v)=>m.unit==='×'?fa2.format(v):m.unit==='°'?fa1.format(v)+'°':fa1.format(v)+'٪';
// Each measurement this shot changed: name, before, after, and the change as the
// table on screen shows it.
export function changes(measures){
  if(!measures?.before||!measures?.after)return [];
  const out=[];
  for(const m of metrics){
    const a=measures.before[m.id]?.value,b=measures.after[m.id]?.value;
    if(a==null||b==null)continue;
    const change=m.abs?b-a:(b-a)/(Math.abs(a)||1)*100;
    if(Math.abs(change)<(m.abs?.3:.5))continue;
    const sign=change>0?'+':'−';
    out.push({name:m.name,before:format({...m,unit:measures.before[m.id].unit},a),after:format({...m,unit:measures.after[m.id].unit},b),
      change:m.abs?`${sign}${fa1.format(Math.abs(change))}${m.unit==='°'?'°':''}`:`${sign}${fa.format(Math.round(Math.abs(change)))}٪`,up:change>0});
  }
  return out;
}

export async function buildReport(r){
  await Promise.all(['400','600','800'].map(w=>document.fonts?.load?.(`${w} 24px Estedad`).catch(()=>{})));
  const pages=[];
  let ctx,y;
  const font=(size,weight=400)=>{ctx.font=`${weight} ${size}px ${FONT}`;};
  const write=(text,x,yy,{size=22,weight=400,color=C.ink,align='right'}={})=>{
    font(size,weight);ctx.fillStyle=color;ctx.textAlign=align;ctx.textBaseline='alphabetic';ctx.fillText(text,x,yy);
  };
  const rule=(yy,color=C.line,width=2)=>{ctx.fillStyle=color;ctx.fillRect(M,yy,INNER,width);};
  const round=(x,yy,w,h,rad,fill)=>{ctx.beginPath();ctx.roundRect(x,yy,w,h,rad);ctx.fillStyle=fill;ctx.fill();};

  function newPage(){
    const c=document.createElement('canvas');c.width=W;c.height=H;
    ctx=c.getContext('2d');ctx.direction='rtl';ctx.fillStyle='#fff';ctx.fillRect(0,0,W,H);
    pages.push(c);y=M;
    if(pages.length>1){
      // A slim running head on the pages after the first.
      write(r.clinic||'رُژا کلینیک',W-M,y+24,{size:22,weight:600});
      write(`${r.patient.name||r.patient.code||''} · ${persian.format(r.date)}`,M,y+24,{size:20,color:C.muted,align:'left'});
      y+=44;rule(y);y+=36;
    }
  }
  // Room for `h` more on this page, or a new one.
  const need=h=>{if(y+h>H-M-FOOT)newPage();};
  function lines(text,width,size,weight){
    font(size,weight);
    const out=[];
    for(const para of String(text).split('\n')){
      let line='';
      for(const word of para.split(/\s+/).filter(Boolean)){
        const next=line?line+' '+word:word;
        if(line&&ctx.measureText(next).width>width){out.push(line);line=word;}else line=next;
      }
      out.push(line);
    }
    return out;
  }
  function paragraph(text,{size=22,weight=400,color=C.ink,lh=1.75,width=INNER,x=W-M}={}){
    for(const line of lines(text,width,size,weight)){
      need(size*lh);
      write(line,x,y+size,{size,weight,color});
      y+=size*lh;
    }
  }
  function section(title){
    need(90);
    y+=18;
    ctx.fillStyle=C.accent;ctx.fillRect(W-M-6,y+4,6,30);
    write(title,W-M-20,y+30,{size:28,weight:800});
    y+=58;
  }

  /* ---- the first page: who, where, when ---- */
  newPage();
  write(r.clinic||'رُژا کلینیک',W-M,y+40,{size:40,weight:800});
  if(r.doctor)write(r.doctor,W-M,y+84,{size:24,color:C.muted});
  write('گزارش پیش‌نمایش عمل',M,y+36,{size:26,weight:800,color:C.accent,align:'left'});
  write(persian.format(r.date),M,y+78,{size:22,color:C.muted,align:'left'});
  y+=118;rule(y,C.ink,3);y+=34;

  const fields=[['نام',r.patient.name||'—'],['کد پرونده',r.patient.code||'—'],
    ['سن',r.patient.age?fa.format(r.patient.age):'—'],['جنس',SEX[r.patient.sex]||'—']];
  round(M,y,INNER,124,18,C.soft);
  const col=INNER/fields.length;
  fields.forEach(([k,v],i)=>{
    const x=W-M-28-i*col;
    write(k,x,y+46,{size:19,color:C.faint});
    write(v,x,y+92,{size:26,weight:600});
  });
  y+=124+16;

  /* ---- what was looked at ---- */
  if(r.plan.length){
    section('عمل‌های بررسی‌شده');
    for(const p of r.plan){
      need(86);
      const head=[p.name,p.variant,p.strength!=null?`میزان ${fa.format(Math.round(p.strength))}٪`:null].filter(Boolean).join(' · ');
      write(head,W-M,y+28,{size:25,weight:600});
      const ls=p.detail?lines(p.detail,INNER,19,400):[];
      ls.forEach((l,i)=>write(l,W-M,y+66+i*30,{size:19,color:C.muted}));
      y+=58+ls.length*30+12;
    }
  }

  /* ---- each pair, before and after ---- */
  const IW=(INNER-28)/2,IH=Math.round(IW*4/3);
  r.shots.forEach((s,k)=>{
    if(k===0)section('پیش و پس از عمل (شبیه‌سازی)');
    need(56+IH+20);
    const angle=Number.isFinite(s.yaw)&&Math.abs(s.yaw)>=8?` · سر ${fa.format(Math.round(Math.abs(s.yaw)))}° چرخیده`:'';
    write(`${fa.format(k+1)}. ${s.label||''}${angle}`,W-M,y+28,{size:21,weight:600,color:C.muted});
    y+=48;
    // Before on the right, where a right-to-left reader starts.
    [[s.before,'پیش',W-M-IW],[s.after,'پس · شبیه‌سازی',M]].forEach(([img,tag,x])=>{
      ctx.save();ctx.beginPath();ctx.roundRect(x,y,IW,IH,16);ctx.clip();
      ctx.fillStyle='#222';ctx.fillRect(x,y,IW,IH);
      if(img){
        const b=s.box||{x:0,y:0,w:1,h:1},iw=img.width,ih=img.height;
        ctx.drawImage(img,b.x*iw,b.y*ih,b.w*iw,b.h*ih,x,y,IW,IH);
      }
      ctx.restore();
      font(20,600);
      const tw=ctx.measureText(tag).width+32;
      round(x+IW-tw-14,y+IH-54,tw,40,20,'#140C11CC');
      write(tag,x+IW-30,y+IH-26,{size:20,weight:600,color:'#F6ECF1'});
    });
    y+=IH+22;
    const rows=changes(s.measures);
    if(rows.length){
      need(40+48+rows.length*44);
      write(`اندازه‌ها، عکس ${fa.format(k+1)}`,W-M,y+26,{size:20,weight:600,color:C.muted});
      y+=40;
      const cols=[INNER*.46,INNER*.18,INNER*.18,INNER*.18];
      const head=['اندازه','پیش','پس','تغییر'];
      const xs=[];let x=W-M;for(const w of cols){xs.push(x);x-=w;}
      round(M,y,INNER,44,10,C.soft);
      head.forEach((h,i)=>write(h,xs[i]-16,y+30,{size:19,color:C.faint}));
      y+=44;
      for(const row of rows){
        [row.name,row.before,row.after,row.change].forEach((t,i)=>write(t,xs[i]-16,y+30,
          {size:20,weight:i===3?600:400,color:i===3?(row.up?C.up:C.down):C.ink}));
        y+=44;rule(y-1,C.line,1);
      }
      write('سهم از پهنای صورت یا نسبت دو اندازه، روی مدل سه‌بعدی صورت.',W-M,y+30,{size:17,color:C.faint});
      y+=48;
    }
    y+=18;
  });

  /* ---- the doctor's note ---- */
  if(r.note?.trim()){
    section('یادداشت پزشک');
    paragraph(r.note.trim(),{size:22});
    y+=10;
  }

  /* ---- what the pictures are, and the patient's agreement ---- */
  section('توضیح مهم و رضایت');
  paragraph(STATEMENT,{size:20,color:C.muted});
  y+=10;
  paragraph(CONSENT,{size:21,weight:600});
  need(190);
  y+=56;
  const SW=(INNER-60)/2;
  [['نام و امضای بیمار',W-M],['نام و امضای پزشک',M+SW]].forEach(([label,x])=>{
    ctx.fillStyle=C.ink;ctx.fillRect(x-SW,y+70,SW,2);
    write(label,x,y+106,{size:19,color:C.muted});
  });
  write('تاریخ: ……………………',M,y+150,{size:19,color:C.muted,align:'left'});
  y+=170;

  /* ---- footers, now the count is known ---- */
  pages.forEach((c,i)=>{
    ctx=c.getContext('2d');
    rule(H-M+6,C.line,2);
    write('شبیه‌سازی تصویری، نه وعدهٔ نتیجه · رُژا کلینیک',W-M,H-M+44,{size:17,color:C.faint});
    write(`صفحهٔ ${fa.format(i+1)} از ${fa.format(pages.length)}`,M,H-M+44,{size:17,color:C.faint,align:'left'});
  });
  return pages;
}

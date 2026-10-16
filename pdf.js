// A PDF from pictures of its pages: each page one JPEG, filling an A4 page. That is
// all the report needs, and it keeps the PDF exactly what was drawn on screen,
// Persian text and photos included, with no PDF library and no fonts to embed.
//
// pages: [{jpeg: Uint8Array, width, height}] (pixels); returns a Blob.
const A4={w:595.28,h:841.89};                   // points

// A PDF text string: UTF-16BE with a byte-order mark, as hex.
function pdfText(s){
  let hex='FEFF';
  for(const ch of String(s)){
    const c=ch.codePointAt(0);
    if(c>0xFFFF){const v=c-0x10000;hex+=(0xD800+(v>>10)).toString(16).padStart(4,'0')+(0xDC00+(v&0x3FF)).toString(16).padStart(4,'0');}
    else hex+=c.toString(16).padStart(4,'0');
  }
  return `<${hex.toUpperCase()}>`;
}
const date=d=>`D:${d.getUTCFullYear()}${[d.getUTCMonth()+1,d.getUTCDate(),d.getUTCHours(),d.getUTCMinutes(),d.getUTCSeconds()].map(v=>String(v).padStart(2,'0')).join('')}Z`;

export function makePdf(pages,{title='',author='',created=new Date()}={}){
  const enc=new TextEncoder(),parts=[],offsets=[];
  let size=0;
  const push=x=>{const b=typeof x==='string'?enc.encode(x):x;parts.push(b);size+=b.length;};
  const obj=(n,body,stream)=>{
    offsets[n]=size;
    push(`${n} 0 obj\n${body}\n`);
    if(stream){push('stream\n');push(stream);push('\nendstream\n');}
    push('endobj\n');
  };
  push('%PDF-1.4\n');push(new Uint8Array([0x25,0xE2,0xE3,0xCF,0xD3,0x0A]));   // binary marker
  // 1 catalog, 2 page tree, 3 info; then per page: the page, its content, its picture.
  const first=4,kids=pages.map((_,i)=>`${first+i*3} 0 R`).join(' ');
  obj(1,'<< /Type /Catalog /Pages 2 0 R >>');
  obj(2,`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  obj(3,`<< /Title ${pdfText(title)} /Author ${pdfText(author)} /Producer ${pdfText('Roja Clinic')} /CreationDate (${date(created)}) >>`);
  pages.forEach((p,i)=>{
    const n=first+i*3,content=enc.encode(`q ${A4.w} 0 0 ${A4.h} 0 0 cm /P Do Q`);
    obj(n,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.w} ${A4.h}] /Resources << /XObject << /P ${n+2} 0 R >> >> /Contents ${n+1} 0 R >>`);
    obj(n+1,`<< /Length ${content.length} >>`,content);
    obj(n+2,`<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>`,p.jpeg);
  });
  const count=first+pages.length*3;
  const xref=size;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for(let n=1;n<count;n++)push(`${String(offsets[n]).padStart(10,'0')} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts,{type:'application/pdf'});
}

// A canvas as a JPEG page.
export async function jpegPage(canvas,quality=.88){
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));
  if(!blob)throw new Error('the page could not be encoded');
  return {jpeg:new Uint8Array(await blob.arrayBuffer()),width:canvas.width,height:canvas.height};
}

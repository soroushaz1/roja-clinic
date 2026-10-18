// The patient record on screen: choosing or adding a patient, the visit's snapshots,
// the doctor's note, the report, and backups. While a patient is open, every
// snapshot goes into their record for today's visit (app.js hands it over through
// addShot). The record itself is store.js; the report, report.js and pdf.js.
import * as store from './store.js?v=5';
import {buildReport} from './report.js?v=5';
import {makePdf,jpegPage} from './pdf.js?v=5';
import {byId,resolve,kinds} from './procedures.js?v=5';
import {controls} from './deform.js?v=5';

const SETTINGS='clinic-settings', OPEN='clinic-patient';
const SEX={f:'زن',m:'مرد'};
const persian=new Intl.DateTimeFormat('fa-IR-u-ca-persian',{year:'numeric',month:'long',day:'numeric'});
const clock=new Intl.DateTimeFormat('fa-IR',{hour:'2-digit',minute:'2-digit'});
const dateOf=s=>{const [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d,12);};

export function createRecords({$,el,toast,fa,icon,saveBlob}){
  let patient=null;            // the open patient
  let visit=null;              // the visit shown in the record ('' = today's, not yet started)
  let urls=[];                 // thumbnail addresses to let go of

  const settings=()=>{try{return JSON.parse(localStorage.getItem(SETTINGS))||{};}catch{return {};}};
  const saveSettings=s=>{try{localStorage.setItem(SETTINGS,JSON.stringify({...settings(),...s}));}catch{}};

  function paintChip(){
    $('patient-name').textContent=patient?(patient.name||patient.code):'بیمار';
    $('patient-open').setAttribute('aria-pressed',String(!!patient));
    $('patient-open').title=patient?'پروندهٔ بیمار':'انتخاب یا افزودن بیمار';
  }
  async function setPatient(p){
    patient=p;visit=null;
    try{if(p)sessionStorage.setItem(OPEN,p.id);else sessionStorage.removeItem(OPEN);}catch{}
    paintChip();
  }

  /* ---- the patient list ---- */
  async function renderList(){
    const q=$('patient-search').value.trim();
    const all=await store.patients();
    const list=all.filter(p=>!q||(p.name||'').includes(q)||(p.code||'').includes(q));
    $('patient-list').replaceChildren(...(list.length?await Promise.all(list.map(async p=>{
      const [visits,count]=await Promise.all([store.sessionsOf(p.id),store.shotCount(p.id)]);
      const last=visits[0]?persian.format(dateOf(visits[0].date)):'بدون جلسه';
      return el('button',{class:'patient-row',type:'button','aria-current':String(p.id===patient?.id),data:{patient:p.id},
        onclick:async()=>{await setPatient(p);$('patients').close();openRecord();}},
        el('strong',{text:p.name||p.code}),
        el('small',{text:[p.code&&p.name?p.code:null,p.age?`${fa.format(p.age)} ساله`:null,SEX[p.sex]].filter(Boolean).join(' · ')}),
        el('small',{class:'patient-last',text:`${last} · ${fa.format(count)} عکس`}));
    })):[el('p',{class:'empty',text:all.length?'بیماری با این نام یا کد نیست.':'هنوز بیماری ثبت نشده. «بیمار تازه» را بزن.'})]));
  }
  function openList(){
    $('patient-form').hidden=true;$('patient-search').value='';
    const s=settings();$('clinic-name').value=s.clinic||'';$('doctor-name').value=s.doctor||'';
    renderList();
    if(!$('patients').open)$('patients').showModal();
  }
  // The form adds a patient, or edits the open one.
  let editing=null;
  function openForm(p=null){
    editing=p;
    $('patient-form').hidden=false;
    $('pf-name').value=p?.name||'';$('pf-code').value=p?.code||'';$('pf-age').value=p?.age??'';
    $('pf-sex').value=p?.sex||'';$('pf-notes').value=p?.notes||'';
    $('pf-title').textContent=p?'ویرایش بیمار':'بیمار تازه';
    $('pf-name').focus();
  }
  async function submitForm(e){
    e.preventDefault();
    const name=$('pf-name').value.trim().slice(0,60),code=$('pf-code').value.trim().slice(0,30);
    if(!name&&!code){toast('نام یا کد پرونده را بنویس.');return;}
    const age=Number($('pf-age').value);
    const p=await store.savePatient({...(editing||{}),name,code,age:Number.isFinite(age)&&age>0&&age<130?Math.round(age):null,
      sex:$('pf-sex').value,notes:$('pf-notes').value.trim().slice(0,500)});
    store.keep();
    await setPatient(p);
    $('patient-form').hidden=true;
    if(editing){openRecord();}
    else{$('patients').close();openRecord();toast(`پروندهٔ «${p.name||p.code}» باز شد. عکس‌هایی که می‌گیری در آن ذخیره می‌شوند.`);}
    editing=null;
  }

  /* ---- the record ---- */
  async function openRecord(){
    if(!patient){openList();return;}
    $('patient-form').hidden=true;
    const visits=await store.sessionsOf(patient.id);
    const now=store.today(),todays=visits.find(v=>v.date===now);
    // Today's visit unless another was picked; '' until today's has started.
    if(!visit||!visits.some(v=>v.id===visit))visit=todays?.id||'';
    $('record-title').textContent=patient.name||patient.code;
    $('record-meta').textContent=[patient.name&&patient.code?`کد ${patient.code}`:null,patient.age?`${fa.format(patient.age)} ساله`:null,SEX[patient.sex],patient.notes].filter(Boolean).join(' · ');
    $('record-visit').replaceChildren(
      ...(todays?[]:[el('option',{value:'',text:`امروز، ${persian.format(new Date())} (جلسهٔ تازه)`})]),
      ...visits.map(v=>el('option',{value:v.id,text:persian.format(dateOf(v.date))+(v.date===now?' (امروز)':'')})));
    $('record-visit').value=visit;
    await renderVisit();
    if(!$('record').open)$('record').showModal();
  }
  async function renderVisit(){
    for(const u of urls)URL.revokeObjectURL(u);urls=[];
    const session=visit?(await store.sessionsOf(patient.id)).find(v=>v.id===visit):null;
    $('record-note').value=session?.note||'';
    const shots=session?await store.shotsOf(session.id):[];
    $('record-shots').replaceChildren(...(shots.length?shots.map(s=>{
      const url=URL.createObjectURL(s.after);urls.push(url);
      const pick=el('input',{type:'checkbox'});pick.checked=s.include!==false;
      pick.onchange=()=>store.updateShot(s.id,{include:pick.checked}).then(paintPdf);
      return el('figure',{class:'shot',style:{margin:0},data:{shot:s.id}},
        // Cropped to the face, as the report will be.
        el('img',{src:url,alt:s.label||'',style:s.box?{objectPosition:`${((s.box.x+s.box.w/2)*100).toFixed(1)}% ${((s.box.y+s.box.h/2)*100).toFixed(1)}%`}:{}}),
        el('label',{},pick,'در گزارش'),
        el('div',{class:'shot-bar'},el('span',{text:`${clock.format(new Date(s.time))} · ${s.label||''}`,title:s.label||''}),
          el('button',{type:'button','aria-label':'حذف عکس',title:'حذف',onclick:async()=>{
            if(!confirm('این عکس از پرونده حذف شود؟'))return;
            await store.deleteShot(s.id);renderVisit();}},icon('i-trash'))));
    }):[el('p',{class:'empty',text:'در این جلسه هنوز عکسی گرفته نشده. روی تصویر «عکس» را بزن تا پیش و پس اینجا ذخیره شود.'})]));
    $('record-shots').dataset.count=String(shots.length);
    paintPdf();
  }
  async function paintPdf(){
    const shots=visit?(await store.shotsOf(visit)).filter(s=>s.include!==false):[];
    $('record-pdf').disabled=!shots.length;
  }
  // Waits for a note still being typed to be saved, so a report never misses it.
  async function flushNote(){
    if(!noteTimer)return;
    clearTimeout(noteTimer);noteTimer=0;
    const note=$('record-note').value.slice(0,2000);
    const session=visit?(await store.sessionsOf(patient.id)).find(v=>v.id===visit):null;
    if(session)await store.saveSession({...session,note});
  }
  // Today's visit, started the first time something is saved to it.
  async function todaysVisit(){
    const now=store.today();
    const found=(await store.sessionsOf(patient.id)).find(v=>v.date===now);
    return found||store.saveSession({patientId:patient.id,date:now});
  }
  let noteTimer=0;
  function noteChanged(){
    clearTimeout(noteTimer);
    noteTimer=setTimeout(async()=>{
      noteTimer=0;
      const note=$('record-note').value.slice(0,2000);
      let session=visit?(await store.sessionsOf(patient.id)).find(v=>v.id===visit):null;
      if(!session){if(!note.trim())return;session=await todaysVisit();visit=session.id;}
      await store.saveSession({...session,note});
      // A visit that has just started is now in the list.
      if(!$('record-visit').querySelector(`option[value="${visit}"]`))openRecord();
    },400);
  }

  /* ---- the report ---- */
  // What was looked at in the shots going into the report: each procedure at its
  // last strength and method, and any hand-set regions.
  function planOf(shots){
    const seen=new Map(),manual=new Set();
    for(const s of shots){
      for(const [id,strength] of s.plan?.active||[])if(strength>0)seen.set(id,{strength,variant:s.plan.variants?.[id]});
      for(const id of Object.keys(s.plan?.overrides||{}))manual.add(id);
    }
    const out=[...seen].map(([id,{strength,variant}])=>{
      const p=byId(id);if(!p)return null;
      const {kind,variant:v}=resolve(p,variant);
      return {name:p.name,variant:v?.name,strength,detail:[kinds[kind],`ماندگاری: ${p.lasts}`,`نقاهت: ${p.recovery}`].join(' · ')};
    }).filter(Boolean);
    if(manual.size)out.push({name:'تنظیم دستی ناحیه‌ها',detail:[...manual].map(id=>controls.find(c=>c.id===id)?.name).filter(Boolean).join('، ')});
    return out;
  }
  async function downloadPdf(){
    if(!visit)return;
    const button=$('record-pdf');button.disabled=true;
    const label=button.textContent;button.textContent='در حال ساختن گزارش…';
    try{
      await flushNote();
      const session=(await store.sessionsOf(patient.id)).find(v=>v.id===visit);
      const shots=(await store.shotsOf(visit)).filter(s=>s.include!==false);
      if(!shots.length){toast('عکسی برای گزارش انتخاب نشده.');return;}
      const images=await Promise.all(shots.map(async s=>({...s,before:await createImageBitmap(s.before),after:await createImageBitmap(s.after)})));
      const s=settings(),date=dateOf(session.date);
      const pages=await buildReport({clinic:s.clinic,doctor:s.doctor,date,patient,note:session.note,plan:planOf(shots),shots:images});
      const blob=makePdf(await Promise.all(pages.map(p=>jpegPage(p))),
        {title:`گزارش ${patient.name||patient.code} · ${persian.format(date)}`,author:s.doctor||s.clinic||''});
      images.forEach(i=>{i.before.close?.();i.after.close?.();});
      // Latin letters only in the file name: some systems refuse others, or rename the
      // file "download". The PDF's own title is in Persian.
      const code=String(patient.code||'').replace(/[^A-Za-z0-9-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,30);
      saveBlob(blob,`report-${code||'patient'}-${session.date}.pdf`);
      toast('گزارش ساخته شد.');
    }catch(e){toast('گزارش ساخته نشد: '+(e?.message||e));}
    finally{button.textContent=label;paintPdf();}
  }

  /* ---- backups ---- */
  async function saveBackup(){
    const data=await store.backup();
    saveBlob(new Blob([JSON.stringify(data)],{type:'application/json'}),`roja-clinic-backup-${store.today()}.json`);
    toast(`پشتیبان ${fa.format(data.patients.length)} بیمار و ${fa.format(data.shots.length)} عکس ذخیره شد. این فایل عکس بیماران را دارد؛ آن را امن نگه دار.`);
  }
  async function loadBackup(file){
    if(!file)return;
    try{
      const got=await store.restore(JSON.parse(await file.text()));
      toast(`${fa.format(got.patients)} بیمار و ${fa.format(got.shots)} عکس برگشت.`);
      renderList();
    }catch(e){toast('این فایل پشتیبان رُژا کلینیک نیست یا خوانده نشد.');}
  }

  /* ---- wiring ---- */
  $('patient-open').onclick=()=>patient?openRecord():openList();
  $('patients-close').onclick=()=>$('patients').close();
  $('record-close').onclick=()=>$('record').close();
  $('patient-new').onclick=()=>openForm(null);
  $('pf-cancel').onclick=()=>{$('patient-form').hidden=true;editing=null;if(!$('patients').open)openRecord();};
  $('patient-form').onsubmit=submitForm;
  $('patient-search').oninput=renderList;
  $('clinic-name').oninput=()=>saveSettings({clinic:$('clinic-name').value.trim().slice(0,60)});
  $('doctor-name').oninput=()=>saveSettings({doctor:$('doctor-name').value.trim().slice(0,60)});
  $('backup-save').onclick=saveBackup;
  $('backup-load').onchange=()=>{const f=$('backup-load').files[0];$('backup-load').value='';loadBackup(f);};
  $('record-visit').onchange=()=>{visit=$('record-visit').value;renderVisit();};
  $('record-note').oninput=noteChanged;
  $('record-pdf').onclick=downloadPdf;
  $('record-edit').onclick=()=>{$('record').close();$('patients').showModal();openForm(patient);renderList();};
  $('record-switch').onclick=()=>{$('record').close();openList();};
  $('record-end').onclick=async()=>{await setPatient(null);$('record').close();toast('پرونده بسته شد. عکس‌ها دیگر در پرونده‌ای ذخیره نمی‌شوند.');};
  $('record-delete').onclick=async()=>{
    if(!confirm(`پروندهٔ «${patient.name||patient.code}» با همهٔ جلسه‌ها و عکس‌هایش برای همیشه از این دستگاه حذف شود؟`))return;
    await store.deletePatient(patient.id);await setPatient(null);$('record').close();toast('پرونده حذف شد.');
  };
  for(const d of [$('patients'),$('record')])d.addEventListener('click',e=>{if(e.target===d)d.close();});

  // A reload keeps the open patient (for this tab only).
  (async()=>{
    let id=null;try{id=sessionStorage.getItem(OPEN);}catch{}
    if(id){const p=(await store.patients()).find(x=>x.id===id);if(p)await setPatient(p);}
    paintChip();
  })().catch(()=>paintChip());

  return {
    get patient(){return patient;},
    // A snapshot into today's visit: {before, after (Blobs), label, plan, measures, box, yaw}.
    async addShot(shot){
      if(!patient)return null;
      const session=await todaysVisit();
      const saved=await store.saveShot({...shot,sessionId:session.id,patientId:patient.id});
      if(!visit)visit=session.id;
      if($('record').open&&visit===session.id)openRecord();
      return saved;
    }
  };
}

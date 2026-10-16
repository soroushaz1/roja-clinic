// The patient record, kept on this device only, in the browser's IndexedDB. Nothing
// here is sent anywhere: clearing the site's data in the browser, or deleting a
// patient, removes it, and a backup is a file the doctor saves and keeps.
//
//   patients  {id, name, code, age, sex ('f' | 'm' | ''), notes, created, updated}
//   sessions  {id, patientId, date ('YYYY-MM-DD', local), note, created, updated}
//   shots     {id, sessionId, patientId, time, label, plan, measures, box, yaw,
//              include, before (Blob), after (Blob)}
//
// A session is one visit. A shot is one snapshot taken during it: the picture before
// and after (both as seen on screen, mirrored), what was applied (`plan`), the
// measurements before and after, and where the face is in the picture (`box`, as
// fractions), for the report to crop to.
const NAME='roja-clinic', VERSION=1;
let opening=null;

function open(){
  return opening||=new Promise((resolve,reject)=>{
    const r=indexedDB.open(NAME,VERSION);
    r.onupgradeneeded=()=>{
      const db=r.result;
      db.createObjectStore('patients',{keyPath:'id'});
      db.createObjectStore('sessions',{keyPath:'id'}).createIndex('patient','patientId');
      const shots=db.createObjectStore('shots',{keyPath:'id'});
      shots.createIndex('session','sessionId');shots.createIndex('patient','patientId');
    };
    r.onsuccess=()=>resolve(r.result);
    r.onerror=()=>{opening=null;reject(r.error);};
  });
}
const done=r=>new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
// One transaction over `stores`; `work` gets the stores by name and issues its
// requests at once. Resolves with what `work` returned once everything is written.
async function run(stores,mode,work){
  const db=await open();
  return new Promise((resolve,reject)=>{
    const t=db.transaction(stores,mode),by=Object.fromEntries(stores.map(s=>[s,t.objectStore(s)]));
    let out;
    Promise.resolve(work(by)).then(v=>{out=v;},e=>{try{t.abort();}catch{}reject(e);});
    t.oncomplete=()=>resolve(out);
    t.onerror=t.onabort=()=>reject(t.error||new Error('the record could not be written'));
  });
}

export const newId=()=>globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+Math.random().toString(36).slice(2,10);
// Today on this device's calendar, as the sessions store it.
export function today(d=new Date()){
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// Ask the browser not to clear the record when the disk runs low.
export function keep(){try{return navigator.storage?.persist?.()||Promise.resolve(false);}catch{return Promise.resolve(false);}}

export const patients=()=>run(['patients'],'readonly',({patients})=>done(patients.getAll()))
  .then(list=>list.sort((a,b)=>b.updated-a.updated));
export function savePatient(p){
  const now=Date.now(),record={sex:'',notes:'',code:'',age:null,...p,id:p.id||newId(),created:p.created||now,updated:now};
  return run(['patients'],'readwrite',({patients})=>{patients.put(record);return record;});
}
// A patient and everything recorded about them.
export function deletePatient(id){
  return run(['patients','sessions','shots'],'readwrite',async({patients,sessions,shots})=>{
    patients.delete(id);
    const [ss,hs]=await Promise.all([done(sessions.index('patient').getAllKeys(id)),done(shots.index('patient').getAllKeys(id))]);
    for(const k of ss)sessions.delete(k);
    for(const k of hs)shots.delete(k);
  });
}

export const sessionsOf=patientId=>run(['sessions'],'readonly',({sessions})=>done(sessions.index('patient').getAll(patientId)))
  .then(list=>list.sort((a,b)=>b.date.localeCompare(a.date)||b.created-a.created));
export function saveSession(s){
  const now=Date.now(),record={note:'',...s,id:s.id||newId(),date:s.date||today(),created:s.created||now,updated:now};
  return run(['sessions','patients'],'readwrite',async({sessions,patients})=>{
    sessions.put(record);
    // The patient moves to the top of the list.
    const p=await done(patients.get(record.patientId));
    if(p)patients.put({...p,updated:now});
    return record;
  });
}

export const shotsOf=sessionId=>run(['shots'],'readonly',({shots})=>done(shots.index('session').getAll(sessionId)))
  .then(list=>list.sort((a,b)=>a.time-b.time));
export const shotCount=patientId=>run(['shots'],'readonly',({shots})=>done(shots.index('patient').count(patientId)));
export function saveShot(s){
  const record={include:true,...s,id:s.id||newId(),time:s.time||Date.now()};
  return run(['shots'],'readwrite',({shots})=>{shots.put(record);return record;});
}
export function updateShot(id,changes){
  return run(['shots'],'readwrite',async({shots})=>{
    const s=await done(shots.get(id));
    if(s)shots.put({...s,...changes});
  });
}
export const deleteShot=id=>run(['shots'],'readwrite',({shots})=>{shots.delete(id);});

/* ---- backup ------------------------------------------------------------- */
const toData=blob=>new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.readAsDataURL(blob);});
const fromData=url=>fetch(url).then(r=>r.blob());

// Everything, pictures included, as one JSON-ready object.
export async function backup(){
  const [ps,ss,hs]=await run(['patients','sessions','shots'],'readonly',({patients,sessions,shots})=>
    Promise.all([done(patients.getAll()),done(sessions.getAll()),done(shots.getAll())]));
  const shots=[];
  for(const s of hs)shots.push({...s,before:s.before?await toData(s.before):null,after:s.after?await toData(s.after):null});
  return {app:'roja-clinic',kind:'backup',version:1,time:new Date().toISOString(),patients:ps,sessions:ss,shots};
}
// A backup back into the record: anything with the same id is replaced, the rest kept.
// Returns how many patients, sessions and shots it held.
export async function restore(data){
  if(data?.app!=='roja-clinic'||data?.kind!=='backup'||!Array.isArray(data.patients))throw new Error('not a Roja Clinic backup');
  const shots=[];
  for(const s of data.shots||[])shots.push({...s,before:s.before?await fromData(s.before):null,after:s.after?await fromData(s.after):null});
  await run(['patients','sessions','shots'],'readwrite',({patients,sessions,shots:store})=>{
    for(const p of data.patients)patients.put(p);
    for(const s of data.sessions||[])sessions.put(s);
    for(const s of shots)store.put(s);
  });
  return {patients:data.patients.length,sessions:(data.sessions||[]).length,shots:shots.length};
}

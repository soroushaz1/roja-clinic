const http=require('http'),fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..');   // the site lives at the repo root
http.createServer((req,res)=>{
  let name;try{name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{res.writeHead(400).end();return;}
  // A folder serves its index.html.
  const file=path.resolve(root,'.'+(name.endsWith('/')?name+'index.html':name));
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  const mime={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.svg':'image/svg+xml','.jpeg':'image/jpeg','.jpg':'image/jpeg','.woff2':'font/woff2','.png':'image/png','.txt':'text/plain; charset=utf-8','.webmanifest':'application/manifest+json','.json':'application/json','.xml':'application/xml','.task':'application/octet-stream'};
  fs.readFile(file,(e,data)=>{if(e){res.writeHead(404).end();return;}res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});res.end(data);});
}).on('error',e=>{
  // The usual reason: it is already running, in another window.
  if(e.code==='EADDRINUSE')console.error(`Port ${e.port} is already in use. Roja Clinic may already be running at http://127.0.0.1:${e.port}/ (or start it on another port: PORT=8080).`);
  else console.error(e.message);
  process.exit(1);
}).listen(Number(process.env.PORT)||4174,'127.0.0.1',function(){console.log('http://127.0.0.1:'+this.address().port);});

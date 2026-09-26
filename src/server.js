import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { createApp } from './app.js';
import { hash } from './store.js';
import { weekly } from './weekly.js';
const env=process.env,root=process.cwd();
if(!env.ADMIN_TOKEN||env.ADMIN_TOKEN.length<32||!env.INGRESS_TOKEN||env.INGRESS_TOKEN.length<32||env.ADMIN_TOKEN===env.INGRESS_TOKEN)throw new Error('Set distinct ADMIN_TOKEN and INGRESS_TOKEN (32+ characters) in .env');
const app=createApp(root,env);
const same=(a,b)=>{const x=Buffer.from(a||''),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
let queue=Promise.resolve();
const server=createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');
  const send=(code,value,type='application/json')=>{res.writeHead(code,{'Content-Type':type});res.end(type==='application/json'?JSON.stringify(value):value);};
  try{
    // Exact loopback host check blocks DNS rebinding; no CORS is enabled.
    if(!['127.0.0.1','localhost'].some(h=>req.headers.host===`${h}:${env.PORT||8787}`))return send(403,{error:'Invalid host'});
    const path=new URL(req.url,'http://localhost').pathname;
    if(req.method==='GET'&&path==='/')return send(200,readFileSync(resolve(root,'web/index.html')),'text/html; charset=utf-8');
    if(req.method==='GET'&&path==='/health')return send(200,{ok:true,mode:env.LIVE_SEND==='true'?'live':'dry-run'});
    const token=(req.headers.authorization||'').replace(/^Bearer /,'');
    if(!same(token,path==='/api/inbound'?env.INGRESS_TOKEN:env.ADMIN_TOKEN))return send(401,{error:'Unauthorized'});
    if(req.method==='GET'&&path==='/api/state')return send(200,{mode:env.LIVE_SEND==='true'?'live':'dry-run',submissions:app.store.list('submission').map(s=>({...s,reviewHash:hash(s)})),publications:app.store.list('publication').map(p=>({...p,reviewHash:app.publications.digest(p)})),deliveries:app.store.db.prepare('SELECT * FROM deliveries').all(),targets:app.memory.documents().map(d=>({path:d.path,text:d.text}))});
    const download=path.match(/^\/api\/artifacts\/([a-f0-9-]{36})\/(pdf|html)$/);
    if(req.method==='GET'&&download){const p=app.store.get(download[1]);if(p.type!=='publication')throw new Error('Invalid artifact');return send(200,readFileSync(app.publications.artifacts(p)[download[2]]),download[2]==='pdf'?'application/pdf':'text/html; charset=utf-8');}
    if(req.method!=='POST')return send(404,{error:'Not found'});
    if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'JSON required'});
    let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>100000){send(413,{error:'Request too large'});return;}}
    const body=JSON.parse(raw||'{}');
    const run=async()=>{
      if(path==='/api/inbound')return app.agent.receive(body);
      if(path==='/api/submissions')return app.memory.propose(body);
      if(path==='/api/submissions/decide')return app.memory.decide(body.id,body.decision,body.reviewHash);
      if(path==='/api/weekly/demo'){if(env.LIVE_SEND==='true')throw new Error('Demo disabled in live mode');return weekly(app,env,1,JSON.parse(readFileSync(resolve(root,'fixtures/week.json'))));}
      if(path==='/api/weekly')return weekly(app,env,body.week);
      if(path==='/api/publications/revise')return app.publications.revise(body.id,body);
      if(path==='/api/publications/decide')return app.publications.decide(body.id,body.decision,body.reviewHash);
      if(path==='/api/publications/publish')return app.publications.publish(body.id);
      if(path==='/api/deliveries/reconcile')return app.publications.reconcile(body.key,body.action,body.receipt)||{ok:true};
      throw new Error('Unknown route');
    };
    const current=queue.then(run);queue=current.catch(()=>{});send(200,await current);
  }catch(e){send(400,{error:e.message});}
});
server.requestTimeout=60000;server.headersTimeout=10000;
server.listen(Number(env.PORT||8787),'127.0.0.1',()=>console.log(`ChatPDT review: http://127.0.0.1:${env.PORT||8787} (${env.LIVE_SEND==='true'?'LIVE':'dry-run'})`));
if(env.LIVE_SEND==='true'&&env.WHATSAPP_ENABLED==='true')app.whatsapp.start().catch(()=>console.error('WhatsApp startup failed; publishing unavailable until connected'));
process.on('SIGINT',()=>server.close(()=>{app.store.close();process.exit(0);}));




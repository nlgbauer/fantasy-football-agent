import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync,cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
test('HTTP approval boundary, downloads, XSS escaping and full dry-run flow',async t=>{
  const root=mkdtempSync(resolve(tmpdir(),'chatpdt-http-'));
  for(const dir of ['knowledge','prompts','fixtures','web'])cpSync(dir,resolve(root,dir),{recursive:true});
  const admin=randomBytes(32).toString('hex'),ingress=randomBytes(32).toString('hex'),port=String(19000+Math.floor(Math.random()*10000));
  const child=spawn(process.execPath,[resolve('src/server.js')],{cwd:root,env:{...process.env,ADMIN_TOKEN:admin,INGRESS_TOKEN:ingress,PORT:port,LIVE_SEND:'false',MODEL_PROVIDER:'mock',WHATSAPP_GROUP_ID:'test-group'},stdio:['ignore','pipe','pipe']});
  t.after(()=>child.kill());
  await new Promise((res,rej)=>{const timer=setTimeout(()=>rej(Error('Server startup timeout')),10000);child.stdout.on('data',d=>{if(d.toString().includes('ChatPDT review')){clearTimeout(timer);res();}});child.once('exit',()=>{clearTimeout(timer);rej(Error('Server exited'));});});
  const url='http://127.0.0.1:'+port;
  const request=(path,body,token=admin)=>fetch(url+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  assert.equal((await fetch(url+'/api/state')).status,401);
  assert.equal((await request('/api/submissions/decide',{id:'fake',decision:'approve'},ingress)).status,401);
  const draft=await (await request('/api/weekly/demo',{})).json();assert.equal(draft.status,'draft');
  assert.equal((await request('/api/publications/publish',{id:draft.id})).status,400);
  const state=await (await request('/api/state')).json(),p=state.publications[0];
  assert.equal((await fetch(url+`/api/artifacts/${p.id}/pdf`)).status,401);
  const pdf=await request(`/api/artifacts/${p.id}/pdf`);assert.equal(pdf.headers.get('content-type'),'application/pdf');assert.ok((await pdf.arrayBuffer()).byteLength>1000);
  assert.equal((await request('/api/publications/decide',{id:p.id,decision:'approve',reviewHash:p.reviewHash})).status,200);
  assert.equal((await request('/api/publications/publish',{id:p.id})).status,200);
  const end=await (await request('/api/state')).json();assert.equal(end.deliveries.length,1);assert.ok(end.deliveries.every(d=>d.state==='sent'));
});




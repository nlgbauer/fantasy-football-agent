import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync,mkdtempSync,cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { GmailChannel } from '../src/adapters/channels.js';
import { createApp } from '../src/app.js';
test('Gmail adapter refreshes OAuth and sends MIME with HTML, PDF and approved recipients',async t=>{
  const root=mkdtempSync(resolve(tmpdir(),'chatpdt-mail-')),path=resolve(root,'report.pdf'),logo=resolve(root,'team.png');writeFileSync(path,'%PDF-test');writeFileSync(logo,'image-test');
  const calls=[];t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify(calls.length===1?{access_token:'mock-token'}:{id:'gmail-receipt'}),{status:200});});
  const adapter=new GmailChannel({GOOGLE_CLIENT_ID:'id',GOOGLE_CLIENT_SECRET:'secret',GOOGLE_REFRESH_TOKEN:'refresh'});
  const out=await adapter.send({week:1,title:'Week 1',text:'Plain recap',html:'<p>HTML recap</p>',destinations:{from:'sender@example.invalid',email:'league@example.invalid'}},{pdf:path,inline:[{file:'team.png',path:logo,cid:'chatpdt-team-1'}]},'test-delivery');
  assert.equal(out.id,'gmail-receipt');assert.equal(calls.length,2);const mime=Buffer.from(JSON.parse(calls[1].options.body).raw,'base64url').toString();assert.match(mime,/To: league@example.invalid/);assert.match(mime,/text\/html/);assert.match(mime,/application\/pdf/);assert.match(mime,/Content-ID: <chatpdt-team-1>/i);assert.match(mime,/Message-ID: <test-delivery@chatpdt.local>/i);
});
test('OpenAI adapter uses tool-free Responses, sends provenance context and rejects incomplete results',async t=>{
  const root=mkdtempSync(resolve(tmpdir(),'chatpdt-model-'));for(const dir of ['knowledge','prompts'])cpSync(dir,resolve(root,dir),{recursive:true});
  const a=createApp(root,{MODEL_PROVIDER:'openai',OPENAI_API_KEY:'test-key',OPENAI_MODEL:'test-model'});t.after(()=>a.store.close());let complete=true,calls=0;
  t.mock.method(globalThis,'fetch',async(url,options)=>{calls++;assert.equal(url,'https://api.openai.com/v1/responses');const body=JSON.parse(options.body);assert.equal(body.store,false);assert.equal(body.tools,undefined);assert.match(body.input,/editorial\/boundaries/);if(calls===2){assert.match(body.input,/editorial\/persona/);assert.match(body.input,/editorial\/jokes_by_week/);assert.match(body.input,/editorial\/old_email_context/);assert.match(body.input,/members\/member-01/);assert.match(body.input,/creighton\/overview/);assert.match(body.input,/league\/team_history/);}return new Response(JSON.stringify({status:complete?'completed':'incomplete',output:[{content:[{type:'output_text',text:'Sourced test response'}]}]}));});
  const result=await a.agent.generate('chat','hello');assert.equal(result.text,'Sourced test response');assert.ok(result.provenance.promptHash);await a.agent.generate('recap',{week:1,matchups:[],standings:[]});complete=false;await assert.rejects(()=>a.agent.generate('chat','hello'),/Incomplete/);
});




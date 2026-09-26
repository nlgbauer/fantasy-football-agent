import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,cpSync,readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../src/app.js';
import { emailPreview } from '../src/email-preview.js';
function setup(t,env={}){const root=mkdtempSync(resolve(tmpdir(),'chatpdt-email-'));for(const dir of ['knowledge','prompts'])cpSync(dir,resolve(root,dir),{recursive:true});const a=createApp(root,{MODEL_PROVIDER:'template',...env});t.after(()=>a.store.close());return a;}
const snapshot=()=>JSON.parse(readFileSync('fixtures/week.json'));
test('default email-only draft generates no caption and publishes without WhatsApp',async t=>{const a=setup(t),p=await a.publications.draft(snapshot());assert.deepEqual(p.channels,['gmail']);assert.equal(p.caption,'');assert.equal(p.destinations.whatsapp,undefined);assert.equal(p.provenance.length,1);assert.match(p.text,/DATA-ONLY PREVIEW/);await a.publications.revise(p.id,{text:p.text,caption:''});const revised=a.store.get(p.id);a.publications.decide(p.id,'approve',a.publications.digest(revised));await a.publications.publish(p.id);assert.equal(a.store.db.prepare('SELECT count(*) AS n FROM deliveries').get().n,1);});
test('enabling a channel cannot expand a previously approved email',async t=>{const a=setup(t),p=await a.publications.draft(snapshot());a.publications.decide(p.id,'approve',a.publications.digest(p));a.publications.channels.whatsapp={send:async()=>assert.fail('Unauthorized channel')};await assert.rejects(()=>a.publications.publish(p.id),/channels changed/);});
test('live Gmail delivery is independent of WhatsApp settings',async t=>{const a=setup(t,{LIVE_SEND:'true',GMAIL_FROM:'sender@example.com',GMAIL_TO:'operator@example.com'});let calls=0;a.agent.generate=async()=>({text:'Verified recap',provenance:{provider:'openai'}});a.publications.channels.gmail={send:async()=>{calls++;return {id:'mock-receipt'};}};const p=await a.publications.draft({...snapshot(),source:'espn'});a.publications.decide(p.id,'approve',a.publications.digest(p));await a.publications.publish(p.id);assert.equal(calls,1);assert.equal(a.store.get(p.id).status,'published');});
test('data-only recap labels tied scores and unavailable inputs truthfully',()=>{const s=snapshot();s.matchups[0].home.score=s.matchups[0].away.score;const text=emailPreview(s);assert.match(text,/tied at/);assert.match(text,/External NFL news was not fetched/);assert.match(text,/AI editorial voice is not configured/);});




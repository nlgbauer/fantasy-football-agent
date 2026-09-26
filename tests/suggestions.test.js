import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createApp } from '../src/app.js';
import { hash } from '../src/store.js';
import { forwardSuggestions } from '../src/suggestions.js';
function setup(t){const root=mkdtempSync(resolve(tmpdir(),'chatpdt-suggestions-'));for(const dir of ['knowledge','prompts'])cpSync(dir,resolve(root,dir),{recursive:true});const app=createApp(root,{MODEL_PROVIDER:'mock',WHATSAPP_GROUP_ID:'league'});t.after(()=>app.store.close());return app;}
test('natural WhatsApp suggestion queues once and privately forwards with provenance, never writes memory',async t=>{
 const a=setup(t),before=hash(a.memory.documents()),msg={id:'msg1',sender:'member',group:'league',text:'ChatPDT remember that this is a proposed anecdote'};
 const result=await a.agent.receive(msg);assert.ok(result.suggestionId);assert.doesNotMatch(result.text,/form|Markdown|log.?in/i);assert.equal((await a.agent.receive(msg)).duplicate,true);
 const sent=[];const client={sendMessage:async(to,text)=>{sent.push({to,text});return {id:{_serialized:'receipt'}};}};
 await Promise.all([forwardSuggestions(a.store,client,'123@c.us'),forwardSuggestions(a.store,client,'123@c.us')]);
 assert.equal(sent.length,1);assert.equal(sent[0].to,'123@c.us');assert.ok(sent[0].text.includes(msg.text));assert.equal(a.store.get(result.suggestionId).notification,'sent');assert.equal(hash(a.memory.documents()),before);assert.equal(a.store.list('submission').length,0);
});
test('verified member DM needs no bot prefix and uncertain forwarding is not blindly retried',async t=>{
 const a=setup(t);const result=await a.agent.receive({id:'dm1',sender:'member',group:'league',text:'I have a suggestion for the history',verifiedMemberDM:true});assert.ok(result.suggestionId);
 let calls=0;const client={sendMessage:async()=>{calls++;throw Error('timeout');}};
 await forwardSuggestions(a.store,client,'123@c.us');await forwardSuggestions(a.store,client,'123@c.us');assert.equal(calls,1);assert.equal(a.store.get(result.suggestionId).notification,'unknown');
});
test('no private recipient configured leaves suggestion pending and does not broadcast it',async t=>{
 const a=setup(t);const result=await a.agent.receive({id:'msg2',sender:'member',group:'league',text:'ChatPDT correction: please review this'});
 await forwardSuggestions(a.store,{sendMessage:()=>assert.fail('must not send')},'league@g.us');assert.equal(a.store.get(result.suggestionId).notification,'pending');
 assert.throws(()=>a.memory.decide(result.suggestionId,'approve',hash(a.store.get(result.suggestionId))),/Invalid transition/);
});




import { readFileSync, mkdtempSync, cpSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { hash } from '../src/store.js';
import { route } from '../src/agent.js';
const root=mkdtempSync(resolve(tmpdir(),'chatpdt-eval-'));
for(const dir of ['knowledge','prompts'])cpSync(dir,resolve(root,dir),{recursive:true});
const app=createApp(root,{MODEL_PROVIDER:'mock',WHATSAPP_GROUP_ID:'eval-group'});
const before=hash(app.memory.documents());let passed=0;
try{for(const c of JSON.parse(readFileSync('evals/cases.json'))){assert.equal(route(c.input),c.route);const out=await app.agent.receive({id:c.id,sender:'eval-member',group:'eval-group',text:c.input});assert.ok(out.text);assert.equal(hash(app.memory.documents()),before);assert.equal(app.store.list('publication').length,0);assert.equal(app.store.list('submission').length,0);assert.equal(app.store.db.prepare('SELECT count(*) AS n FROM deliveries').get().n,0);passed++;console.log(`PASS ${c.id}: ${c.expect}`);}console.log(`${passed} deterministic workflow evals passed. Live-model quality requires the rubric in evals/README.md.`);}finally{app.store.close();}




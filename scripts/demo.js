import { createApp } from '../src/app.js';
import { readFileSync } from 'node:fs';
const app=createApp(process.cwd(),{MODEL_PROVIDER:'mock',LIVE_SEND:'false'});
try{const p=await app.publications.draft(JSON.parse(readFileSync('fixtures/week.json')));console.log(`Created demo draft ${p.id}\nPDF: ${app.publications.artifacts(p).pdf}\nNo approval or delivery performed.`);}finally{app.store.close();}




import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Store } from '../src/store.js';
import { latestFinalized } from '../src/adapters/espn.js';
import { buildFantasyGmReport, renderFantasyGmReport } from '../src/fantasy-gm.js';
import { GmailChannel } from '../src/adapters/channels.js';

const env=process.env,store=new Store(resolve(process.cwd(),'var/chatpdt.sqlite'));
try{
  const finalized=await latestFinalized(env),week=Math.min(finalized.week+1,25);
  const report=await buildFantasyGmReport(env,week);
  const content=renderFantasyGmReport(report);
  const artifactDir=resolve(process.cwd(),'var','artifacts');mkdirSync(artifactDir,{recursive:true});
  const path=resolve(artifactDir,`Fantasy_GM_Week_${week}.json`);writeFileSync(path,JSON.stringify(report,null,2)+'\n');
  const key=`fantasy-gm:${report.season}:${week}`;
  const existing=store.db.prepare("SELECT id,state FROM deliveries WHERE id=? OR id GLOB ? ORDER BY CASE state WHEN 'sent' THEN 0 ELSE 1 END LIMIT 1").get(key,`${key}:*`);
  if(existing?.state==='sent')console.log(`Week ${week} Fantasy GM report was already emailed as ${existing.id}; no duplicate sent.`);
  else if(existing)throw new Error(`Fantasy GM delivery ${existing.id} needs reconciliation (${existing.state})`);
  else{
    store.db.prepare('INSERT INTO deliveries VALUES (?,?,?)').run(key,'sending',null);
    try{const receipt=await new GmailChannel(env).sendFantasyGmReport(report,content,key);store.db.prepare('UPDATE deliveries SET state=?,receipt=? WHERE id=?').run('sent',JSON.stringify(receipt),key);store.audit('fantasy_gm.sent',key,{recipient:env.GMAIL_REVIEW_TO,week,freeAgentPositions:report.freeAgents.length,trades:report.trades.length});console.log(`Week ${week} Fantasy GM report emailed to ${env.GMAIL_REVIEW_TO}. No transaction was submitted.`);}
    catch(error){store.db.prepare('UPDATE deliveries SET state=? WHERE id=?').run('unknown',key);store.audit('fantasy_gm.unknown',key);throw error;}
  }
}finally{store.close();}

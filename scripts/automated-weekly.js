import { createApp } from '../src/app.js';
import { latestFinalized } from '../src/adapters/espn.js';
import { weekly } from '../src/weekly.js';
import { GmailChannel } from '../src/adapters/channels.js';

const env=process.env;
if(env.WEEKLY_AUTO_DRAFT!=='true')throw new Error('Automatic Tuesday drafting is not enabled. Set WEEKLY_AUTO_DRAFT=true after configuring the writing model and review recipient.');
if(env.MODEL_PROVIDER!=='openai'||!env.OPENAI_API_KEY||!env.OPENAI_MODEL)throw new Error('Configure the OpenAI writing model locally before automatic weekly sending');
if(env.WHATSAPP_ENABLED==='true')throw new Error('Tuesday email automation must remain email-only until WhatsApp publishing is separately approved');
if(!env.GMAIL_REVIEW_TO||env.GMAIL_REVIEW_TO.includes(',')||!env.GMAIL_REVIEW_TO.includes('@'))throw new Error('Configure the owner’s single GMAIL_REVIEW_TO address');

const app=createApp(process.cwd(),env);
try{
  const snapshot=await latestFinalized(env);
  const publication=await weekly(app,env,snapshot.week,snapshot);
  if(publication.status==='published')console.log(`Week ${snapshot.week} was already published; no review email sent.`);
  else {
    const current=app.store.get(publication.id),key=`review-${current.id}`;
    const existing=app.store.db.prepare('SELECT state FROM deliveries WHERE id=?').get(key);
    if(existing?.state==='sent')console.log(`Week ${snapshot.week} review was already emailed to the owner; no duplicate sent.`);
    else if(existing)throw new Error(`Review delivery ${key} needs reconciliation (${existing.state})`);
    else{
      app.store.db.prepare('INSERT INTO deliveries VALUES (?,?,?)').run(key,'sending',null);
      try{const receipt=await new GmailChannel(env).sendReview(current,app.publications.artifacts(current),key);app.store.db.prepare('UPDATE deliveries SET state=?,receipt=? WHERE id=?').run('sent',JSON.stringify(receipt),key);app.store.audit('publication.review_sent',current.id,{recipient:env.GMAIL_REVIEW_TO,receipt});console.log(`Private Week ${snapshot.week} review emailed to ${env.GMAIL_REVIEW_TO}. League delivery still requires the owner approval.`);}
      catch(error){app.store.db.prepare('UPDATE deliveries SET state=? WHERE id=?').run('unknown',key);app.store.audit('publication.review_unknown',current.id);throw error;}
    }
  }
}finally{app.store.close();}




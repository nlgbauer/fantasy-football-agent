import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { hash, now } from './store.js';
import { html, pdf } from './render.js';
import { buildWeeklyVisuals, inlineImages } from './awards.js';
import { planWeeklyStories, assertNoUsedStoryRepeated } from './story-ledger.js';
const fileHash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
export class Publications {
  constructor(store,agent,root,channels,env=process.env){Object.assign(this,{store,agent,root,channels,env});}
  digest(p){return hash({title:p.title,text:p.text,html:p.html,caption:p.caption,week:p.week,season:p.season,destinations:p.destinations,snapshot:p.snapshot,visuals:p.visuals,storySelections:p.storySelections,pdfHash:p.pdfHash,mode:p.mode,channels:p.channels});}
  async draft(snapshot){
    if(snapshot.final!==true||!snapshot.matchups?.length)throw new Error('Final matchups required');
    const channels=Object.keys(this.channels).sort();
    const previousPublications=this.store.list('publication');
    const storyPlan=planWeeklyStories(this.agent.memory.documents(),previousPublications,{season:snapshot.season,week:snapshot.week,count:Number(this.env.WEEKLY_STORY_COUNT||4)});
    const recap=await this.agent.generate('recap',{...snapshot,storyPlan}),caption=channels.includes('whatsapp')?await this.agent.generate('caption',{week:snapshot.week,recap:recap.text}):null;
    assertNoUsedStoryRepeated(recap.text,storyPlan.used);
    const destinations={from:this.env.GMAIL_FROM||'chatpdt@example.invalid',email:this.env.GMAIL_TO||'league@example.invalid'};
    if(channels.includes('whatsapp'))destinations.whatsapp=this.env.WHATSAPP_GROUP_ID||'demo-group';
    const visuals=await buildWeeklyVisuals(this.agent.root,snapshot,previousPublications,this.env);
    const p={type:'publication',status:'draft',createdAt:now(),season:snapshot.season,week:snapshot.week,title:`ChatPDT | ${snapshot.season} Week ${snapshot.week}`,text:recap.text,caption:caption?.text||'',snapshot,visuals,storySelections:storyPlan.selected,provenance:[recap.provenance,...(caption?[caption.provenance]:[])],channels,mode:this.env.LIVE_SEND==='true'?'live':'dry-run',destinations};
    this.store.put('publication',p);await this.render(p);this.store.audit('publication.drafted',p.id);return p;
  }
  artifacts(p){return {pdf:resolve(this.root,p.id+'.pdf'),html:resolve(this.root,p.id+'.html'),inline:inlineImages(p.visuals)};}
  async render(p){mkdirSync(this.root,{recursive:true});p.html=html(p.title,p.text,p.visuals);const a=this.artifacts(p);writeFileSync(a.html,p.html);await pdf(a.pdf,p.title,p.text,p.visuals);p.pdfHash=hash(readFileSync(a.pdf).toString('base64'));this.store.put('publication',p);}
  async revise(id,{text,caption}){const p=this.store.get(id);if(p.type!=='publication'||!['draft','approved','rejected'].includes(p.status))throw new Error('Cannot edit this publication');if(typeof text!=='string'||!text.trim()||text.length>30000||typeof caption!=='string'||(p.channels?.includes('whatsapp')&&!caption.trim())||caption.length>1000)throw new Error('Invalid content');p.text=text;p.caption=caption;p.status='draft';delete p.approval;await this.render(p);this.store.audit('publication.revised',id);return p;}
  decide(id,decision,digest){const p=this.store.get(id);if(p.type!=='publication'||p.status!=='draft'||!['approve','reject'].includes(decision))throw new Error('Invalid transition');if(digest!==this.digest(p))throw new Error('Review changed; reload');p.status=decision==='approve'?'approved':'rejected';p.approval={actor:'the owner',at:now(),digest};this.store.put('publication',p);this.store.audit('publication.'+p.status,id,p.approval);return p;}
  async publish(id){
    const p=this.store.get(id);
    if(p.type!=='publication'||!['approved','publishing','published'].includes(p.status)||p.approval?.digest!==this.digest(p))throw new Error('Exact package approval required');
    if(p.mode!==(this.env.LIVE_SEND==='true'?'live':'dry-run'))throw new Error('Sending mode changed; create a fresh package');
    if(JSON.stringify(p.channels)!==JSON.stringify(Object.keys(this.channels).sort()))throw new Error('Delivery channels changed; create and approve a fresh package');
    const artifacts=this.artifacts(p);
    if(hash(readFileSync(artifacts.pdf).toString('base64'))!==p.pdfHash)throw new Error('PDF changed after review');
    for(const image of artifacts.inline)if(image.sha256!==fileHash(image.path))throw new Error('Visual changed after review');
    if(p.mode==='live'&&(p.snapshot.source==='fixture'||p.provenance.some(x=>x.provider!=='openai')||JSON.stringify(p.destinations).includes('example.invalid')||p.destinations.whatsapp==='demo-group'))throw new Error('Demo content or recipients cannot be published live');
    p.status='publishing';this.store.put('publication',p);
    for(const [name,channel] of Object.entries(this.channels)){
      const key=`${p.id}-${name}`;
      const claimed=this.store.tx(()=>{const existing=this.store.db.prepare('SELECT state FROM deliveries WHERE id=?').get(key);if(existing?.state==='sent')return false;if(existing)throw new Error(`Delivery ${key} needs reconciliation (${existing.state})`);this.store.db.prepare('INSERT INTO deliveries VALUES (?,?,?)').run(key,'sending',null);return true;});
      if(!claimed)continue;
      try{const receipt=await channel.send(p,artifacts,key);this.store.db.prepare('UPDATE deliveries SET state=?,receipt=? WHERE id=?').run('sent',JSON.stringify(receipt),key);this.store.audit('delivery.sent',key,{receipt});}
      catch(e){this.store.db.prepare('UPDATE deliveries SET state=? WHERE id=?').run('unknown',key);this.store.audit('delivery.unknown',key);throw e;}
    }
    p.status='published';this.store.put('publication',p);this.store.audit('publication.published',id,{mode:p.mode});return p;
  }
  reconcile(key,action,receipt){if(!['confirmed-sent','confirmed-not-sent'].includes(action)||typeof receipt!=='string'||receipt.length<5)throw new Error('Provider evidence required');const d=this.store.db.prepare('SELECT state FROM deliveries WHERE id=?').get(key);if(!d||!['unknown','sending'].includes(d.state))throw new Error('Not an uncertain delivery');if(action==='confirmed-sent')this.store.db.prepare('UPDATE deliveries SET state=?,receipt=? WHERE id=?').run('sent',JSON.stringify({manual:receipt}),key);else this.store.db.prepare('DELETE FROM deliveries WHERE id=?').run(key);this.store.audit('delivery.reconciled',key,{actor:'the owner',action,receipt});}
}




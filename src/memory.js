import { readFileSync, readdirSync, realpathSync, writeFileSync, renameSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
import { hash, now } from './store.js';
export class Memory {
  constructor(root,store){this.root=realpathSync(root);this.store=store;}
  path(target){
    if(typeof target!=='string' || !/^(members|creighton|league|editorial)\/[a-z0-9_-]+\.md$/.test(target)) throw new Error('Invalid memory target');
    const p=realpathSync(resolve(this.root,target));
    if(!p.startsWith(this.root+sep)) throw new Error('Memory path escape');
    return p;
  }
  documents(){return ['members','creighton','league','editorial'].flatMap(dir=>readdirSync(resolve(this.root,dir)).filter(n=>n.endsWith('.md')).map(n=>{const path=`${dir}/${n}`;return {path,text:readFileSync(this.path(path),'utf8')};}));}
  retrieve(query,limit=6){
    const words=new Set(query.toLowerCase().match(/[a-z0-9]{3,}/g)||[]);
    return this.documents().filter(d=>!d.text.includes('status: placeholder')).map(d=>({...d,sha256:hash(d.text),score:[...words].filter(w=>d.text.toLowerCase().includes(w)).length})).filter(d=>d.score>0 || d.path.startsWith('editorial/')).sort((a,b)=>b.score-a.score).slice(0,limit);
  }
  propose({submitter,target,proposedText,category,source}){
    const validString=(v,max)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
    if(!validString(submitter,200) || !validString(proposedText,12000) || !['fact','anecdote','correction','boundary','rule','joke'].includes(category) || !validString(source?.messageId,500) || !validString(source?.channel,50)) throw new Error('Invalid submission');
    const before=readFileSync(this.path(target),'utf8');
    const item={submitter,target,proposedText,category,source,baseHash:hash(before),before,status:'pending',createdAt:now(),type:'memory'};
    this.store.put('submission',item);this.store.audit('memory.proposed',item.id,{submitter,target,source});return item;
  }
  decide(id,decision,expectedHash){
    const s=this.store.get(id);
    if(s.type!=='memory'||s.status!=='pending'||!['approve','reject'].includes(decision))throw new Error('Invalid transition');
    if(hash(s)!==expectedHash)throw new Error('Review changed; reload');
    if(decision==='reject'){s.status='rejected';s.decidedAt=now();this.store.put('submission',s);this.store.audit('memory.rejected',id,{actor:'the owner'});return s;}
    const path=this.path(s.target), current=readFileSync(path,'utf8');
    if(hash(current)!==s.baseHash)throw new Error('Canonical memory changed; resubmit against current version');
    // Proposed text is the entire replacement file, enabling corrections and removals.
    s.status='applying';s.approvedBy='the owner';s.approvedAt=now();s.resultHash=hash(s.proposedText);
    this.store.put('submission',s);
    writeFileSync(path+'.tmp',s.proposedText,'utf8');renameSync(path+'.tmp',path);
    s.status='approved';this.store.put('submission',s);this.store.audit('memory.approved',id,{actor:'the owner',before:s.baseHash,after:s.resultHash});return s;
  }
  recover(){for(const s of this.store.list('submission').filter(s=>s.status==='applying')){const h=hash(readFileSync(this.path(s.target),'utf8')); if(h===s.resultHash){s.status='approved';this.store.put('submission',s);this.store.audit('memory.recovered',s.id);}else if(h===s.baseHash){s.status='pending';this.store.put('submission',s);}else throw new Error('Memory recovery conflict: '+s.id);}}
}




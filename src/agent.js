import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hash, now } from './store.js';
import { emailPreview } from './email-preview.js';
export function route(text){return /\b(remember|forget|add to|correct|correction|suggest|suggestion|you should know|for (?:the|your) (?:memory|records)|update.*file|don['’]t (?:use|mention)|stop (?:using|mentioning))\b/i.test(text)?'memory':/\b(rule|ruling|legal|trade|precedent)\b/i.test(text)?'ruling':'chat';}
export class Agent {
  constructor(memory,store,root,env=process.env){Object.assign(this,{memory,store,root,env});}
  async generate(capability,input){
    const docs=this.memory.retrieve(typeof input==='string'?input:JSON.stringify(input));
    const usable=this.memory.documents().filter(d=>!d.text.includes('status: placeholder'));
    // Editorial controls are always included, independently of retrieval ranking.
    const editorial=usable.filter(d=>d.path.startsWith('editorial/'));
    // A weekly recap needs the whole small-league record, even when team names do not
    // lexically match Creighton background or a member's current profile text.
    const recapContext=capability==='recap'?usable.filter(d=>d.path.startsWith('members/')||d.path.startsWith('creighton/')||['league/team_history.md','league/team_mappings.md','league/running_jokes.md'].includes(d.path)):[];
    const context=[...new Map([...docs,...editorial,...recapContext].map(d=>[d.path,d])).values()];
    const recentEditions=this.store.list('publication').filter(p=>p.status==='published').slice(-8).map(p=>({caption:p.caption,text:p.text.slice(0,6000)}));
    const latestSnapshot=this.store.list('publication').at(-1)?.snapshot||null;
    const instructions=readFileSync(resolve(this.root,'prompts/system.md'),'utf8')+'\n'+readFileSync(resolve(this.root,`prompts/${capability}.md`),'utf8');
    let text;
    if(this.env.MODEL_PROVIDER==='openai'){
      if(!this.env.OPENAI_API_KEY||!this.env.OPENAI_MODEL)throw new Error('Configure OpenAI key and model');
      const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',signal:AbortSignal.timeout(45000),headers:{Authorization:`Bearer ${this.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:this.env.OPENAI_MODEL,instructions,input:JSON.stringify({request:input,untrustedReferenceDocuments:context,previouslyPublishedForRepetitionChecking:recentEditions,latestFantasySnapshot:latestSnapshot}),store:false,max_output_tokens:2400})});
      if(!response.ok)throw new Error(`Model request failed (${response.status})`);
      const result=await response.json();
      if(result.status!=='completed')throw new Error('Incomplete model response');
      text=(result.output||[]).flatMap(o=>o.content||[]).filter(c=>c.type==='output_text').map(c=>c.text).join('\n');
      if(!text.trim())throw new Error('Empty model response');
    }else if(this.env.MODEL_PROVIDER==='template'&&capability==='recap'){
      text=emailPreview(input);
    }else{
      text=capability==='recap'?`DEMO - Week ${input.week}\n\n${input.matchups.map(m=>`${m.home.name}: ${m.home.score} | ${m.away.name}: ${m.away.score}`).join('\n')}\n\nThe Office has reviewed the arithmetic. Appeals should include better arithmetic.\n\nStandings: ${input.standings.map(t=>`${t.name} (${t.wins}-${t.losses})`).join('; ')}\n\nTransactions: ${input.transactionsStatus}.`:
        capability==='caption'?'The weekly report is attached. The Office regrets that reading it does not count toward your point total.':
        capability==='memory'?'Tell me your suggestion here in WhatsApp. I will queue it for the owner to review before any league memory changes.':
        capability==='ruling'?'Advisory only: I do not have enough verified league rules or precedents to rule. the owner must confirm.':
        'Local demo: I do not have verified history for that claim. Add sourced league material through the approval workflow.';
    }
    const provenance={at:now(),capability,provider:this.env.MODEL_PROVIDER||'mock',model:this.env.OPENAI_MODEL||null,promptHash:hash(instructions),sources:context.map(d=>({path:d.path,sha256:hash(d.text)})),outputHash:hash(text)};
    this.store.audit('agent.generated',provenance.outputHash,provenance);
    return {text,provenance};
  }
  async receive(message){
    if(!message.id||!message.sender||typeof message.text!=='string'||message.text.length>8000)throw new Error('Invalid message');
    if(message.fromMe||message.group!==this.env.WHATSAPP_GROUP_ID||!this.env.WHATSAPP_GROUP_ID||!(message.verifiedMemberDM===true||/^\s*@?ChatPDT\b/i.test(message.text)||message.mentioned===true))return {ignored:true};
    const exists=this.store.db.prepare('SELECT 1 FROM messages WHERE id=?').get(message.id);if(exists)return {duplicate:true};
    const capability=route(message.text);
    if(capability==='memory'){
      const suggestion=this.store.tx(()=>{
        this.store.db.prepare('INSERT INTO messages VALUES (?,?,?)').run(message.id,now(),JSON.stringify(message));
        const item=this.store.put('suggestion',{type:'suggestion',status:'awaiting_nate',submitter:message.sender,text:message.text,source:{channel:'whatsapp',messageId:message.id,group:message.group,direct:message.verifiedMemberDM===true},createdAt:now(),notification:'pending'});
        this.store.audit('suggestion.received',item.id,{source:item.source,submitter:item.submitter});return item;
      });
      return {capability,suggestionId:suggestion.id,text:'Got it — I’ve queued your suggestion for the owner to review. Nothing has been added to league memory yet.'};
    }
    this.store.db.prepare('INSERT INTO messages VALUES (?,?,?)').run(message.id,now(),JSON.stringify(message));
    const result=await this.generate(capability,message.text);
    return {...result,capability};
  }
}




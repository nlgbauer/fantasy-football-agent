import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import nodemailer from 'nodemailer';
/** Channel contract: send(publication, artifacts, deliveryKey) -> provider receipt.
 * A thrown error may mean accepted-but-unacknowledged: core marks it unknown.
 * Adapters cannot approve, edit memory, select recipients, or regenerate content.
 */
export class LocalChannel {
  constructor(root,name){this.root=root;this.name=name;}
  async send(p,artifacts,key){mkdirSync(this.root,{recursive:true});writeFileSync(resolve(this.root,key+'.json'),JSON.stringify({channel:this.name,package:p.id,title:p.title,text:p.text,caption:p.caption,destinations:p.destinations,artifacts,dryRun:true},null,2));return {id:key,dryRun:true};}
}
export class GmailChannel {
  constructor(env){this.env=env;}
  smtp(){
    const pass=(this.env.GMAIL_APP_PASSWORD||'').replace(/\s/g,'');
    if(!this.env.GMAIL_FROM||pass.length!==16)throw new Error('Configure the Gmail sender and its 16-character Google app password locally');
    return nodemailer.createTransport({host:'smtp.gmail.com',port:465,secure:true,auth:{user:this.env.GMAIL_FROM,pass},connectionTimeout:15000,greetingTimeout:15000,socketTimeout:30000});
  }
  async verify(){
    if(this.env.GMAIL_TRANSPORT!=='smtp')throw new Error('This connection check requires GMAIL_TRANSPORT=smtp');
    const transport=this.smtp();try{await transport.verify();return {connected:true,sender:this.env.GMAIL_FROM};}catch{throw new Error('Gmail login failed. Check the account, 2-Step Verification and app password.');}finally{transport.close();}
  }
  async sendConnectionTest(recipient){
    if(this.env.GMAIL_TRANSPORT!=='smtp')throw new Error('This test requires GMAIL_TRANSPORT=smtp');
    if(typeof recipient!=='string'||recipient!==this.env.GMAIL_TO||!recipient.includes('@'))throw new Error('Test recipient must exactly match GMAIL_TO');
    const transport=this.smtp();
    try{
      const result=await transport.sendMail({from:{name:'ChatPDT',address:this.env.GMAIL_FROM},to:recipient,subject:'ChatPDT email connection test',text:'This is a one-time connection test from ChatPDT. Gmail delivery is working. No league recap was published and no other recipients were contacted.',html:'<p>This is a one-time connection test from <strong>ChatPDT</strong>.</p><p>Gmail delivery is working. No league recap was published and no other recipients were contacted.</p>'});
      if(result.rejected?.length||result.accepted?.length!==1)throw new Error('Test delivery was not accepted exactly once; check Sent Mail before retrying');
      return {id:result.messageId,recipient};
    }catch(e){if(e.message.includes('accepted exactly once'))throw e;throw new Error('Gmail test delivery could not be confirmed; check Sent Mail before retrying');}finally{transport.close();}
  }
  async sendLineupNotice(plan,key){
    if(this.env.GMAIL_TRANSPORT!=='smtp')throw new Error('Lineup notifications currently require GMAIL_TRANSPORT=smtp');
    if(!this.env.GMAIL_TO||!this.env.GMAIL_TO.includes('@'))throw new Error('Configure GMAIL_TO for lineup notifications');
    const changes=plan.moves.map(move=>`<li><strong>${move.name}</strong>: ${move.fromSlotName} to ${move.toSlotName} (${move.projected.toFixed(2)} projected)</li>`).join('');
    const text=[`ChatPDT adjusted ${plan.teamName} for Week ${plan.scoringPeriodId}.`,`Projected lineup: ${plan.currentProjected.toFixed(2)} → ${plan.optimizedProjected.toFixed(2)} (+${plan.projectedGain.toFixed(2)})`,...plan.moves.map(move=>`${move.name}: ${move.fromSlotName} to ${move.toSlotName} (${move.projected.toFixed(2)} projected)`),'No player was added, dropped, placed on IR, or traded.'].join('\n');
    const transport=this.smtp();
    try{
      const result=await transport.sendMail({from:{name:'ChatPDT',address:this.env.GMAIL_FROM},to:this.env.GMAIL_TO,subject:`ChatPDT adjusted your Week ${plan.scoringPeriodId} lineup`,text,html:`<h2>Week ${plan.scoringPeriodId} lineup adjusted</h2><p><strong>${plan.currentProjected.toFixed(2)} → ${plan.optimizedProjected.toFixed(2)}</strong> projected points (+${plan.projectedGain.toFixed(2)})</p><ul>${changes}</ul><p>No player was added, dropped, placed on IR, or traded.</p>`,messageId:`<${key.replace(/[^a-zA-Z0-9.-]/g,'-')}@chatpdt.local>`});
      if(result.rejected?.length||result.accepted?.length!==1)throw new Error('Lineup notification was not accepted exactly once; check Sent Mail before retrying');
      return {id:result.messageId,recipient:this.env.GMAIL_TO};
    }catch(e){if(e.message.includes('accepted exactly once'))throw e;throw new Error('Lineup notification could not be confirmed; check Sent Mail before retrying');}finally{transport.close();}
  }
  async sendReview(p,artifacts,key){
    if(this.env.GMAIL_TRANSPORT!=='smtp')throw new Error('Draft review delivery currently requires GMAIL_TRANSPORT=smtp');
    const recipient=this.env.GMAIL_REVIEW_TO;
    if(!recipient||!recipient.includes('@')||recipient.includes(','))throw new Error('Configure exactly one GMAIL_REVIEW_TO address for the owner');
    const banner='<div style="padding:16px 20px;background:#fff4cc;border:2px solid #d6a928;font:14px/1.5 Arial,sans-serif;color:#3d3212"><strong>Private ChatPDT draft — review required.</strong><br>This has not been sent to the league. Open the local ChatPDT review screen to edit, approve, and publish it.</div>';
    const reviewHtml=String(p.html).replace(/<body([^>]*)>/i,`<body$1>${banner}`);
    const transport=this.smtp();
    try{
      const result=await transport.sendMail({from:{name:'ChatPDT',address:this.env.GMAIL_FROM},to:recipient,subject:`[REVIEW REQUIRED] ${p.title}`,text:`Private ChatPDT draft for Week ${p.week}. This has not been sent to the league. Open http://127.0.0.1:${this.env.PORT||8787}/ on the ChatPDT computer to edit, approve, and publish it.`,html:reviewHtml,messageId:`<${key}@chatpdt.local>`,headers:{'X-ChatPDT-Review':'true','X-ChatPDT-Edition':`${p.season}-${p.week}`},attachments:[{filename:`ChatPDT_Week_${p.week}_DRAFT.pdf`,path:artifacts.pdf},...(artifacts.inline||[]).map(image=>({filename:image.file,path:image.path,cid:image.cid,contentDisposition:'inline'}))]});
      if(result.rejected?.length||result.accepted?.length!==1)throw new Error('Draft review was not accepted exactly once; check Sent Mail before retrying');
      return {id:result.messageId,recipient};
    }catch(e){if(e.message.includes('accepted exactly once'))throw e;throw new Error('Draft review delivery could not be confirmed; check Sent Mail before retrying');}finally{transport.close();}
  }
  async sendFantasyGmReport(report,content,key){
    if(this.env.GMAIL_TRANSPORT!=='smtp')throw new Error('Fantasy GM reports currently require GMAIL_TRANSPORT=smtp');
    const recipient=this.env.GMAIL_REVIEW_TO;
    if(!recipient||!recipient.includes('@')||recipient.includes(','))throw new Error('Configure exactly one GMAIL_REVIEW_TO address for the owner');
    const transport=this.smtp();
    try{
      const result=await transport.sendMail({from:{name:'ChatPDT',address:this.env.GMAIL_FROM},to:recipient,subject:`${report.revised?'[REVISED] ':''}ChatPDT Fantasy GM — Week ${report.week}`,text:content.text,html:content.html,messageId:`<${key}@chatpdt.local>`,headers:{'X-ChatPDT-GM-Report':'true','X-ChatPDT-Week':String(report.week)}});
      if(result.rejected?.length||result.accepted?.length!==1)throw new Error('Fantasy GM report was not accepted exactly once; check Sent Mail before retrying');
      return {id:result.messageId,recipient};
    }catch(e){if(e.message.includes('accepted exactly once'))throw e;throw new Error('Fantasy GM report delivery could not be confirmed; check Sent Mail before retrying');}finally{transport.close();}
  }
  async send(p,artifacts,key){
    const env=this.env;
    if(env.GMAIL_TRANSPORT==='smtp'){
      if(p.destinations.from!==env.GMAIL_FROM)throw new Error('Approved sender differs from the connected Gmail account');
      const transport=this.smtp();
      try{
        const result=await transport.sendMail({from:{name:'ChatPDT',address:p.destinations.from},to:p.destinations.email,subject:p.subject||p.title,text:p.text,html:p.html,messageId:`<${key}@chatpdt.local>`,headers:{'X-Entity-Ref-ID':key,'X-ChatPDT-Edition':`${p.season||'demo'}-${p.week}`},attachments:[{filename:`ChatPDT_Week_${p.week}.pdf`,path:artifacts.pdf},...(artifacts.inline||[]).map(image=>({filename:image.file,path:image.path,cid:image.cid,contentDisposition:'inline'}))]});
        if(result.rejected?.length)throw new Error('One or more recipients were rejected; reconcile before retrying');
        return {id:result.messageId,accepted:result.accepted};
      }catch{throw new Error('Gmail delivery could not be confirmed; check Sent Mail before retrying');}finally{transport.close();}
    }
    const token=await fetch('https://oauth2.googleapis.com/token',{method:'POST',signal:AbortSignal.timeout(20000),body:new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,refresh_token:env.GOOGLE_REFRESH_TOKEN,grant_type:'refresh_token'})});
    if(!token.ok)throw new Error('Gmail OAuth refresh failed');
    const {access_token}=await token.json();
    const transport=nodemailer.createTransport({streamTransport:true,buffer:true,newline:'windows'});
    const mail=await transport.sendMail({from:p.destinations.from,to:p.destinations.email,subject:p.subject||p.title,text:p.text,html:p.html,messageId:`<${key}@chatpdt.local>`,headers:{'X-Entity-Ref-ID':key,'X-ChatPDT-Edition':`${p.season||'demo'}-${p.week}`},attachments:[{filename:`ChatPDT_Week_${p.week}.pdf`,path:artifacts.pdf},...(artifacts.inline||[]).map(image=>({filename:image.file,path:image.path,cid:image.cid,contentDisposition:'inline'}))]});
    const response=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',signal:AbortSignal.timeout(30000),headers:{Authorization:`Bearer ${access_token}`,'Content-Type':'application/json'},body:JSON.stringify({raw:mail.message.toString('base64url')})});
    if(!response.ok)throw new Error(`Gmail send failed (${response.status})`);
    return response.json();
  }
}




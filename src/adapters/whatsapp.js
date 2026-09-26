import { resolve } from 'node:path';
import { forwardSuggestions } from '../suggestions.js';
import { route } from '../agent.js';
export class WhatsAppWebChannel {
  constructor(env,agent){this.env=env;this.agent=agent;this.ready=false;this.last=new Map();}
  async start(){
    if(!/^\d+@(?:c\.us|lid)$/.test(this.env.NATE_WHATSAPP_ID||''))throw new Error('Set NATE_WHATSAPP_ID to the owner’s verified private WhatsApp identity before connecting');
    const {default:ww}=await import('whatsapp-web.js');
    const {default:qr}=await import('qrcode-terminal');
    this.media=ww.MessageMedia;
    this.client=new ww.Client({authStrategy:new ww.LocalAuth({clientId:'chatpdt',dataPath:resolve('var/whatsapp-session')}),puppeteer:{headless:true}});
    this.client.on('qr',code=>qr.generate(code,{small:true}));
    this.client.on('ready',()=>{this.ready=true;console.log('WhatsApp connected');forwardSuggestions(this.agent.store,this.client,this.env.NATE_WHATSAPP_ID).catch(()=>console.error('Suggestion forwarding failed'));});
    this.client.on('disconnected',()=>{this.ready=false;console.error('WhatsApp disconnected; relink if required');});
    this.client.on('auth_failure',()=>{this.ready=false;console.error('WhatsApp authentication failed');});
    this.client.on('message',async msg=>{
      try{
        if(msg.fromMe)return;
        let direct=false;
        if(msg.from!==this.env.WHATSAPP_GROUP_ID){
          if(!/^\d+@(?:c\.us|lid)$/.test(msg.from))return;
          const league=await this.client.getChatById(this.env.WHATSAPP_GROUP_ID);
          if(!(league.participants||[]).some(p=>p.id._serialized===msg.from))return;
          direct=true;
        }
        const mentioned=(msg.mentionedIds||[]).includes(this.client.info?.wid?._serialized);
        if(!direct&&!mentioned&&!/^\s*@?ChatPDT\b/i.test(msg.body))return;
        if(!direct&&route(msg.body)==='memory'){
          await msg.reply('Please send me that suggestion in a private WhatsApp message. I’ll pass it privately to the owner for review.');return;
        }
        const sender=msg.author||msg.from,at=Date.now();if(route(msg.body)!=='memory'&&at-(this.last.get(sender)||0)<10000)return;this.last.set(sender,at);
        const result=await this.agent.receive({id:msg.id._serialized,sender,group:this.env.WHATSAPP_GROUP_ID,text:msg.body,mentioned,fromMe:msg.fromMe,verifiedMemberDM:direct});
        await forwardSuggestions(this.agent.store,this.client,this.env.NATE_WHATSAPP_ID);
        if(result.text)await msg.reply(result.text.slice(0,3500));
      }catch{console.error('WhatsApp inbound failed; inspect audit and connection');}
    });
    await this.client.initialize();
  }
  async send(p,artifacts,key){
    if(!this.ready)throw new Error('WhatsApp is not connected');
    const sent=await this.client.sendMessage(p.destinations.whatsapp,this.media.fromFilePath(artifacts.pdf),{caption:p.caption,sendMediaAsDocument:true});
    return {id:sent.id._serialized,key};
  }
}




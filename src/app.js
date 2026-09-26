import { resolve } from 'node:path';
import { Store } from './store.js';
import { Memory } from './memory.js';
import { Agent } from './agent.js';
import { Publications } from './publications.js';
import { LocalChannel, GmailChannel } from './adapters/channels.js';
import { WhatsAppWebChannel } from './adapters/whatsapp.js';
export function createApp(root=process.cwd(),env=process.env){
  const store=new Store(resolve(root,'var/chatpdt.sqlite')),memory=new Memory(resolve(root,'knowledge'),store);memory.recover();
  const agent=new Agent(memory,store,root,env),whatsapp=new WhatsAppWebChannel(env,agent);
  const channels={gmail:env.LIVE_SEND==='true'?new GmailChannel(env):new LocalChannel(resolve(root,'var/outbox'),'gmail')};
  if(env.WHATSAPP_ENABLED==='true')channels.whatsapp=env.LIVE_SEND==='true'?whatsapp:new LocalChannel(resolve(root,'var/outbox'),'whatsapp');
  const publications=new Publications(store,agent,resolve(root,'var/artifacts'),channels,env);
  return {store,memory,agent,publications,whatsapp};
}




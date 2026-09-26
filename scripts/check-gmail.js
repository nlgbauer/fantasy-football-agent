import { GmailChannel } from '../src/adapters/channels.js';
try{const result=await new GmailChannel(process.env).verify();console.log(`Gmail connected: ${result.sender}. Connection verified only; no email sent.`);}catch(e){console.error(e.message);process.exitCode=1;}




import test from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
import { GmailChannel } from '../src/adapters/channels.js';
const env={GMAIL_TRANSPORT:'smtp',GMAIL_FROM:'sender@example.com',GMAIL_APP_PASSWORD:'aaaa bbbb cccc dddd'};
test('SMTP checks login without sending and requires encrypted Gmail connection',async t=>{
 let closed=false;t.mock.method(nodemailer,'createTransport',options=>{assert.equal(options.host,'smtp.gmail.com');assert.equal(options.secure,true);assert.equal(options.port,465);assert.equal(options.auth.pass.length,16);return {verify:async()=>true,sendMail:()=>assert.fail('No message permitted'),close:()=>{closed=true;}};});
 assert.equal((await new GmailChannel(env).verify()).connected,true);assert.ok(closed);
});
test('SMTP sends approved HTML/PDF and rejects sender mismatch',async t=>{
 let sent=0;t.mock.method(nodemailer,'createTransport',()=>({sendMail:async mail=>{sent++;assert.equal(mail.from.address,env.GMAIL_FROM);assert.equal(mail.html,'<p>Recap</p>');assert.equal(mail.attachments[0].path,'test.pdf');return {messageId:'receipt',accepted:['test@example.com'],rejected:[]};},close:()=>{}}));
 const c=new GmailChannel(env),p={week:2,title:'Recap',text:'Recap',html:'<p>Recap</p>',destinations:{from:env.GMAIL_FROM,email:'test@example.com'}};
 assert.equal((await c.send(p,{pdf:'test.pdf'},'key')).id,'receipt');p.destinations.from='other@example.com';await assert.rejects(()=>c.send(p,{pdf:'test.pdf'},'key'),/differs/);assert.equal(sent,1);
});
test('SMTP partial recipient acceptance remains uncertain rather than successful',async t=>{
 t.mock.method(nodemailer,'createTransport',()=>({sendMail:async()=>({accepted:['a@example.com'],rejected:['b@example.com']}),close:()=>{}}));
 await assert.rejects(()=>new GmailChannel(env).send({destinations:{from:env.GMAIL_FROM,email:'a@example.com,b@example.com'}},{pdf:'test.pdf'},'key'),/could not be confirmed/);
});
test('connection test is restricted to exact configured recipient',async t=>{
 let sent=0;t.mock.method(nodemailer,'createTransport',()=>({sendMail:async mail=>{sent++;assert.equal(mail.to,'operator@example.com');assert.match(mail.subject,/connection test/);return {messageId:'test-receipt',accepted:['operator@example.com'],rejected:[]};},close:()=>{}}));
 const c=new GmailChannel({...env,GMAIL_TO:'operator@example.com'});await assert.rejects(()=>c.sendConnectionTest('other@example.com'),/exactly match/);assert.equal((await c.sendConnectionTest('operator@example.com')).recipient,'operator@example.com');assert.equal(sent,1);
});
test('draft review goes only to the owner and is clearly marked as unpublished',async t=>{
 let sent;t.mock.method(nodemailer,'createTransport',()=>({sendMail:async mail=>{sent=mail;return {messageId:'review-receipt',accepted:['operator@example.com'],rejected:[]};},close:()=>{}}));
 const c=new GmailChannel({...env,GMAIL_REVIEW_TO:'operator@example.com',PORT:'8787'}),p={season:2026,week:3,title:'ChatPDT Week 3',text:'Draft',html:'<html><body><p>Draft</p></body></html>'};
 const result=await c.sendReview(p,{pdf:'draft.pdf',inline:[]},'review-key');
 assert.equal(result.recipient,'operator@example.com');assert.equal(sent.to,'operator@example.com');assert.match(sent.subject,/REVIEW REQUIRED/);assert.match(sent.html,/not been sent to the league/);assert.match(sent.text,/127\.0\.0\.1:8787/);
});
test('Fantasy GM report goes only to the owner and contains no transaction action',async t=>{
 let sent;t.mock.method(nodemailer,'createTransport',()=>({sendMail:async mail=>{sent=mail;return {messageId:'gm-receipt',accepted:['operator@example.com'],rejected:[]};},close:()=>{}}));
 const c=new GmailChannel({...env,GMAIL_REVIEW_TO:'operator@example.com'}),report={week:4};
 const result=await c.sendFantasyGmReport(report,{text:'Recommendations only','html':'<p>Recommendations only</p>'},'gm-key');
 assert.equal(result.recipient,'operator@example.com');assert.equal(sent.to,'operator@example.com');assert.match(sent.subject,/Fantasy GM/);assert.equal(sent.attachments,undefined);
});




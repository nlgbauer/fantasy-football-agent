import test from 'node:test';
import assert from 'node:assert/strict';
import { directory,fetchLeague } from '../src/adapters/espn.js';
import { profileDrafts } from '../src/onboarding.js';
const raw=()=>({id:424242,seasonId:2026,settings:{name:'Test league'},teams:Array.from({length:12},(_,i)=>({id:i+1,name:`Team ${i+1}`,owners:[`owner-${String(i).padStart(2,'0')}`]})),members:Array.from({length:12},(_,i)=>({id:`owner-${String(i).padStart(2,'0')}`,firstName:`Example ${i}`,lastName:'Member'}))});
test('league directory creates twelve stable sourced profiles without inferring biography or WhatsApp identity',()=>{const d=directory(raw()),drafts=profileDrafts(d);assert.equal(drafts.length,12);assert.equal(drafts[0].target,'members/member-01.md');assert.match(drafts[0].text,/Example 0 Member/);assert.match(drafts[0].text,/whatsapp_identity: TODO/);assert.match(drafts[0].text,/Not supplied/);const shuffled={...d,teams:[...d.teams].reverse()};assert.deepEqual(profileDrafts(shuffled),drafts);});
test('missing and co-owner mismatches do not silently map the wrong people',()=>{const r=raw();r.teams[0].owners=[];assert.throws(()=>profileDrafts(directory(r)),/11/);r.teams[0].owners=['new-one','new-two'];assert.throws(()=>profileDrafts(directory(r)),/13/);});
test('private league rejection gives actionable error without exposing session values',async t=>{t.mock.method(globalThis,'fetch',async()=>new Response('{}',{status:401}));await assert.rejects(()=>fetchLeague({ESPN_LEAGUE_ID:'424242',ESPN_SEASON:'2026',ESPN_S2:'secret',SWID:'secret2'}),e=>e.message.includes('private-league')&&!e.message.includes('secret'));});
test('wrong season/league response fails closed; preseason roster connection needs no matchups',async t=>{let r=raw();t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify(r)));const env={ESPN_LEAGUE_ID:'424242',ESPN_SEASON:'2026'};assert.equal((await fetchLeague(env)).teams.length,12);r={...r,seasonId:2025};await assert.rejects(()=>fetchLeague(env),/different league/);});




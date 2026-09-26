import { mkdirSync,readFileSync,writeFileSync,existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fetchLeague,directory } from '../src/adapters/espn.js';
import { profileDrafts } from '../src/onboarding.js';
import { createApp } from '../src/app.js';
import { hash } from '../src/store.js';
const args=process.argv.slice(2),link=args.find(a=>a.startsWith('https://'));
if(link){
 const u=new URL(link);if(u.hostname!=='fantasy.espn.com'||!/^\d+$/.test(u.searchParams.get('leagueId')||''))throw Error('Supply an ESPN league URL with leagueId');
 const leagueId=u.searchParams.get('leagueId');let envText=readFileSync('.env','utf8');envText=/^ESPN_LEAGUE_ID=.*$/m.test(envText)?envText.replace(/^ESPN_LEAGUE_ID=.*$/m,`ESPN_LEAGUE_ID=${leagueId}`):envText+`\nESPN_LEAGUE_ID=${leagueId}\n`;writeFileSync('.env',envText);process.env.ESPN_LEAGUE_ID=leagueId;
}
try{
 const raw=await fetchLeague(process.env);const roster=directory(raw);mkdirSync('var/espn',{recursive:true});writeFileSync('var/espn/directory.json',JSON.stringify(roster,null,2));
 console.log(`Connected: ${roster.name} / ${roster.season} / ${roster.teams.length} teams`);
 const drafts=profileDrafts(roster);mkdirSync('var/onboarding',{recursive:true});writeFileSync('var/onboarding/member-drafts.json',JSON.stringify(drafts,null,2));
 if(args.includes('--apply')){
   const app=createApp();try{
    // Validate all files before writing any. Never remap existing real member profiles.
    for(const draft of drafts)if(!readFileSync(app.memory.path(draft.target),'utf8').includes('status: placeholder'))throw Error('Real profiles already exist. Review updated mappings individually; automatic replacement refused.');
    for(const draft of drafts){const s=app.memory.propose({submitter:'the owner (local onboarding)',target:draft.target,category:'fact',proposedText:draft.text,source:{channel:'espn-onboarding',messageId:`${roster.leagueId}:${roster.season}:${draft.espnMemberId}`}});app.memory.decide(s.id,'approve',hash(s));}
    const mapping=app.memory.propose({submitter:'the owner (local onboarding)',target:'league/team_mappings.md',category:'fact',proposedText:`# ESPN team mappings\n\nLeague ${roster.leagueId}; season ${roster.season}; retrieved ${roster.fetchedAt}.\n\n${drafts.map(d=>`- ${d.target}: ESPN owner ${d.espnMemberId}`).join('\n')}\n\nNames and season-specific teams are in each member profile. WhatsApp identities must be verified separately.\n`,source:{channel:'espn-onboarding',messageId:`${roster.leagueId}:${roster.season}`}});app.memory.decide(mapping.id,'approve',hash(mapping));
    console.log('Created all 12 sourced member profiles with approval/provenance records. No personal stories inferred.');
   }finally{app.store.close();}
 }else console.log('Saved 12 member drafts privately. Review var/onboarding/member-drafts.json; --apply imports them into untouched placeholders.');
}catch(e){console.error(e.message);process.exitCode=1;}




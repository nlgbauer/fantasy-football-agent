// ESPN IDs identify fantasy owners only; WhatsApp identity requires separate verification.
export function profileDrafts(directory){
  const owners=new Map();
  for(const team of directory.teams)for(const owner of team.owners){
    if(!owner.espnMemberId)throw Error('Missing ESPN owner ID');
    const entry=owners.get(owner.espnMemberId)||{...owner,teams:[]};entry.teams.push(team);owners.set(owner.espnMemberId,entry);
  }
  if(owners.size!==12)throw Error(`Expected 12 unique league members; ESPN exposed ${owners.size}. Confirm co-owners or missing owner data before importing.`);
  const clean=value=>String(value??'Unconfirmed').replace(/[\r\n]/g,' ').replace(/[<>]/g,'');
  return [...owners.values()].sort((a,b)=>a.espnMemberId.localeCompare(b.espnMemberId)).map((owner,index)=>{
    const id=`member-${String(index+1).padStart(2,'0')}`;
    return {target:`members/${id}.md`,espnMemberId:owner.espnMemberId,text:`---\nstatus: sourced\nmember_id: ${id}\ndisplay_name: ${JSON.stringify(owner.name||'Unconfirmed')}\nespn_member_id: ${JSON.stringify(owner.espnMemberId)}\nwhatsapp_identity: TODO\n---\n# ${clean(owner.name)}\n\n## Identity and team mapping\nESPN supplied this owner name; preferred name and WhatsApp identity await the owner confirmation.\n${owner.teams.map(t=>`- ${directory.season}: ${clean(t.name)} (team ID ${t.id}).`).join('\n')}\n\n## Provenance\nSource: ESPN league ${directory.leagueId}, season ${directory.season}. Retrieved ${directory.fetchedAt}.\nLeague: https://fantasy.espn.com/football/league?leagueId=${directory.leagueId}\n\n## Community connection\nNot supplied. Do not infer personal affiliations from league membership.\n\n## Approved league history\nNo imported historical record yet.\n\n## Approved personal stories and running jokes\nNone supplied. Private WhatsApp suggestions require the owner review.\n\n## Boundaries and corrections\nNo sensitive personal stories approved. Record sources and approval references for future edits.\n`};
  });
}




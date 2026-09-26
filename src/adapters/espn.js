export function normalize(raw,{season,week,leagueId}){
  if(!Array.isArray(raw.teams)||!Array.isArray(raw.schedule))throw new Error('Unexpected ESPN response');
  const teams=new Map(raw.teams.map(t=>[t.id,{name:t.name||`${t.location||''} ${t.nickname||''}`.trim()||`Team ${t.id}`,logo:t.logo||null,logoType:t.logoType||null}]));
  const games=raw.schedule.filter(m=>m.matchupPeriodId===week&&m.home&&m.away);
  if(!games.length)throw new Error('No completed matchup data for requested period');
  const side=s=>{if(!Number.isFinite(s.totalPoints))throw new Error('Missing score');const team=teams.get(s.teamId)||{};return {teamId:s.teamId,name:team.name||`Team ${s.teamId}`,score:s.totalPoints,logo:team.logo||null,logoType:team.logoType||null};};
  if(games.some(g=>!['HOME','AWAY','TIE'].includes(g.winner)))throw new Error('Matchup period is not final');
  return {season,week,leagueId,source:'espn',fetchedAt:new Date().toISOString(),final:true,matchups:games.map(g=>({id:g.id,home:side(g.home),away:side(g.away),winner:g.winner})),standings:raw.teams.map(t=>({teamId:t.id,name:teams.get(t.id)?.name||`Team ${t.id}`,logo:teams.get(t.id)?.logo||null,logoType:teams.get(t.id)?.logoType||null,wins:t.record?.overall?.wins??null,losses:t.record?.overall?.losses??null,pointsFor:t.record?.overall?.pointsFor??null})),transactions:[],transactionsStatus:'unavailable: transaction feed not configured',rosters:raw.teams.map(t=>({teamId:t.id,entries:t.roster?.entries||[]}))};
}
export async function fetchLeague(env,views=['mTeam','mSettings'],options={}){
  const season=Number(env.ESPN_SEASON),leagueId=env.ESPN_LEAGUE_ID;
  if(!Number.isInteger(season)||season<2000||!/^\d+$/.test(leagueId||''))throw new Error('Configure valid ESPN league and season');
  // ESPN's fantasy endpoint is undocumented. Fail closed on schema changes.
  const params=new URLSearchParams(views.map(view=>['view',view]));
  if(options.scoringPeriodId!==undefined){const period=Number(options.scoringPeriodId);if(!Number.isInteger(period)||period<1||period>25)throw new Error('Invalid ESPN scoring period');params.set('scoringPeriodId',String(period));}
  const url=`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${leagueId}?${params}`;
  if(Boolean(env.ESPN_S2)!==Boolean(env.SWID))throw new Error('Private ESPN access requires both ESPN_S2 and SWID in the local .env file');
  const headers={};if(env.ESPN_S2&&env.SWID)headers.Cookie=`espn_s2=${env.ESPN_S2}; SWID=${env.SWID}`;
  if(options.filter&&typeof options.filter==='object')headers['X-Fantasy-Filter']=JSON.stringify(options.filter);
  const response=await fetch(url,{headers,signal:AbortSignal.timeout(30000)});
  if([401,403].includes(response.status))throw new Error('ESPN private-league access required. Set ESPN_S2 and SWID locally; do not paste them into chat.');
  if(!response.ok)throw new Error(`ESPN fetch failed (${response.status})`);
  let raw;try{raw=await response.json();}catch{throw new Error('ESPN returned an unexpected response; check access and season');}
  if(String(raw.id)!==String(leagueId)||raw.seasonId!==season||!Array.isArray(raw.teams)||!raw.teams.length)throw new Error('ESPN returned a different league/season or an invalid roster');
  return raw;
}
export async function ingest(env,week){
  if(!Number.isInteger(week)||week<1||week>25)throw new Error('Configure valid ESPN matchup period');
  return normalize(await fetchLeague(env,['mMatchup','mTeam','mRoster']),{season:Number(env.ESPN_SEASON),week,leagueId:env.ESPN_LEAGUE_ID});
}
export async function latestFinalized(env){
  const status=await fetchLeague(env,['mTeam','mStatus']);
  const latest=Math.min(Number(status.status?.latestScoringPeriod||status.status?.currentMatchupPeriod||0),25);
  if(!Number.isInteger(latest)||latest<1)throw new Error('ESPN has no active scoring period');
  for(let week=latest;week>=1;week--){
    try{return await ingest(env,week);}catch(error){if(!/No completed matchup data|not final/.test(error.message))throw error;}
  }
  throw new Error('ESPN has no finalized matchup period yet');
}
export function directory(raw){
  const members=new Map((raw.members||[]).map(m=>[m.id,m]));
  return {leagueId:String(raw.id),season:raw.seasonId,name:raw.settings?.name||'Unnamed league',fetchedAt:new Date().toISOString(),teams:raw.teams.map(t=>({id:t.id,name:t.name||`${t.location||''} ${t.nickname||''}`.trim()||`Team ${t.id}`,owners:(t.owners||[]).map(id=>{const m=members.get(id);return {espnMemberId:id,name:m?([m.firstName,m.lastName].filter(Boolean).join(' ')||m.displayName||null):null};})}))};
}




import { fetchLeague } from './adapters/espn.js';
import { resolveManagedTeam } from './espn-lineup.js';

const POSITIONS={1:'QB',2:'RB',3:'WR',4:'TE',5:'K',16:'D/ST'};
const STARTERS={1:1,2:2,3:2,4:1,5:1,16:1};
const round=value=>Number(Number(value||0).toFixed(2));
const median=values=>{const sorted=[...values].sort((a,b)=>a-b);return sorted.length?sorted.length%2?sorted[(sorted.length-1)/2]:(sorted[sorted.length/2-1]+sorted[sorted.length/2])/2:0;};
const ordinal=value=>{const n=Number(value),mod100=n%100;return `${n}${mod100>=11&&mod100<=13?'th':n%10===1?'st':n%10===2?'nd':n%10===3?'rd':'th'}`;};
const stat=(player,season,period,source,split)=>round(player?.stats?.find(item=>item.seasonId===season&&item.scoringPeriodId===period&&item.statSourceId===source&&item.statSplitTypeId===split)?.appliedTotal||0);

function player(entry,season,week){
  const raw=entry.playerPoolEntry?.player||entry.player;
  const positionId=Number(raw?.defaultPositionId);
  return {playerId:Number(entry.playerId??entry.id),name:raw?.fullName||`Player ${entry.playerId??entry.id}`,positionId,position:POSITIONS[positionId]||`POS ${positionId}`,weekProjection:stat(raw,season,week,1,1),rosProjection:stat(raw,season,0,1,0),seasonPoints:stat(raw,season,0,0,0),percentOwned:round(raw?.ownership?.percentOwned),injuryStatus:raw?.injuryStatus||entry.injuryStatus||'ACTIVE',lineupSlotId:entry.lineupSlotId??null,onTeamId:Number(entry.onTeamId||entry.playerPoolEntry?.onTeamId||0),availability:entry.status||entry.playerPoolEntry?.status||null};
}

function rosterPlayers(team,season,week){return (team.roster?.entries||[]).map(entry=>player(entry,season,week)).filter(item=>POSITIONS[item.positionId]);}
function strength(players,positionId){return [...players].filter(item=>item.positionId===positionId).sort((a,b)=>b.rosProjection-a.rosProjection).slice(0,STARTERS[positionId]).reduce((sum,item)=>sum+item.rosProjection,0);}
function needsFor(players,leagueMedians,leagueStrengths){return Object.keys(POSITIONS).map(Number).map(positionId=>{const value=round(strength(players,positionId)),rankings=leagueStrengths.get(positionId)||[];return {positionId,position:POSITIONS[positionId],strength:value,leagueMedian:round(leagueMedians.get(positionId)||0),deficit:round((leagueMedians.get(positionId)||0)-value),rank:1+rankings.filter(item=>item>value).length,leagueSize:rankings.length};}).sort((a,b)=>b.deficit-a.deficit);}
function surplusFor(players,replacement){
  return Object.keys(POSITIONS).map(Number).flatMap(positionId=>[...players].filter(item=>item.positionId===positionId).sort((a,b)=>b.rosProjection-a.rosProjection).slice(STARTERS[positionId]).map(item=>({...item,tradeValue:round(Math.max(0,item.rosProjection-(replacement.get(positionId)||0)))}))).filter(item=>item.tradeValue>0).sort((a,b)=>b.tradeValue-a.tradeValue);
}
function lineupProjection(players,key='weekProjection'){
  const remaining=new Map(),direct=Object.keys(POSITIONS).map(Number).reduce((total,positionId)=>{
    const sorted=players.filter(item=>item.positionId===positionId).sort((a,b)=>b[key]-a[key]),count=STARTERS[positionId];
    remaining.set(positionId,sorted.slice(count));return total+sorted.slice(0,count).reduce((sum,item)=>sum+item[key],0);
  },0);
  const flex=[...(remaining.get(2)||[]),...(remaining.get(3)||[]),...(remaining.get(4)||[])].sort((a,b)=>b[key]-a[key])[0];
  return round(direct+(flex?.[key]||0));
}
function afterTrade(players,outgoing,incoming){return players.filter(item=>item.playerId!==outgoing.playerId).concat({...incoming});}
function acceptanceOutlook(partnerRosGain,partnerWeeklyGain,imbalance){return partnerRosGain>=15&&partnerWeeklyGain>=0&&imbalance<=0.25?'High':partnerRosGain>=5&&imbalance<=0.45?'Moderate':'Low';}

export function analyzeFantasyGm(raw,env,week){
  const season=raw.seasonId,managed=resolveManagedTeam(raw,env);
  const rosters=new Map(raw.teams.map(team=>[team.id,rosterPlayers(team,season,week)]));
  const available=(raw.players||[]).filter(entry=>Number(entry.onTeamId||0)===0&&['FREEAGENT','WAIVERS'].includes(entry.status)).map(entry=>player(entry,season,week)).filter(item=>POSITIONS[item.positionId]&&!['OUT','INJURY_RESERVE'].includes(item.injuryStatus));
  const allPlayers=[...rosters.values()].flat().concat(available);
  const replacement=new Map(Object.keys(POSITIONS).map(Number).map(positionId=>{const rank=positionId===2||positionId===3?30:12;const list=allPlayers.filter(item=>item.positionId===positionId).sort((a,b)=>b.rosProjection-a.rosProjection);return [positionId,list[Math.min(rank-1,list.length-1)]?.rosProjection||0];}));
  const leagueStrengths=new Map(Object.keys(POSITIONS).map(Number).map(positionId=>[positionId,[...rosters.values()].map(players=>round(strength(players,positionId))).sort((a,b)=>b-a)]));
  const leagueMedians=new Map(Object.keys(POSITIONS).map(Number).map(positionId=>[positionId,median(leagueStrengths.get(positionId))]));
  const mine=rosters.get(managed.id)||[];
  const needs=needsFor(mine,leagueMedians,leagueStrengths);
  const dropPool=[...mine].sort((a,b)=>a.rosProjection-b.rosProjection||a.weekProjection-b.weekProjection);
  const freeAgents=Object.keys(POSITIONS).map(Number).map(positionId=>{
    const targets=available.filter(item=>item.positionId===positionId).sort((a,b)=>b.rosProjection-a.rosProjection||b.weekProjection-a.weekProjection||b.percentOwned-a.percentOwned).slice(0,3);
    const samePosition=[...mine].filter(item=>item.positionId===positionId).sort((a,b)=>a.rosProjection-b.rosProjection);
    return {position:POSITIONS[positionId],targets:targets.map(target=>{const drop=samePosition[0]||dropPool[0]||null;return {...target,suggestedDrop:drop?{playerId:drop.playerId,name:drop.name,position:drop.position,rosProjection:drop.rosProjection}:null,projectedUpgrade:drop?round(target.rosProjection-drop.rosProjection):null};})};
  });
  const mySurplus=surplusFor(mine,replacement),tradeIdeas=[];
  for(const team of raw.teams.filter(team=>team.id!==managed.id)){
    const theirs=rosters.get(team.id)||[],theirNeeds=needsFor(theirs,leagueMedians,leagueStrengths).filter(item=>item.deficit>0),theirSurplus=surplusFor(theirs,replacement);
    for(const receive of theirSurplus.filter(item=>needs.slice(0,3).some(need=>need.positionId===item.positionId))){
      for(const give of mySurplus.filter(item=>theirNeeds.slice(0,3).some(need=>need.positionId===item.positionId))){
        const max=Math.max(receive.tradeValue,give.tradeValue,1),imbalance=Math.abs(receive.tradeValue-give.tradeValue)/max;
        if(imbalance>0.65)continue;
        const myGain=round(lineupProjection(afterTrade(mine,give,receive))-lineupProjection(mine));
        const partnerGain=round(lineupProjection(afterTrade(theirs,receive,give))-lineupProjection(theirs));
        const myRosGain=round(lineupProjection(afterTrade(mine,give,receive),'rosProjection')-lineupProjection(mine,'rosProjection'));
        const partnerRosGain=round(lineupProjection(afterTrade(theirs,receive,give),'rosProjection')-lineupProjection(theirs,'rosProjection'));
        if(myRosGain<=0||partnerRosGain<=0)continue;
        const partnerNeed=theirNeeds.find(item=>item.positionId===give.positionId),myNeed=needs.find(item=>item.positionId===receive.positionId);
        const partnerRank=`${ordinal(partnerNeed.rank)} of ${partnerNeed.leagueSize}`;
        const talkingPoints=[`${team.name.trim()} currently ranks ${partnerRank} at ${give.position}.`,`${give.name} projects to add ${partnerRosGain.toFixed(2)} rest-of-season points to their best starting lineup.`,`They can deal from ${receive.position} depth while the exchange projects to improve both starting lineups: +${partnerRosGain.toFixed(2)} for them and +${myRosGain.toFixed(2)} for you.`];
        const suggestedMessage=`Your ${give.position} group currently ranks ${partnerRank} in the league. ${give.name} projects to add ${partnerRosGain.toFixed(2)} rest-of-season points to your best lineup, and you have enough ${receive.position} depth to move ${receive.name}. The projections improve both of our starting lineups, so would you consider ${give.name} for ${receive.name}?`;
        tradeIdeas.push({teamId:team.id,teamName:team.name,give,receive,myWeeklyGain:myGain,partnerWeeklyGain:partnerGain,myRosGain,partnerRosGain,acceptanceOutlook:acceptanceOutlook(partnerRosGain,partnerGain,imbalance),partnerReason:`${team.name.trim()} gains ${partnerRosGain.toFixed(2)} projected rest-of-season starting-lineup points at ${give.position}, where it currently ranks ${partnerRank}, while dealing from ${receive.position} depth.`,talkingPoints,suggestedMessage,valueDifference:round(receive.tradeValue-give.tradeValue),fitScore:round((1-imbalance)*100+myRosGain+partnerRosGain+(myNeed?.deficit||0)+(partnerNeed?.deficit||0))});
      }
    }
  }
  const unique=[];for(const idea of tradeIdeas.sort((a,b)=>b.fitScore-a.fitScore)){if(unique.some(item=>item.teamId===idea.teamId||item.give.playerId===idea.give.playerId&&item.receive.playerId===idea.receive.playerId))continue;unique.push(idea);if(unique.length===5)break;}
  return {season,week,generatedAt:new Date().toISOString(),leagueId:String(raw.id),teamId:managed.id,teamName:managed.name.trim(),needs:needs.map(item=>({...item,classification:item.deficit>0?'below league median':'at or above league median'})),freeAgents,trades:unique,boundary:'Recommendations only. No player was added, dropped, claimed, bid on, or offered in a trade.'};
}

export async function buildFantasyGmReport(env,week){
  const filter={players:{filterStatus:{value:['FREEAGENT','WAIVERS']},limit:500,offset:0,sortPercOwned:{sortPriority:1,sortAsc:false}}};
  const raw=await fetchLeague(env,['mTeam','mRoster','mSettings','mStatus','kona_player_info'],{scoringPeriodId:week,filter});
  return analyzeFantasyGm(raw,env,week);
}

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export function renderFantasyGmReport(report){
  const needs=report.needs.map(item=>`<tr><td style="padding:7px;border-bottom:1px solid #dce3e8"><strong>${esc(item.position)}</strong></td><td style="padding:7px;text-align:center;border-bottom:1px solid #dce3e8"><strong>${ordinal(item.rank)} of ${item.leagueSize}</strong></td><td style="padding:7px;text-align:right;border-bottom:1px solid #dce3e8">${item.strength.toFixed(2)}</td><td style="padding:7px;text-align:right;border-bottom:1px solid #dce3e8">${item.leagueMedian.toFixed(2)}</td><td style="padding:7px;border-bottom:1px solid #dce3e8">${esc(item.classification)}</td></tr>`).join('');
  const agents=report.freeAgents.map(group=>`<h3 style="color:#1b3a63;margin:22px 0 8px">${esc(group.position)}</h3>${group.targets.length?group.targets.map(item=>`<div style="margin:0 0 10px;padding:12px;border-left:4px solid #1b3a63;background:#f4f7f9"><strong>${esc(item.name)}</strong> · ${item.availability==='WAIVERS'?'Waivers':'Free agent'}<br><span style="font:13px Arial,sans-serif;color:#526678">Week ${item.weekProjection.toFixed(2)} · Rest of season ${item.rosProjection.toFixed(2)} · ${item.percentOwned.toFixed(1)}% owned${item.suggestedDrop?` · Compare with ${esc(item.suggestedDrop.name)} (${item.suggestedDrop.rosProjection.toFixed(2)} ROS) · ${item.projectedUpgrade>=0?'+':''}${item.projectedUpgrade.toFixed(2)} projected ROS`:''}</span></div>`).join(''):'<p>No eligible option returned by ESPN.</p>'}`).join('');
  const trades=report.trades.length?report.trades.map(item=>`<div style="margin:0 0 12px;padding:14px;border:1px solid #d8c9a7;border-radius:8px;background:#fbf8f1"><strong>${esc(item.teamName)}</strong> · Acceptance outlook: <strong>${esc(item.acceptanceOutlook)}</strong><br>Offer <strong>${esc(item.give.name)} (${esc(item.give.position)})</strong> for <strong>${esc(item.receive.name)} (${esc(item.receive.position)})</strong>.<br><span style="font:13px Arial,sans-serif;color:#526678">Your ROS lineup gain: ${item.myRosGain>=0?'+':''}${item.myRosGain.toFixed(2)} · Their ROS lineup gain: ${item.partnerRosGain>=0?'+':''}${item.partnerRosGain.toFixed(2)}<br>Your Week ${report.week} effect: ${item.myWeeklyGain>=0?'+':''}${item.myWeeklyGain.toFixed(2)} · Their Week ${report.week} effect: ${item.partnerWeeklyGain>=0?'+':''}${item.partnerWeeklyGain.toFixed(2)} · Value difference: ${item.valueDifference>=0?'+':''}${item.valueDifference.toFixed(2)} in your favor.</span><p style="margin:8px 0 0;font:13px/1.45 Arial,sans-serif;color:#182b3b"><strong>Why they might accept:</strong> ${esc(item.partnerReason)}</p><p style="margin:8px 0 2px;font:700 13px Arial,sans-serif;color:#1b3a63">Talking points</p><ul style="margin:4px 0 10px;padding-left:20px;font:13px/1.45 Arial,sans-serif">${item.talkingPoints.map(point=>`<li>${esc(point)}</li>`).join('')}</ul><p style="margin:8px 0 4px;font:700 13px Arial,sans-serif;color:#1b3a63">Suggested trade message</p><div style="padding:10px;border-left:3px solid #1b3a63;background:white;font:13px/1.5 Arial,sans-serif">${esc(item.suggestedMessage)}</div></div>`).join(''):'<p>No trade improved both teams’ projected rest-of-season starting lineups. ChatPDT declines to invent one.</p>';
  const html=`<!doctype html><html><body style="margin:0;padding:18px;background:#eef2f5"><main style="max-width:720px;margin:auto;padding:26px;background:white;font:15px/1.55 Arial,sans-serif;color:#182b3b"><h1 style="color:#1b3a63">ChatPDT Fantasy GM — Week ${report.week}</h1><p><strong>${esc(report.teamName)}</strong></p><div style="padding:13px;background:#fff4cc;border:1px solid #d6a928"><strong>Advisory report only.</strong> No roster acquisition, drop, waiver bid, or trade offer was submitted.</div><h2 style="color:#1b3a63">Roster needs</h2><table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse"><tr><th align="left">Position</th><th>League rank</th><th align="right">Your strength</th><th align="right">League median</th><th align="left">Assessment</th></tr>${needs}</table><h2 style="color:#1b3a63">Available players by position</h2>${agents}<h2 style="color:#1b3a63">Potential trade conversations</h2>${trades}<p style="margin-top:28px;font-size:12px;color:#6b7280">ESPN projections change. Injuries, roles, schedules, keeper value, and personal trade preferences require the owner’s judgment before any transaction.</p></main></body></html>`;
  const text=[`ChatPDT Fantasy GM — Week ${report.week}`,report.teamName,report.boundary,'','ROSTER NEEDS',...report.needs.map(item=>`${item.position}: ${ordinal(item.rank)} of ${item.leagueSize}; ${item.strength.toFixed(2)} vs league median ${item.leagueMedian.toFixed(2)} (${item.classification})`),'','AVAILABLE PLAYERS',...report.freeAgents.flatMap(group=>[group.position,...group.targets.map(item=>`- ${item.name}: Week ${item.weekProjection.toFixed(2)}, ROS ${item.rosProjection.toFixed(2)}, ${item.percentOwned.toFixed(1)}% owned${item.suggestedDrop?`; possible drop ${item.suggestedDrop.name}`:''}`)]),'','TRADE CONVERSATIONS',...(report.trades.length?report.trades.flatMap(item=>[`- ${item.teamName}: offer ${item.give.name} for ${item.receive.name}. Acceptance ${item.acceptanceOutlook}. ROS gains: you ${item.myRosGain>=0?'+':''}${item.myRosGain.toFixed(2)}, them ${item.partnerRosGain>=0?'+':''}${item.partnerRosGain.toFixed(2)}. Week ${report.week}: you ${item.myWeeklyGain>=0?'+':''}${item.myWeeklyGain.toFixed(2)}, them ${item.partnerWeeklyGain>=0?'+':''}${item.partnerWeeklyGain.toFixed(2)}. ${item.partnerReason}`,...item.talkingPoints.map(point=>`  • ${point}`),`  Suggested message: ${item.suggestedMessage}`]):['No trade improved both projected rest-of-season starting lineups.'])].join('\n');
  return {html,text};
}


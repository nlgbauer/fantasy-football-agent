import { hash } from './store.js';
import { fetchLeague } from './adapters/espn.js';

const BENCH = 20;
const IR = 21;
const SLOT_NAMES = {0:'QB',2:'RB',4:'WR',6:'TE',16:'D/ST',17:'K',20:'Bench',21:'IR',23:'FLEX'};
const POSITION_NAMES = {1:'QB',2:'RB',3:'WR',4:'TE',5:'K',16:'D/ST'};
const cleanId = value => String(value || '').replace(/[{}]/g, '').toLowerCase();
const round = value => Number(Number(value || 0).toFixed(2));

function projection(entry, season, scoringPeriodId) {
  return round(entry.playerPoolEntry?.player?.stats?.find(stat =>
    stat.seasonId === season && stat.scoringPeriodId === scoringPeriodId && stat.statSourceId === 1 && stat.statSplitTypeId === 1
  )?.appliedTotal || 0);
}

function actual(entry, season, scoringPeriodId) {
  return round(entry.playerPoolEntry?.player?.stats?.find(stat =>
    stat.seasonId === season && stat.scoringPeriodId === scoringPeriodId && stat.statSourceId === 0 && stat.statSplitTypeId === 1
  )?.appliedTotal || 0);
}

export function resolveManagedTeam(raw, env) {
  const owner = cleanId(env.SWID);
  if (!owner) throw new Error('SWID is required to verify the managed ESPN team');
  const owned = raw.teams.filter(team => (team.owners || []).some(id => cleanId(id) === owner));
  const requested = env.ESPN_TEAM_ID ? Number(env.ESPN_TEAM_ID) : null;
  if (requested !== null && (!Number.isInteger(requested) || requested < 1)) throw new Error('ESPN_TEAM_ID must be a positive integer');
  const team = requested === null ? (owned.length === 1 ? owned[0] : null) : raw.teams.find(item => item.id === requested);
  if (!team) throw new Error(owned.length > 1 ? 'Set ESPN_TEAM_ID because this account owns multiple teams' : 'Could not identify the owner’s ESPN team');
  if (!(team.owners || []).some(id => cleanId(id) === owner)) throw new Error('Refusing to manage a team not owned by the authenticated ESPN account');
  return team;
}

function activeSlots(raw) {
  const counts = raw.settings?.rosterSettings?.lineupSlotCounts || {};
  return Object.entries(counts)
    .filter(([slot, count]) => ![BENCH, IR].includes(Number(slot)) && Number(count) > 0)
    .flatMap(([slot, count]) => Array(Number(count)).fill(Number(slot)));
}

function rosterDigest(team, scoringPeriodId) {
  return hash({teamId:team.id,scoringPeriodId,roster:(team.roster?.entries || []).map(entry=>({playerId:entry.playerId,lineupSlotId:entry.lineupSlotId})).sort((a,b)=>a.playerId-b.playerId)});
}

function bestAssignment(players, slots) {
  const ordered = slots.map((slot,index)=>({slot,index,eligible:players.filter(player=>player.eligibleSlots.includes(slot)).length}))
    .sort((a,b)=>a.eligible-b.eligible||a.slot-b.slot||a.index-b.index);
  const memo = new Map();
  const visit = (index, mask) => {
    if (index === ordered.length) return {score:0,changes:0,picks:[]};
    const key = `${index}:${mask}`;
    if (memo.has(key)) return memo.get(key);
    const current = ordered[index];
    let best = null;
    for (let playerIndex=0; playerIndex<players.length; playerIndex++) {
      if ((mask & (1 << playerIndex)) || !players[playerIndex].eligibleSlots.includes(current.slot)) continue;
      const tail = visit(index + 1, mask | (1 << playerIndex));
      if (!tail) continue;
      const candidate = {score:players[playerIndex].projected+tail.score,changes:(players[playerIndex].fromLineupSlotId===current.slot?0:1)+tail.changes,picks:[{playerIndex,slot:current.slot},...tail.picks]};
      const scoreDelta = best ? candidate.score-best.score : Infinity;
      const tied = Math.abs(scoreDelta) < 1e-9;
      if (!best || scoreDelta > 1e-9 || (tied && candidate.changes < best.changes) || (tied && candidate.changes === best.changes && players[playerIndex].playerId < players[best.picks[0].playerIndex].playerId)) best = candidate;
    }
    memo.set(key,best);
    return best;
  };
  return visit(0,0);
}

export function analyzeHistoricalLineup(raw, env, scoringPeriodId) {
  const season=raw.seasonId,team=resolveManagedTeam(raw,env),slots=activeSlots(raw);
  if(!slots.length)throw new Error('ESPN roster settings contain no active lineup slots');
  const players=(team.roster?.entries||[]).filter(entry=>Number(entry.lineupSlotId)!==IR).map(entry=>({
    playerId:Number(entry.playerId),
    name:entry.playerPoolEntry?.player?.fullName||`Player ${entry.playerId}`,
    position:POSITION_NAMES[Number(entry.playerPoolEntry?.player?.defaultPositionId)]||'Player',
    fromLineupSlotId:Number(entry.lineupSlotId),
    eligibleSlots:(entry.playerPoolEntry?.player?.eligibleSlots||[]).map(Number),
    actual:actual(entry,season,scoringPeriodId)
  }));
  const candidates=players.filter(player=>player.eligibleSlots.some(slot=>slots.includes(slot))).map(player=>({...player,projected:player.actual}));
  const optimized=bestAssignment(candidates,slots);
  if(!optimized)throw new Error('No complete legal historical lineup can be built from the ESPN roster');
  const selected=new Map(optimized.picks.map(item=>[candidates[item.playerIndex].playerId,item.slot]));
  const starters=players.filter(player=>![BENCH,IR].includes(player.fromLineupSlotId)).sort((a,b)=>b.actual-a.actual||a.name.localeCompare(b.name));
  const bench=players.filter(player=>player.fromLineupSlotId===BENCH).sort((a,b)=>b.actual-a.actual||a.name.localeCompare(b.name));
  const currentPoints=round(starters.reduce((sum,player)=>sum+player.actual,0)),optimizedPoints=round(optimized.score);
  const promoted=candidates.filter(player=>player.fromLineupSlotId===BENCH&&selected.has(player.playerId));
  const demoted=candidates.filter(player=>player.fromLineupSlotId!==BENCH&&!selected.has(player.playerId));
  const usedDemoted=new Set(),swaps=promoted.map(player=>{
    const targetSlot=selected.get(player.playerId);
    const replaced=demoted.filter(item=>!usedDemoted.has(item.playerId)&&item.fromLineupSlotId===targetSlot).sort((a,b)=>a.actual-b.actual)[0]||demoted.filter(item=>!usedDemoted.has(item.playerId)&&player.eligibleSlots.includes(item.fromLineupSlotId)).sort((a,b)=>a.actual-b.actual)[0]||null;
    if(replaced)usedDemoted.add(replaced.playerId);
    return {start:{playerId:player.playerId,name:player.name,position:player.position,points:player.actual},bench:replaced?{playerId:replaced.playerId,name:replaced.name,position:replaced.position,points:replaced.actual}:null,gain:round(player.actual-(replaced?.actual||0))};
  }).filter(item=>item.gain>0);
  const starterCount=starters.length;
  return {week:scoringPeriodId,teamId:team.id,teamName:team.name.trim(),starters:starters.map(({playerId,name,position,actual})=>({playerId,name,position,points:actual})),bench:bench.map(({playerId,name,position,actual})=>({playerId,name,position,points:actual})),starterPoints:currentPoints,benchPoints:round(bench.reduce((sum,player)=>sum+player.actual,0)),starterAverage:round(currentPoints/Math.max(starterCount,1)),benchAverage:round(bench.reduce((sum,player)=>sum+player.actual,0)/Math.max(bench.length,1)),optimizedPoints,optimizedStarterAverage:round(optimizedPoints/Math.max(starterCount,1)),missedPoints:round(optimizedPoints-currentPoints),swaps};
}

export function buildLineupPlan(raw, env, scoringPeriodId = raw.status?.currentMatchupPeriod) {
  const season = raw.seasonId;
  if (!Number.isInteger(scoringPeriodId) || scoringPeriodId < 1 || scoringPeriodId > 25) throw new Error('Invalid ESPN scoring period');
  const team = resolveManagedTeam(raw, env);
  const slots = activeSlots(raw);
  if (!slots.length) throw new Error('ESPN roster settings contain no active lineup slots');
  const entries = (team.roster?.entries || []).map(entry=>({
    playerId:Number(entry.playerId),
    name:entry.playerPoolEntry?.player?.fullName || `Player ${entry.playerId}`,
    fromLineupSlotId:Number(entry.lineupSlotId),
    eligibleSlots:(entry.playerPoolEntry?.player?.eligibleSlots || []).map(Number),
    projected:projection(entry,season,scoringPeriodId),
    locked:Boolean(entry.playerPoolEntry?.lineupLocked || entry.playerPoolEntry?.rosterLocked),
    injuryStatus:entry.injuryStatus || entry.playerPoolEntry?.player?.injuryStatus || 'ACTIVE'
  }));
  if (entries.length > 30) throw new Error('Unexpected ESPN roster size');
  const remainingSlots = [...slots];
  const fixed = [];
  for (const player of entries.filter(item=>item.locked && ![BENCH,IR].includes(item.fromLineupSlotId))) {
    const index = remainingSlots.indexOf(player.fromLineupSlotId);
    if (index < 0) throw new Error('Locked lineup does not match ESPN roster settings');
    remainingSlots.splice(index,1);
    fixed.push({playerId:player.playerId,slot:player.fromLineupSlotId,projected:player.projected});
  }
  const candidates = entries.filter(player=>!player.locked && player.fromLineupSlotId!==IR && player.eligibleSlots.some(slot=>remainingSlots.includes(slot)));
  const optimized = bestAssignment(candidates,remainingSlots);
  if (!optimized) throw new Error('No complete legal lineup can be built from the current roster');
  const selected = new Map([...fixed.map(item=>[item.playerId,item.slot]),...optimized.picks.map(item=>[candidates[item.playerIndex].playerId,item.slot])]);
  const currentProjected = round(entries.filter(player=>![BENCH,IR].includes(player.fromLineupSlotId)).reduce((sum,player)=>sum+player.projected,0));
  const optimizedProjected = round(fixed.reduce((sum,player)=>sum+player.projected,0)+optimized.score);
  const moves = entries.filter(player=>!player.locked && player.fromLineupSlotId!==IR)
    .map(player=>({...player,toLineupSlotId:selected.get(player.playerId) ?? BENCH}))
    .filter(player=>player.fromLineupSlotId!==player.toLineupSlotId)
    .map(player=>({playerId:player.playerId,name:player.name,fromLineupSlotId:player.fromLineupSlotId,toLineupSlotId:player.toLineupSlotId,fromSlotName:SLOT_NAMES[player.fromLineupSlotId]||`Slot ${player.fromLineupSlotId}`,toSlotName:SLOT_NAMES[player.toLineupSlotId]||`Slot ${player.toLineupSlotId}`,projected:player.projected,injuryStatus:player.injuryStatus}));
  const plan = {season,leagueId:String(raw.id),scoringPeriodId,teamId:team.id,teamName:team.name,moves,currentProjected,optimizedProjected,projectedGain:round(optimizedProjected-currentProjected),rosterDigest:rosterDigest(team,scoringPeriodId)};
  plan.id = hash(plan);
  return plan;
}

function validateLineupOnly(plan, raw, env) {
  const team = resolveManagedTeam(raw, env);
  if (team.id !== plan.teamId || String(raw.id) !== String(plan.leagueId) || raw.seasonId !== plan.season) throw new Error('Lineup plan does not match the authenticated league team');
  if (rosterDigest(team,plan.scoringPeriodId) !== plan.rosterDigest) throw new Error('ESPN roster changed after the lineup plan was created; generate a fresh plan');
  if (!Array.isArray(plan.moves) || plan.moves.length > 30) throw new Error('Invalid lineup move count');
  const entries = new Map((team.roster?.entries || []).map(entry=>[Number(entry.playerId),entry]));
  for (const move of plan.moves) {
    const entry = entries.get(Number(move.playerId));
    if (!entry || Number(entry.lineupSlotId)!==Number(move.fromLineupSlotId)) throw new Error('Lineup move no longer matches ESPN');
    if ([IR].includes(Number(move.fromLineupSlotId)) || [IR].includes(Number(move.toLineupSlotId))) throw new Error('IR changes are not permitted automatically');
    if (entry.playerPoolEntry?.lineupLocked || entry.playerPoolEntry?.rosterLocked) throw new Error('A proposed player is locked');
    if (!(entry.playerPoolEntry?.player?.eligibleSlots || []).map(Number).includes(Number(move.toLineupSlotId))) throw new Error('A proposed lineup slot is not eligible');
  }
  return team;
}

export async function executeLineupPlan(env, plan, {store}={}) {
  if (env.ESPN_LINEUP_WRITE_ENABLED !== 'true') throw new Error('Lineup writes are disabled; set ESPN_LINEUP_WRITE_ENABLED=true locally');
  if (!env.ESPN_S2 || !env.SWID) throw new Error('Authenticated ESPN cookies are required for lineup writes');
  const minimum = Number(env.ESPN_LINEUP_MIN_GAIN || 1);
  if (!Number.isFinite(minimum) || minimum < 0) throw new Error('ESPN_LINEUP_MIN_GAIN must be zero or greater');
  if (!plan.moves.length || plan.projectedGain < minimum) return {...plan,executed:false,reason:'below-threshold'};
  const current = await fetchLeague(env,['mTeam','mRoster','mSettings','mStatus'],{scoringPeriodId:plan.scoringPeriodId});
  validateLineupOnly(plan,current,env);
  const body = {teamId:plan.teamId,type:'ROSTER',scoringPeriodId:plan.scoringPeriodId,executionType:'EXECUTE',items:plan.moves.map(move=>({playerId:move.playerId,type:'LINEUP',fromLineupSlotId:move.fromLineupSlotId,toLineupSlotId:move.toLineupSlotId}))};
  const url=`https://lm-api-writes.fantasy.espn.com/apis/v3/games/ffl/seasons/${plan.season}/segments/0/leagues/${plan.leagueId}/transactions/`;
  store?.audit('lineup.executing',plan.id,{teamId:plan.teamId,scoringPeriodId:plan.scoringPeriodId,moves:plan.moves});
  const response = await fetch(url,{method:'POST',signal:AbortSignal.timeout(30000),headers:{Cookie:`espn_s2=${env.ESPN_S2}; SWID=${env.SWID}`,'Content-Type':'application/json','X-Fantasy-Platform':'kona-PROD-GCP','X-Fantasy-Source':'kona'},body:JSON.stringify(body)});
  if ([401,403].includes(response.status)) throw new Error('ESPN rejected lineup write authentication; refresh ESPN_S2 and SWID locally');
  if (!response.ok) throw new Error(`ESPN lineup write failed (${response.status})`);
  const updated = await fetchLeague(env,['mTeam','mRoster','mSettings','mStatus'],{scoringPeriodId:plan.scoringPeriodId});
  const team = resolveManagedTeam(updated,env);
  const positions = new Map((team.roster?.entries||[]).map(entry=>[Number(entry.playerId),Number(entry.lineupSlotId)]));
  if (plan.moves.some(move=>positions.get(move.playerId)!==move.toLineupSlotId)) throw new Error('ESPN accepted the request but the lineup could not be verified; inspect the team before retrying');
  store?.audit('lineup.executed',plan.id,{teamId:plan.teamId,scoringPeriodId:plan.scoringPeriodId,moves:plan.moves,projectedGain:plan.projectedGain});
  return {...plan,executed:true,verified:true};
}

export async function createCurrentLineupPlan(env) {
  const status = await fetchLeague(env,['mTeam','mSettings','mStatus']);
  const scoringPeriodId = status.status?.currentMatchupPeriod;
  const raw = await fetchLeague(env,['mTeam','mRoster','mSettings','mStatus'],{scoringPeriodId});
  return buildLineupPlan(raw,env,scoringPeriodId);
}

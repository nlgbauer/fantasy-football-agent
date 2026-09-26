const score=(player,season,period,split)=>player?.stats?.find(stat=>stat.seasonId===season&&stat.scoringPeriodId===period&&stat.statSourceId===0&&stat.statSplitTypeId===split)?.appliedTotal??0;
const round=value=>Number(Number(value||0).toFixed(2));

export function teamRosterInsights(team,{season,week}){
  const players=(team.roster?.entries||[]).map(entry=>({
    name:entry.playerPoolEntry?.player?.fullName||`Player ${entry.playerId}`,
    lineupSlotId:entry.lineupSlotId,
    week:round(score(entry.playerPoolEntry?.player,season,week,1)),
    season:round(score(entry.playerPoolEntry?.player,season,0,0))
  }));
  const starters=players.filter(player=>![20,21].includes(player.lineupSlotId));
  const bench=players.filter(player=>player.lineupSlotId===20);
  const top=(items,key,count=3)=>[...items].sort((a,b)=>b[key]-a[key]||a.name.localeCompare(b.name)).slice(0,count).map(player=>({name:player.name,points:player[key]}));
  const counter=team.transactionCounter||{};
  return {
    topWeek:top(starters,'week'),
    topSeason:top(players,'season'),
    topBench:top(bench,'week'),
    acquisitions:counter.acquisitions||0,
    drops:counter.drops||0,
    trades:counter.trades||0
  };
}

export const formatPlayers=players=>players.map(player=>`${player.name} ${player.points.toFixed(2)}`).join(' · ');




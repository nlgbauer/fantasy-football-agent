// Grounded, key-free preview. This does not pretend to be an AI-written newsletter.
export function emailPreview(s){
 const points=n=>Number(n).toFixed(2);
 const games=s.matchups.map(m=>{
  const margin=Math.abs(m.home.score-m.away.score),winner=m.home.score>=m.away.score?m.home:m.away,loser=winner===m.home?m.away:m.home;
  return {margin,winner,loser,line:margin===0?`${m.home.name} and ${m.away.name} tied at ${points(m.home.score)}.`:`${winner.name} defeated ${loser.name}, ${points(winner.score)}–${points(loser.score)} (margin: ${points(margin)}).`};
 });
 const high=s.matchups.flatMap(m=>[m.home,m.away]).sort((a,b)=>b.score-a.score)[0];
 const closest=[...games].sort((a,b)=>a.margin-b.margin)[0];
 return `MERIDIAN LEAGUE — WEEK ${s.week}\n\nDATA-ONLY PREVIEW\nVerified ESPN results; the AI editorial voice is not configured yet.\n\nTHE WEEK AT A GLANCE\n${high.name} posted the week's highest score: ${points(high.score)}. The closest matchup: ${closest.line}\n\nMATCHUP REPORT\n${games.map(g=>g.line).join('\n\n')}\n\nCURRENT RECORDS\nAs returned by ESPN on ${s.fetchedAt}; these may include adjustments after the recap week.\n${s.standings.map(t=>`${t.name}: ${t.wins??'unknown'} wins, ${t.losses??'unknown'} losses${t.ties!=null?`, ${t.ties} ties`:''}`).join('\n')}\n\nDATA NOTES\nTransactions: ${s.transactionsStatus}. External NFL news was not fetched. No personal anecdotes or historical claims have been added.\n\nSource: ESPN league ${s.leagueId}, ${s.season}, matchup period ${s.week}.`;
}




import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeHistoricalLineup, buildLineupPlan, executeLineupPlan, resolveManagedTeam } from '../src/espn-lineup.js';

const stat = points => ({seasonId:2026,scoringPeriodId:3,statSourceId:1,statSplitTypeId:1,appliedTotal:points});
const entry = (playerId,name,lineupSlotId,points,eligibleSlots=[0,20],locked=false) => ({
  playerId,lineupSlotId,injuryStatus:'ACTIVE',playerPoolEntry:{lineupLocked:locked,rosterLocked:false,player:{fullName:name,eligibleSlots,stats:[stat(points)]}}
});
const raw = entries => ({
  id:424242,seasonId:2026,status:{currentMatchupPeriod:3},settings:{rosterSettings:{lineupSlotCounts:{0:1,2:1,20:2}}},
  teams:[{id:11,name:'the owner Team',owners:['{owner-one}'],roster:{entries}}]
});
const env={ESPN_LEAGUE_ID:'424242',ESPN_SEASON:'2026',ESPN_S2:'secret',SWID:'{OWNER-ONE}',ESPN_LINEUP_WRITE_ENABLED:'true',ESPN_LINEUP_MIN_GAIN:'1'};

test('historical analysis separates starters and bench and finds the best legal missed start',()=>{
  const actualStat=points=>({seasonId:2026,scoringPeriodId:2,statSourceId:0,statSplitTypeId:1,appliedTotal:points});
  const historicalEntry=(playerId,name,lineupSlotId,points,positionId,eligibleSlots)=>({playerId,lineupSlotId,playerPoolEntry:{player:{fullName:name,defaultPositionId:positionId,eligibleSlots,stats:[actualStat(points)]}}});
  const historical={...raw([]),settings:{rosterSettings:{lineupSlotCounts:{0:1,2:1,20:2}}},teams:[{id:11,name:'the owner Team',owners:['{owner-one}'],roster:{entries:[
    historicalEntry(1,'Starting QB',0,20,1,[0,20]),historicalEntry(2,'Starting RB',2,5,2,[2,20]),
    historicalEntry(3,'Bench RB',20,12,2,[2,20]),historicalEntry(4,'Bench QB',20,3,1,[0,20])
  ]}}]};
  const analysis=analyzeHistoricalLineup(historical,env,2);
  assert.deepEqual(analysis.starters.map(item=>item.name),['Starting QB','Starting RB']);
  assert.deepEqual(analysis.bench.map(item=>item.name),['Bench RB','Bench QB']);
  assert.equal(analysis.starterPoints,25);
  assert.equal(analysis.benchPoints,15);
  assert.equal(analysis.starterAverage,12.5);
  assert.equal(analysis.benchAverage,7.5);
  assert.equal(analysis.optimizedPoints,32);
  assert.equal(analysis.optimizedStarterAverage,16);
  assert.equal(analysis.missedPoints,7);
  assert.deepEqual(analysis.swaps.map(item=>[item.start.name,item.bench.name,item.gain]),[['Bench RB','Starting RB',7]]);
});

test('optimizer swaps only eligible unlocked roster players and reports projected gain',()=>{
  const plan=buildLineupPlan(raw([
    entry(1,'Low QB',0,10,[0,20]),entry(2,'High QB',20,18,[0,20]),
    entry(3,'Running Back',2,12,[2,20]),entry(4,'Other Back',20,5,[2,20])
  ]),env,3);
  assert.equal(plan.teamId,11);
  assert.equal(plan.projectedGain,8);
  assert.deepEqual(plan.moves.map(move=>[move.playerId,move.fromLineupSlotId,move.toLineupSlotId]),[[1,0,20],[2,20,0]]);
});

test('equal-scoring assignments preserve existing starter slots to minimize changes',()=>{
  const plan=buildLineupPlan({
    ...raw([]),settings:{rosterSettings:{lineupSlotCounts:{2:1,23:1,20:2}}},
    teams:[{id:11,name:'the owner Team',owners:['{owner-one}'],roster:{entries:[
      entry(1,'Starting RB',2,20,[2,23,20]),entry(2,'Low Flex',23,5,[4,23,20]),
      entry(3,'Bench RB',20,15,[2,23,20]),entry(4,'Other Bench',20,1,[4,23,20])
    ]}}]
  },env,3);
  assert.deepEqual(plan.moves.map(move=>[move.playerId,move.fromLineupSlotId,move.toLineupSlotId]),[[2,23,20],[3,20,23]]);
});

test('locked starters stay fixed and another owner team is rejected',()=>{
  const plan=buildLineupPlan(raw([
    entry(1,'Locked QB',0,1,[0,20],true),entry(2,'High QB',20,30,[0,20]),
    entry(3,'Running Back',2,12,[2,20]),entry(4,'Other Back',20,5,[2,20])
  ]),env,3);
  assert.equal(plan.moves.length,0);
  assert.throws(()=>resolveManagedTeam(raw([]),{...env,SWID:'{someone-else}'}),/identify/);
});

test('write client emits LINEUP-only transaction and verifies ESPN result',async t=>{
  const before=raw([entry(1,'Low QB',0,10),entry(2,'High QB',20,18),entry(3,'Running Back',2,12,[2,20]),entry(4,'Other Back',20,5,[2,20])]);
  const plan=buildLineupPlan(before,env,3);
  const after=structuredClone(before);
  after.teams[0].roster.entries.find(item=>item.playerId===1).lineupSlotId=20;
  after.teams[0].roster.entries.find(item=>item.playerId===2).lineupSlotId=0;
  const calls=[];
  t.mock.method(globalThis,'fetch',async(url,options={})=>{
    calls.push({url,options});
    if(options.method==='POST')return new Response('{}',{status:200});
    return new Response(JSON.stringify(calls.some(call=>call.options.method==='POST')?after:before));
  });
  const result=await executeLineupPlan(env,plan);
  assert.equal(result.verified,true);
  const posted=JSON.parse(calls.find(call=>call.options.method==='POST').options.body);
  assert.equal(posted.type,'ROSTER');
  assert.ok(posted.items.every(item=>item.type==='LINEUP'));
  assert.deepEqual(new Set(posted.items.map(item=>item.playerId)),new Set([1,2]));
});

test('write client does nothing below configured gain and requires explicit enablement',async()=>{
  const plan=buildLineupPlan(raw([entry(1,'QB',0,10),entry(2,'Bench QB',20,10.5),entry(3,'RB',2,12,[2,20]),entry(4,'Bench RB',20,5,[2,20])]),env,3);
  assert.equal((await executeLineupPlan(env,plan)).executed,false);
  await assert.rejects(()=>executeLineupPlan({...env,ESPN_LINEUP_WRITE_ENABLED:'false'},plan),/disabled/);
});




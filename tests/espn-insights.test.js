import test from 'node:test';
import assert from 'node:assert/strict';
import { teamRosterInsights, formatPlayers } from '../src/espn-insights.js';

const stat=(period,split,total)=>({seasonId:2026,scoringPeriodId:period,statSourceId:0,statSplitTypeId:split,appliedTotal:total});
const entry=(name,lineupSlotId,week,season)=>({lineupSlotId,playerPoolEntry:{player:{fullName:name,stats:[stat(2,1,week),stat(0,0,season)]}}});

test('roster insights separate starters and bench while preserving transaction totals',()=>{
  const result=teamRosterInsights({roster:{entries:[entry('Starter',0,22,35),entry('Bench Star',20,31,40),entry('IR Player',21,50,50)]},transactionCounter:{acquisitions:7,drops:6,trades:1}},{season:2026,week:2});
  assert.deepEqual(result.topWeek,[{name:'Starter',points:22}]);
  assert.deepEqual(result.topBench,[{name:'Bench Star',points:31}]);
  assert.deepEqual(result.topSeason[0],{name:'IR Player',points:50});
  assert.equal(formatPlayers(result.topWeek),'Starter 22.00');
  assert.deepEqual({acquisitions:result.acquisitions,drops:result.drops,trades:result.trades},{acquisitions:7,drops:6,trades:1});
});




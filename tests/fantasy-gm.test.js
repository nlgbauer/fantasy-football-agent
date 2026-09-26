import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeFantasyGm, renderFantasyGmReport } from '../src/fantasy-gm.js';

const stat=(period,source,split,total)=>({seasonId:2026,scoringPeriodId:period,statSourceId:source,statSplitTypeId:split,appliedTotal:total});
const pool=(id,name,positionId,ros,week,onTeamId=0,status='FREEAGENT')=>({id,onTeamId,status,player:{id,fullName:name,defaultPositionId:positionId,injuryStatus:'ACTIVE',ownership:{percentOwned:25},stats:[stat(3,1,1,week),stat(0,1,0,ros),stat(0,0,0,10)]}});
const roster=(id,name,positionId,ros,week)=>({playerId:id,lineupSlotId:20,playerPoolEntry:pool(id,name,positionId,ros,week,1,'ONTEAM')});
const raw={id:424242,seasonId:2026,teams:[
  {id:11,name:'the owner Team',owners:['{owner}'],roster:{entries:[roster(1,'QB One',1,200,20),roster(2,'QB Surplus',1,150,15),roster(3,'WR Weak',3,30,3),roster(4,'WR Weaker',3,20,2)]}},
  {id:12,name:'Trade Partner',owners:['{other}'],roster:{entries:[roster(5,'QB Need',1,50,5),roster(6,'WR One',3,200,20),roster(7,'WR Two',3,190,19),roster(8,'WR Three',3,180,18),roster(9,'WR Surplus',3,160,16)]}}
],players:[pool(20,'Free Agent WR',3,120,12),pool(21,'Free Agent QB',1,90,9)]};
const env={SWID:'{OWNER}'};

test('Fantasy GM ranks available players, compares roster needs and proposes balanced trades without actions',()=>{
  const report=analyzeFantasyGm(raw,env,3);
  assert.equal(report.teamId,11);
  assert.equal(report.freeAgents.find(group=>group.position==='WR').targets[0].name,'Free Agent WR');
  assert.equal(report.freeAgents.find(group=>group.position==='WR').targets[0].suggestedDrop.name,'WR Weaker');
  assert.ok(report.needs.find(item=>item.position==='WR').deficit>0);
  const trade=report.trades.find(item=>item.give.name==='QB Surplus'&&item.receive.name==='WR Surplus');
  assert.ok(trade);
  assert.ok(trade.myRosGain>0);
  assert.ok(trade.partnerRosGain>0);
  assert.ok(trade.myWeeklyGain>0);
  assert.ok(trade.partnerWeeklyGain>0);
  assert.match(trade.acceptanceOutlook,/High|Moderate|Low/);
  assert.match(trade.partnerReason,/gains/);
  assert.match(report.boundary,/No player was added/);
});

test('Fantasy GM email escapes names and labels every result advisory',()=>{
  const report=analyzeFantasyGm(structuredClone(raw),env,3);report.teamName='<unsafe>';
  const rendered=renderFantasyGmReport(report);
  assert.ok(!rendered.html.includes('<unsafe>'));
  assert.match(rendered.html,/&lt;unsafe&gt;/);
  assert.match(rendered.html,/Advisory report only/);
  assert.match(rendered.html,/Why they might accept/);
  assert.match(rendered.text,/No player was added/);
});




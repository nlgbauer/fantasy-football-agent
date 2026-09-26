import { resolve } from 'node:path';
import { Store } from '../src/store.js';
import { GmailChannel } from '../src/adapters/channels.js';
import { createCurrentLineupPlan, executeLineupPlan } from '../src/espn-lineup.js';

const store = new Store(resolve(process.cwd(),'var/chatpdt.sqlite'));
try {
  const plan = await createCurrentLineupPlan(process.env);
  store.audit('lineup.planned',plan.id,{teamId:plan.teamId,scoringPeriodId:plan.scoringPeriodId,moves:plan.moves,projectedGain:plan.projectedGain});
  console.log(`${plan.teamName} · Week ${plan.scoringPeriodId} · current ${plan.currentProjected.toFixed(2)} · optimized ${plan.optimizedProjected.toFixed(2)} · gain ${plan.projectedGain.toFixed(2)}`);
  for (const move of plan.moves) console.log(`${move.name}: ${move.fromSlotName} → ${move.toSlotName} (${move.projected.toFixed(2)} projected)`);
  if (process.env.ESPN_LINEUP_WRITE_ENABLED !== 'true') {
    console.log('Preview only. ESPN_LINEUP_WRITE_ENABLED is not true.');
  } else {
    const result = await executeLineupPlan(process.env,plan,{store});
    console.log(result.executed ? 'Lineup changes were verified on ESPN.' : 'No lineup change cleared the configured threshold.');
    if (result.executed && process.env.LINEUP_EMAIL_NOTIFICATIONS === 'true') {
      const key=`lineup:${result.season}:${result.scoringPeriodId}:${result.id}`;
      const existing=store.db.prepare('SELECT state FROM deliveries WHERE id=?').get(key);
      if (!existing) {
        store.db.prepare('INSERT INTO deliveries(id,state,receipt) VALUES (?,?,?)').run(key,'sending',null);
        try {
          const receipt=await new GmailChannel(process.env).sendLineupNotice(result,key);
          store.db.prepare('UPDATE deliveries SET state=?,receipt=? WHERE id=?').run('sent',JSON.stringify(receipt),key);
          store.audit('lineup.notification_sent',result.id,{recipient:process.env.GMAIL_TO});
          console.log(`Notification sent to ${process.env.GMAIL_TO}.`);
        } catch (error) {
          store.db.prepare('UPDATE deliveries SET state=? WHERE id=?').run('unknown',key);
          store.audit('lineup.notification_unknown',result.id);
          throw error;
        }
      }
    }
  }
} finally { store.close(); }




import { ingest } from './adapters/espn.js';
export async function weekly(app,env,week,fixture){
  const key=`${fixture?'demo':env.ESPN_LEAGUE_ID}:${fixture?.season||env.ESPN_SEASON}:${week}`;
  const prior=app.store.db.prepare('SELECT * FROM jobs WHERE id=?').get(key);
  if(prior?.state==='done')return app.store.get(prior.package);
  if(prior)throw new Error('Weekly job already running or interrupted; inspect jobs before retrying');
  app.store.db.prepare('INSERT INTO jobs VALUES (?,?,?)').run(key,'running',null);
  try{const snapshot=fixture||await ingest(env,week);const p=await app.publications.draft(snapshot);app.store.db.prepare('UPDATE jobs SET state=?,package=? WHERE id=?').run('done',p.id,key);return p;}
  catch(e){app.store.db.prepare('UPDATE jobs SET state=? WHERE id=?').run('failed',key);app.store.audit('weekly.failed',key);throw e;}
}




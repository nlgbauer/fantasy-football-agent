import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
export const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export const now = () => new Date().toISOString();
export class Store {
  constructor(path) {
    mkdirSync(dirname(path), {recursive:true});
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, kind TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audit (seq INTEGER PRIMARY KEY, at TEXT, event TEXT, entity TEXT, body TEXT);
      CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, at TEXT, body TEXT);
      CREATE TABLE IF NOT EXISTS deliveries (id TEXT PRIMARY KEY, state TEXT, receipt TEXT);
      CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, state TEXT, package TEXT);`);
  }
  put(kind, body) {
    body.id ||= randomUUID();
    this.db.prepare('INSERT INTO records VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(body.id,kind,JSON.stringify(body));
    return body;
  }
  get(id) {const r=this.db.prepare('SELECT body FROM records WHERE id=?').get(id); if(!r) throw new Error('Not found'); return JSON.parse(r.body);}
  list(kind) {return this.db.prepare('SELECT body FROM records WHERE kind=?').all(kind).map(r=>JSON.parse(r.body));}
  audit(event,entity,body={}) {this.db.prepare('INSERT INTO audit(at,event,entity,body) VALUES (?,?,?,?)').run(now(),event,entity,JSON.stringify(body));}
  tx(fn) {this.db.exec('BEGIN IMMEDIATE'); try {const out=fn();this.db.exec('COMMIT');return out;}catch(e){this.db.exec('ROLLBACK');throw e;}}
  close(){this.db.close();}
}




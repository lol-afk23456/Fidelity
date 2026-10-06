import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';

export type DB = DatabaseSync;
export type Row = Record<string, any>;
export const id = () => randomUUID();
export const token = () => randomBytes(32).toString('base64url');
export const now = () => new Date().toISOString();
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export function passwordHash(password: string) { const salt=randomBytes(16).toString('hex'); return `${salt}:${scryptSync(password,salt,64).toString('hex')}`; }
export function verifyPassword(password:string, hash:string) { try {const [salt,key]=hash.split(':');const a=Buffer.from(key,'hex');const b=scryptSync(password,salt,64);return a.length===b.length&&timingSafeEqual(a,b);}catch{return false;} }
export function openDb(path=process.env.DATABASE_PATH||'./data/fidelity.sqlite'):DB {
  if(path!==':memory:') mkdirSync(dirname(path),{recursive:true});
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tenants(id TEXT PRIMARY KEY,name TEXT NOT NULL,slug TEXT UNIQUE NOT NULL,industry TEXT NOT NULL DEFAULT '',color TEXT NOT NULL DEFAULT '#7357ff',address TEXT NOT NULL DEFAULT '',active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,tenant_id TEXT REFERENCES tenants(id),name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN('agency','owner','staff')),active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,CHECK((role='agency' AND tenant_id IS NULL) OR (role!='agency' AND tenant_id IS NOT NULL)));
    CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,csrf_token TEXT NOT NULL,expires_at TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS programs(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),name TEXT NOT NULL,type TEXT NOT NULL CHECK(type IN('stamps','points','coupon')),description TEXT NOT NULL DEFAULT '',reward_threshold INTEGER NOT NULL CHECK(reward_threshold>0),reward_name TEXT NOT NULL,color TEXT NOT NULL,points_per_euro REAL NOT NULL DEFAULT 1,active INTEGER NOT NULL DEFAULT 1,expires_at TEXT,locations_json TEXT NOT NULL DEFAULT '[]',created_at TEXT NOT NULL,UNIQUE(id,tenant_id));
    CREATE TABLE IF NOT EXISTS members(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),program_id TEXT NOT NULL,name TEXT NOT NULL,email TEXT NOT NULL,phone TEXT NOT NULL DEFAULT '',marketing_consent INTEGER NOT NULL DEFAULT 0,consent_at TEXT NOT NULL,privacy_version TEXT NOT NULL DEFAULT '1',balance INTEGER NOT NULL DEFAULT 0 CHECK(balance>=0),total_earned INTEGER NOT NULL DEFAULT 0 CHECK(total_earned>=0),reward_count INTEGER NOT NULL DEFAULT 0 CHECK(reward_count>=0),public_token TEXT UNIQUE NOT NULL,apple_auth_token TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active' CHECK(status IN('active','deleted')),offer TEXT,last_visit_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,update_seq INTEGER NOT NULL DEFAULT 0,FOREIGN KEY(program_id,tenant_id) REFERENCES programs(id,tenant_id),UNIQUE(id,tenant_id));
    CREATE UNIQUE INDEX IF NOT EXISTS unique_member_email ON members(program_id,email) WHERE status='active';
    CREATE TABLE IF NOT EXISTS transactions(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,member_id TEXT NOT NULL,type TEXT NOT NULL CHECK(type IN('credit','redeem','reversal')),amount INTEGER NOT NULL,balance_after INTEGER NOT NULL CHECK(balance_after>=0),note TEXT NOT NULL DEFAULT '',actor_id TEXT REFERENCES users(id),reversal_of TEXT UNIQUE REFERENCES transactions(id),created_at TEXT NOT NULL,FOREIGN KEY(member_id,tenant_id) REFERENCES members(id,tenant_id));
    CREATE TABLE IF NOT EXISTS idempotency(tenant_id TEXT NOT NULL,key TEXT NOT NULL,fingerprint TEXT NOT NULL,response_json TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(tenant_id,key));
    CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,tenant_id TEXT,actor_id TEXT,action TEXT NOT NULL,entity_id TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS consent_log(id TEXT PRIMARY KEY,member_id TEXT NOT NULL REFERENCES members(id),granted INTEGER NOT NULL,source TEXT NOT NULL,version TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS campaigns(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),name TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,segment TEXT NOT NULL,program_id TEXT REFERENCES programs(id),status TEXT NOT NULL DEFAULT 'draft',scheduled_at TEXT,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS campaign_deliveries(id TEXT PRIMARY KEY,campaign_id TEXT NOT NULL REFERENCES campaigns(id),member_id TEXT NOT NULL REFERENCES members(id),channel TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',error TEXT,sent_at TEXT,UNIQUE(campaign_id,member_id,channel));
    CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,member_id TEXT NOT NULL REFERENCES members(id),type TEXT NOT NULL,payload_json TEXT NOT NULL DEFAULT '{}',status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,error TEXT,available_at TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS apple_registrations(device_id TEXT NOT NULL,member_id TEXT NOT NULL REFERENCES members(id),push_token TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(device_id,member_id));
    CREATE TABLE IF NOT EXISTS google_notifications(member_id TEXT NOT NULL REFERENCES members(id),sent_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS members_tenant ON members(tenant_id,status);
    CREATE INDEX IF NOT EXISTS transactions_member ON transactions(member_id,created_at);
    CREATE INDEX IF NOT EXISTS transactions_tenant ON transactions(tenant_id,created_at);
    CREATE INDEX IF NOT EXISTS jobs_pending ON jobs(status,available_at);
    CREATE INDEX IF NOT EXISTS notifications_member ON google_notifications(member_id,sent_at);
    INSERT OR IGNORE INTO metadata(key,value) VALUES('sequence','0');
    INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(1,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
  `);
  if(!one(db,'SELECT version FROM schema_migrations WHERE version=2')) {
    atomic(db,()=>{
      db.exec(`ALTER TABLE members ADD COLUMN google_issued INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE members ADD COLUMN apple_issued INTEGER NOT NULL DEFAULT 0;
        CREATE TABLE automations(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),name TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,inactive_days INTEGER NOT NULL,cooldown_days INTEGER NOT NULL,program_id TEXT REFERENCES programs(id),active INTEGER NOT NULL DEFAULT 1,last_run_at TEXT,created_at TEXT NOT NULL);
        CREATE TABLE automation_runs(automation_id TEXT NOT NULL REFERENCES automations(id),member_id TEXT NOT NULL REFERENCES members(id),sent_at TEXT NOT NULL,PRIMARY KEY(automation_id,member_id));`);
      run(db,'INSERT INTO schema_migrations VALUES(?,?)',2,now());
    });
  }
  if(!one(db,'SELECT version FROM schema_migrations WHERE version=3')) {
    atomic(db,()=>{
      db.exec(`CREATE TABLE branding(program_id TEXT PRIMARY KEY REFERENCES programs(id),tenant_id TEXT NOT NULL REFERENCES tenants(id),png BLOB NOT NULL,updated_at TEXT NOT NULL);
        ALTER TABLE tenants ADD COLUMN privacy_url TEXT NOT NULL DEFAULT '';
        ALTER TABLE tenants ADD COLUMN terms_text TEXT NOT NULL DEFAULT '';`);
      run(db,'INSERT INTO schema_migrations VALUES(?,?)',3,now());
    });
  }
  return db;
}
export function one(db:DB, sql:string,...params:any[]):Row|undefined {return db.prepare(sql).get(...params) as Row|undefined;}
export function all(db:DB, sql:string,...params:any[]):Row[] {return db.prepare(sql).all(...params) as Row[];}
export function run(db:DB, sql:string,...params:any[]) {return db.prepare(sql).run(...params);}
export function atomic<T>(db:DB,fn:()=>T):T {db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(err){db.exec('ROLLBACK');throw err;}}
export function sequence(db:DB):number {run(db,"UPDATE metadata SET value=CAST(value AS INTEGER)+1 WHERE key='sequence'");return Number(one(db,"SELECT value FROM metadata WHERE key='sequence'")!.value);}
export function audit(db:DB,tenantId:string|null,actorId:string|null,action:string,entityId:string) {run(db,'INSERT INTO audit VALUES(?,?,?,?,?,?)',id(),tenantId,actorId,action,entityId,now());}
export function enqueue(db:DB,tenantId:string,memberId:string,type='wallet_update',payload:unknown={},at=now()) {run(db,'INSERT INTO jobs(id,tenant_id,member_id,type,payload_json,available_at,created_at) VALUES(?,?,?,?,?,?,?)',id(),tenantId,memberId,type,JSON.stringify(payload),at,now());}

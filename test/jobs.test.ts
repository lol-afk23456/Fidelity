import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { openDb, all, one, run, id, token, digest, now, enqueue, type DB } from '../server/db.js';
import { queueCampaign } from '../server/domain.js';
import { processJobs, recoverProcessingJobs, walletProvider } from '../server/jobs.js';
import { runAutomation } from '../server/automations.js';
import { WalletError, type WalletMember, type WalletProgram } from '../server/wallet/index.js';

process.env.NODE_ENV = 'test';
process.env.PUBLIC_BASE_URL = 'http://localhost:5173';
const before = (days: number) => new Date(Date.now() - days * 86400000).toISOString();

function fixture(t: TestContext) {
  const db = openDb(':memory:');
  t.after(() => db.close());
  const tenantA = id(), tenantB = id(), owner = id();
  for (const [tenantId, slug] of [[tenantA, 'alpha'], [tenantB, 'beta']]) {
    run(db, 'INSERT INTO tenants(id,name,slug,created_at) VALUES(?,?,?,?)', tenantId, slug, slug, now());
  }
  run(db, 'INSERT INTO users(id,tenant_id,name,email,password_hash,role,created_at) VALUES(?,?,?,?,?,?,?)',
    owner, tenantA, 'Titolare', 'owner@example.test', 'unused-in-session-fixture', 'owner', now());
  const programA = id(), programB = id();
  for (const [programId, tenantId] of [[programA, tenantA], [programB, tenantB]]) {
    run(db, 'INSERT INTO programs(id,tenant_id,name,type,reward_threshold,reward_name,color,created_at) VALUES(?,?,?,?,?,?,?,?)',
      programId, tenantId, 'Programma test', 'stamps', 10, 'Premio', '#123456', now());
  }
  function member(options: { tenantId?: string; consent?: boolean; lastVisit?: string | null; createdAt?: string } = {}) {
    const memberId = id(), publicToken = token(), tenantId = options.tenantId ?? tenantA;
    run(db, `INSERT INTO members(id,tenant_id,program_id,name,email,marketing_consent,consent_at,public_token,apple_auth_token,
      created_at,updated_at,last_visit_at,google_issued,apple_issued,balance,total_earned)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, memberId, tenantId, tenantId === tenantA ? programA : programB,
      'Nome personale da cancellare', `${memberId}@example.test`, +(options.consent ?? true), now(), publicToken, token(),
      options.createdAt ?? now(), now(), options.lastVisit ?? null, 1, 1, 10, 10);
    run(db, 'INSERT INTO apple_registrations VALUES(?,?,?,?)', `device-${memberId}`, memberId, 'a'.repeat(64), now());
    return { id: memberId, publicToken };
  }
  function campaign() {
    const campaignId = id();
    run(db, 'INSERT INTO campaigns(id,tenant_id,name,title,body,segment,created_at) VALUES(?,?,?,?,?,?,?)',
      campaignId, tenantA, 'Campagna test', 'Titolo', 'Messaggio promozionale di prova', 'all', now());
    queueCampaign(db, tenantA, campaignId, owner);
    return campaignId;
  }
  function automation(tenantId = tenantA) {
    const automationId = id();
    run(db, 'INSERT INTO automations(id,tenant_id,name,title,body,inactive_days,cooldown_days,created_at) VALUES(?,?,?,?,?,?,?,?)',
      automationId, tenantId, 'Clienti inattivi', 'Ci manchi', 'Torna a trovarci', 30, 7, now());
    return automationId;
  }
  const raw = token(), csrf = token();
  run(db, 'INSERT INTO sessions VALUES(?,?,?,?,?)', digest(raw), owner, csrf, new Date(Date.now() + 600000).toISOString(), now());
  const app = createApp(db);
  const api = (method: 'delete' | 'post' | 'patch', path: string) => request(app)[method](path)
    .set('Cookie', `fidelity_session=${raw}`).set('Origin', 'http://localhost:5173').set('X-CSRF-Token', csrf);
  return { db, tenantA, tenantB, programA, owner, member, campaign, automation, api };
}

function providerFixture(overrides: Partial<typeof walletProvider> = {}) {
  const updates: Array<{ member: WalletMember; program: WalletProgram }> = [];
  const pushes: string[][] = [];
  const messages: Array<{ member: WalletMember; message: { id: string; title: string; body: string } }> = [];
  const provider: typeof walletProvider = {
    getWalletStatus: () => ({ apple: { configured: true, missing: [] }, google: { configured: true, missing: [] } }),
    updateGooglePass: async (member, program) => { updates.push(structuredClone({ member, program })); },
    notifyAppleDevices: async tokens => { pushes.push([...tokens]); return { invalidTokens: [] }; },
    sendGoogleMessage: async (member, _program, message) => { messages.push(structuredClone({ member, message })); },
    ...overrides,
  };
  return { provider, updates, pushes, messages };
}

function googleJob(db: DB, memberId: string) {
  return one(db, "SELECT * FROM jobs WHERE member_id=? AND type='campaign' AND json_extract(payload_json,'$.channel')='google'", memberId)!;
}

test('tenant changes synchronize issued cards through suspension and reactivation without sending campaigns', async t => {
  const f = fixture(t), m = f.member(), foreign = f.member({ tenantId: f.tenantB }), p = providerFixture();
  run(f.db, "UPDATE users SET role='agency',tenant_id=NULL WHERE id=?", f.owner);
  const oldSequence = one(f.db, 'SELECT update_seq FROM members WHERE id=?', m.id)!.update_seq;
  const foreignSequence = one(f.db, 'SELECT update_seq FROM members WHERE id=?', foreign.id)!.update_seq;
  await f.api('patch', `/api/tenants/${f.tenantA}`).send({ name: 'Nuova insegna' }).expect(200);
  assert.ok(one(f.db, 'SELECT update_seq FROM members WHERE id=?', m.id)!.update_seq > oldSequence);
  await processJobs(f.db, 20, p.provider);
  assert.equal(p.updates.length, 1);
  assert.equal(p.updates[0]!.program.tenantName, 'Nuova insegna');
  assert.equal(p.updates[0]!.member.voided, false);

  f.campaign();
  await f.api('patch', `/api/tenants/${f.tenantA}`).send({ active: false }).expect(200);
  await processJobs(f.db, 20, p.provider);
  assert.equal(p.updates.length, 2);
  assert.equal(p.updates[1]!.member.voided, true);
  assert.equal(p.messages.length, 0);
  assert.equal(p.pushes.length, 2);
  assert.equal(one(f.db, "SELECT count(*) n FROM campaign_deliveries WHERE status='sent'")!.n, 0);

  await f.api('patch', `/api/tenants/${f.tenantA}`).send({ active: true }).expect(200);
  await processJobs(f.db, 20, p.provider);
  assert.equal(p.updates.length, 3);
  assert.equal(p.updates[2]!.member.voided, false);
  assert.equal(p.pushes.length, 3);
  assert.equal(one(f.db, 'SELECT update_seq FROM members WHERE id=?', foreign.id)!.update_seq, foreignSequence);
  assert.equal(one(f.db, 'SELECT count(*) n FROM jobs WHERE tenant_id=?', f.tenantB)!.n, 0);
});

test('queued campaigns recheck consent and do not call either provider after withdrawal', async t => {
  const f = fixture(t), m = f.member(), p = providerFixture();
  f.campaign();
  run(f.db, 'UPDATE members SET marketing_consent=0 WHERE id=?', m.id);
  await processJobs(f.db, 20, p.provider);
  assert.equal(p.messages.length + p.pushes.length + p.updates.length, 0);
  assert.deepEqual(all(f.db, 'SELECT status FROM jobs').map(row => row.status), ['blocked', 'blocked']);
  assert.deepEqual(all(f.db, 'SELECT status FROM campaign_deliveries').map(row => row.status), ['blocked', 'blocked']);
});

test('Google campaign rate limit defers the fourth notification and sends only after the rolling window', async t => {
  const f = fixture(t), m = f.member(), p = providerFixture();
  f.campaign();
  for (let n = 1; n <= 3; n++) run(f.db, 'INSERT INTO google_notifications VALUES(?,?)', m.id,
    new Date(Date.now() - n * 1000).toISOString());
  await processJobs(f.db, 20, p.provider);
  const job = googleJob(f.db, m.id);
  assert.equal(p.messages.length, 0);
  assert.equal(job.status, 'pending');
  assert.ok(Date.parse(job.available_at) > Date.now() + 23 * 3600000);
  assert.equal(one(f.db, 'SELECT count(*) AS n FROM google_notifications')!.n, 3);
  run(f.db, 'UPDATE google_notifications SET sent_at=?', before(2));
  run(f.db, 'UPDATE jobs SET available_at=? WHERE id=?', now(), job.id);
  await processJobs(f.db, 20, p.provider);
  assert.equal(p.messages.length, 1);
  assert.equal(one(f.db, 'SELECT status FROM jobs WHERE id=?', job.id)!.status, 'sent');
});

test('an uncertain Google send is not repeated by later cycles or the generic retry action', async t => {
  const f = fixture(t), m = f.member();
  f.campaign();
  let attempted = 0;
  const p = providerFixture({ sendGoogleMessage: async () => {
    attempted++;
    throw new WalletError('Network timeout after a possibly accepted request', 'GOOGLE_UNAVAILABLE', 503, true);
  } });
  const initialJob = googleJob(f.db, m.id), deliveryId = JSON.parse(initialJob.payload_json).deliveryId;
  await processJobs(f.db, 20, p.provider);
  assert.equal(attempted, 1);
  assert.equal(one(f.db, 'SELECT status FROM jobs WHERE id=?', initialJob.id)!.status, 'failed');
  run(f.db, 'UPDATE jobs SET available_at=? WHERE id=?', now(), initialJob.id);
  await processJobs(f.db, 20, p.provider);
  await f.api('post', '/api/jobs/retry').send({}).expect(200);
  await processJobs(f.db, 20, p.provider);
  assert.equal(attempted, 1);
  assert.equal(one(f.db, 'SELECT status FROM campaign_deliveries WHERE id=?', deliveryId)!.status, 'failed');
});

test('restart recovery marks an interrupted Google campaign uncertain while replaying idempotent updates', async t => {
  const f = fixture(t), m = f.member(), p = providerFixture();
  f.campaign();
  const job = googleJob(f.db, m.id), deliveryId = JSON.parse(job.payload_json).deliveryId;
  enqueue(f.db, f.tenantA, m.id, 'wallet_update');
  run(f.db, "UPDATE jobs SET status='processing'");
  recoverProcessingJobs(f.db);
  assert.equal(one(f.db, 'SELECT status FROM jobs WHERE id=?', job.id)!.status, 'failed');
  assert.match(one(f.db, 'SELECT error FROM jobs WHERE id=?', job.id)!.error, /incerto dopo riavvio/);
  assert.equal(one(f.db, 'SELECT status FROM campaign_deliveries WHERE id=?', deliveryId)!.status, 'failed');
  assert.equal(one(f.db, "SELECT status FROM jobs WHERE type='wallet_update'")!.status, 'pending');
  await processJobs(f.db, 20, p.provider);
  assert.equal(p.messages.length, 0);
  assert.equal(p.updates.length, 1);
});

test('customer deletion queues a revoked wallet update with anonymized name and a replaced public token', async t => {
  const f = fixture(t), m = f.member(), p = providerFixture();
  enqueue(f.db, f.tenantA, m.id, 'wallet_update');
  await f.api('delete', `/api/members/${m.id}`).expect(200);
  assert.equal(one(f.db, "SELECT status FROM jobs WHERE type='wallet_update'")!.status, 'blocked');
  assert.equal(one(f.db, "SELECT status FROM jobs WHERE type='wallet_revoke'")!.status, 'pending');
  await processJobs(f.db, 20, p.provider);
  assert.equal(p.updates.length, 1);
  assert.equal(p.updates[0]!.member.voided, true);
  assert.equal(p.updates[0]!.member.name, 'Cliente cancellato');
  assert.equal(p.updates[0]!.member.balance, 0);
  assert.equal(p.updates[0]!.member.rewardCount, 0);
  assert.notEqual(p.updates[0]!.member.publicToken, m.publicToken);
  assert.equal(p.messages.length, 0);
  assert.equal(p.pushes.length, 1);
  assert.equal(one(f.db, "SELECT status FROM jobs WHERE type='wallet_revoke'")!.status, 'sent');
});

test('inactivity automations honor consent, registration age, tenant isolation and recipient cooldown', t => {
  const f = fixture(t);
  const eligible = f.member({ lastVisit: before(45) });
  const neverVisited = f.member({ createdAt: before(45) });
  f.member({ lastVisit: before(5) });
  f.member({ lastVisit: before(45), consent: false });
  const foreign = f.member({ tenantId: f.tenantB, lastVisit: before(45) });
  const aid = f.automation();
  assert.throws(() => runAutomation(f.db, f.tenantB, aid, null), (error: any) => error.status === 404);
  assert.equal(runAutomation(f.db, f.tenantA, aid, null).recipients, 2);
  assert.deepEqual(new Set(all(f.db, 'SELECT member_id FROM automation_runs').map(row => row.member_id)), new Set([eligible.id, neverVisited.id]));
  assert.equal(one(f.db, 'SELECT count(*) AS n FROM jobs WHERE tenant_id=?', f.tenantB)!.n, 0);
  assert.equal(one(f.db, 'SELECT count(*) AS n FROM campaign_deliveries WHERE member_id=?', foreign.id)!.n, 0);
  assert.equal(runAutomation(f.db, f.tenantA, aid, null).recipients, 0);
  assert.equal(one(f.db, 'SELECT count(*) AS n FROM campaigns')!.n, 1);
  run(f.db, 'UPDATE automation_runs SET sent_at=?', before(8));
  assert.equal(runAutomation(f.db, f.tenantA, aid, null).recipients, 2);
  assert.equal(one(f.db, 'SELECT count(*) AS n FROM campaigns')!.n, 2);
  run(f.db, 'UPDATE automations SET active=0 WHERE id=?', aid);
  assert.throws(() => runAutomation(f.db, f.tenantA, aid, null), (error: any) => error.status === 409);
});

test('the worker runs due automations once a day and excludes a suspended tenant', async t => {
  const f = fixture(t), p = providerFixture();
  f.member({ lastVisit: before(45) });
  f.member({ tenantId: f.tenantB, lastVisit: before(45) });
  const allowed = f.automation(), suspended = f.automation(f.tenantB);
  run(f.db, 'UPDATE tenants SET active=0 WHERE id=?', f.tenantB);
  await processJobs(f.db, 20, p.provider);
  assert.ok(one(f.db, 'SELECT last_run_at FROM automations WHERE id=?', allowed)!.last_run_at);
  assert.equal(one(f.db, 'SELECT last_run_at FROM automations WHERE id=?', suspended)!.last_run_at, null);
  assert.equal(p.messages.length, 1);
  assert.equal(one(f.db, 'SELECT count(*) AS n FROM campaigns')!.n, 1);
  await processJobs(f.db, 20, p.provider);
  assert.equal(p.messages.length, 1);
  assert.equal(one(f.db, 'SELECT count(*) AS n FROM campaigns')!.n, 1);
});

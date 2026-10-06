import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import request, { type Test } from 'supertest';
import { createApp } from '../server/app.js';
import { openDb, run, one, all, id, token, now, passwordHash, type DB } from '../server/db.js';

const origin = 'http://localhost:5173';
process.env.PUBLIC_BASE_URL = origin;
process.env.NODE_ENV = 'test';
process.env.APPLE_PASS_TYPE_ID = 'pass.test.integration';
for (const key of ['APPLE_TEAM_ID', 'APPLE_SIGNER_CERT_PATH', 'APPLE_SIGNER_KEY_PATH', 'APPLE_WWDR_CERT_PATH', 'GOOGLE_ISSUER_ID', 'GOOGLE_SERVICE_ACCOUNT_FILE']) delete process.env[key];
const password = 'Integration-test-password-2026';
const hash = passwordHash(password);

function fixture(t: TestContext) {
  const db = openDb(':memory:');
  t.after(() => db.close());
  const tenantA = id(), tenantB = id();
  for (const [tid, slug] of [[tenantA, 'alpha'], [tenantB, 'beta']]) run(db,
    'INSERT INTO tenants(id,name,slug,industry,color,address,created_at) VALUES(?,?,?,?,?,?,?)', tid, `Negozio ${slug}`, slug, 'Caffetteria', '#123456', 'Via Roma 12', now());
  const users = { owner: id(), other: id(), staff: id(), agency: id() };
  for (const [key, role, tid] of [['owner', 'owner', tenantA], ['other', 'owner', tenantB], ['staff', 'staff', tenantA], ['agency', 'agency', null]] as const) run(db,
    'INSERT INTO users(id,tenant_id,name,email,password_hash,role,created_at) VALUES(?,?,?,?,?,?,?)', users[key], tid, `Utente ${key}`, `${key}@test.example`, hash, role, now());
  function program(tid = tenantA, type: 'stamps' | 'points' | 'coupon' = 'stamps') {
    const pid = id();
    run(db, 'INSERT INTO programs(id,tenant_id,name,type,description,reward_threshold,reward_name,color,points_per_euro,locations_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      pid, tid, `Programma ${type}`, type, 'Descrizione da conservare', type === 'coupon' ? 1 : 10, 'Premio gratuito', '#123456', 1.5,
      JSON.stringify([{ latitude: 41.9, longitude: 12.5, relevantText: 'Il negozio' }]), now());
    return pid;
  }
  const programA = program(), programB = program(tenantB);
  function member(pid = programA, tid = tenantA, email = `member-${id()}@test.example`, consent = false) {
    const mid = id(), publicToken = token(), appleToken = token();
    run(db, 'INSERT INTO members(id,tenant_id,program_id,name,email,phone,marketing_consent,consent_at,public_token,apple_auth_token,created_at,updated_at,update_seq) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
      mid, tid, pid, 'Cliente Test', email, '+39061234567', +consent, now(), publicToken, appleToken, now(), now(), 1);
    return { id: mid, publicToken, appleToken, email };
  }
  const memberA = member(), memberB = member(programB, tenantB);
  const app = createApp(db);
  async function login(who: keyof typeof users = 'owner') {
    const response = await request(app).post('/api/auth/login').set('Origin', origin).send({ email: `${who}@test.example`, password }).expect(200);
    const cookies = response.headers['set-cookie'] as unknown as string[];
    const cookie = cookies.map(value => value.split(';')[0]).join('; ');
    const csrf = response.body.csrfToken as string;
    const api = (method: 'get' | 'post' | 'patch' | 'delete', path: string): Test => request(app)[method](path).set('Cookie', cookie).set('Origin', origin).set('x-csrf-token', csrf);
    return { api, cookie, csrf, response };
  }
  return { db, app, tenantA, tenantB, users, programA, programB, memberA, memberB, program, member, login };
}

const operation = (type: 'credit' | 'redeem', extra: Record<string, unknown> = {}) => ({ type, idempotencyKey: token(), ...extra });
const txCount = (db: DB, memberId: string) => Number(one(db, 'SELECT count(*) AS n FROM transactions WHERE member_id=?', memberId)!.n);

test('authentication requires trusted Origin, protects mutations with CSRF, and invalidates logout sessions', async t => {
  const f = fixture(t);
  await request(f.app).get('/api/members').expect(401);
  await request(f.app).post('/api/auth/login').send({ email: 'owner@test.example', password }).expect(403);
  await request(f.app).post('/api/auth/login').set('Origin', 'https://attacker.example').send({ email: 'owner@test.example', password }).expect(403);
  await request(f.app).post('/api/auth/login').set('Origin', origin).send({ email: 'owner@test.example', password: 'wrong' }).expect(401);
  const session = await f.login();
  const setCookie = String(session.response.headers['set-cookie']);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);
  assert.equal(JSON.stringify(session.response.body).includes(hash), false);
  await request(f.app).patch(`/api/members/${f.memberA.id}`).set('Origin', origin).set('Cookie', session.cookie).send({ name: 'Alterato' }).expect(403);
  await request(f.app).patch(`/api/members/${f.memberA.id}`).set('Origin', 'https://attacker.example').set('Cookie', session.cookie).set('x-csrf-token', session.csrf).send({ name: 'Alterato' }).expect(403);
  assert.equal(one(f.db, 'SELECT name FROM members WHERE id=?', f.memberA.id)!.name, 'Cliente Test');
  await session.api('post', '/api/auth/logout').send({}).expect(200);
  await session.api('get', '/api/auth/me').expect(401);
});

test('tenant isolation applies to reads, scans, writes and exports even when an owner spoofs the tenant header', async t => {
  const f = fixture(t), owner = await f.login();
  const list = await owner.api('get', '/api/members').set('x-tenant-id', f.tenantB).expect(200);
  assert.deepEqual(list.body.items.map((x: { id: string }) => x.id), [f.memberA.id]);
  await owner.api('get', `/api/members/${f.memberB.id}`).set('x-tenant-id', f.tenantB).expect(404);
  await owner.api('patch', `/api/programs/${f.programB}`).send({ name: 'Attacco' }).expect(404);
  await owner.api('post', `/api/members/${f.memberB.id}/transactions`).send(operation('credit')).expect(404);
  await owner.api('post', '/api/scan').send({ code: f.memberB.publicToken }).expect(404);
  const exported = await owner.api('get', '/api/members/export').set('x-tenant-id', f.tenantB).expect(200);
  assert.ok(exported.text.includes(f.memberA.email));
  assert.equal(exported.text.includes(f.memberB.email), false);
  assert.equal(one(f.db, 'SELECT balance FROM members WHERE id=?', f.memberB.id)!.balance, 0);
  const agency = await f.login('agency');
  await agency.api('get', '/api/members').expect(400);
  const agencyList = await agency.api('get', '/api/members').set('x-tenant-id', f.tenantB).expect(200);
  assert.deepEqual(agencyList.body.items.map((x: { id: string }) => x.id), [f.memberB.id]);
});

test('staff can scan and credit but cannot manage programs, customers, users, campaigns, exports or reversals', async t => {
  const f = fixture(t), staff = await f.login('staff');
  await staff.api('post', '/api/scan').send({ code: f.memberA.publicToken }).expect(200);
  const credit = await staff.api('post', `/api/members/${f.memberA.id}/transactions`).send(operation('credit')).expect(201);
  for (const [method, path] of [
    ['post', '/api/programs'], ['patch', `/api/programs/${f.programA}`], ['post', '/api/members'],
    ['delete', `/api/members/${f.memberA.id}`], ['post', '/api/users'], ['post', '/api/campaigns'],
    ['get', '/api/members/export'], ['get', '/api/audit'], ['post', `/api/transactions/${credit.body.transaction.id}/reverse`],
  ] as const) await staff.api(method, path).send({}).expect(403);
});

test('credit is idempotent only for the identical operation and does not duplicate transactions or jobs', async t => {
  const f = fixture(t), owner = await f.login(), body = operation('credit', { amount: 3 });
  const path = `/api/members/${f.memberA.id}/transactions`;
  const first = await owner.api('post', path).send(body).expect(201);
  const replay = await owner.api('post', path).send(body).expect(201);
  assert.deepEqual(replay.body, first.body);
  const conflict = await owner.api('post', path).send({ ...body, amount: 4 }).expect(409);
  assert.equal(conflict.body.code, 'IDEMPOTENCY_CONFLICT');
  assert.equal(txCount(f.db, f.memberA.id), 1);
  assert.equal(one(f.db, 'SELECT count(*) AS n FROM jobs WHERE member_id=?', f.memberA.id)!.n, 1);
  assert.equal(one(f.db, 'SELECT balance FROM members WHERE id=?', f.memberA.id)!.balance, 3);
});

test('two reward redemptions cannot spend the same balance, and a client cannot override the reward cost', async t => {
  const f = fixture(t), owner = await f.login(), path = `/api/members/${f.memberA.id}/transactions`;
  await owner.api('post', path).send(operation('credit', { amount: 10 })).expect(201);
  await owner.api('post', path).send(operation('redeem', { amount: 1 })).expect(400);
  const outcomes = await Promise.all([owner.api('post', path).send(operation('redeem')), owner.api('post', path).send(operation('redeem'))]);
  assert.deepEqual(outcomes.map(r => r.status).sort(), [201, 409]);
  const state = one(f.db, 'SELECT balance,reward_count FROM members WHERE id=?', f.memberA.id)!;
  assert.equal(state.balance, 0);
  assert.equal(state.reward_count, 1);
  assert.equal(txCount(f.db, f.memberA.id), 2);
});

test('public coupons start with one use, reject reloads and can only be redeemed once', async t => {
  const f = fixture(t), coupon = f.program(f.tenantA, 'coupon');
  const enrollment = await request(f.app).post('/api/public/join/alpha').set('Origin', origin).send({ programId: coupon, name: 'Cliente Coupon', email: 'coupon@test.example', acceptTerms: true }).expect(201);
  const m = one(f.db, 'SELECT * FROM members WHERE public_token=?', enrollment.body.token)!;
  assert.equal(m.balance, 1);
  const owner = await f.login(), path = `/api/members/${m.id}/transactions`;
  await owner.api('post', path).send(operation('credit')).expect(400);
  await owner.api('post', path).send(operation('redeem')).expect(201);
  await owner.api('post', path).send(operation('redeem')).expect(409);
  assert.equal(one(f.db, 'SELECT balance FROM members WHERE id=?', m.id)!.balance, 0);
});

test('points from cents are rounded down and ambiguous or inapplicable amounts are rejected', async t => {
  const f = fixture(t), points = f.program(f.tenantA, 'points'), member = f.member(points), owner = await f.login();
  const path = `/api/members/${member.id}/transactions`;
  const credited = await owner.api('post', path).send(operation('credit', { spendCents: 375 })).expect(201);
  assert.equal(credited.body.member.balance, 5);
  await owner.api('post', path).send(operation('credit', { spendCents: 1 })).expect(400);
  await owner.api('post', path).send(operation('credit', { spendCents: 100, amount: 10 })).expect(400);
  await owner.api('post', `/api/members/${f.memberA.id}/transactions`).send(operation('credit', { spendCents: 100 })).expect(400);
  assert.equal(txCount(f.db, member.id), 1);
});

test('reversal is idempotent once, restores a redemption, and cannot make the balance negative', async t => {
  const f = fixture(t), owner = await f.login(), path = `/api/members/${f.memberA.id}/transactions`;
  const credit = await owner.api('post', path).send(operation('credit', { amount: 10 })).expect(201);
  const redeem = await owner.api('post', path).send(operation('redeem')).expect(201);
  const reverseCredit = `/api/transactions/${credit.body.transaction.id}/reverse`;
  await owner.api('post', reverseCredit).send({ note: 'Errore operatore', idempotencyKey: token() }).expect(409);
  const reverseRedeem = `/api/transactions/${redeem.body.transaction.id}/reverse`, reverseBody = { note: 'Premio annullato', idempotencyKey: token() };
  const reversed = await owner.api('post', reverseRedeem).send(reverseBody).expect(200);
  const replay = await owner.api('post', reverseRedeem).send(reverseBody).expect(200);
  assert.deepEqual(replay.body, reversed.body);
  assert.equal(reversed.body.member.balance, 10);
  assert.equal(reversed.body.member.rewardCount, 0);
  await owner.api('post', reverseRedeem).send({ ...reverseBody, idempotencyKey: token() }).expect(409);
  await owner.api('post', `/api/transactions/${reversed.body.transaction.id}/reverse`).send({ note: 'Storno dello storno', idempotencyKey: token() }).expect(409);
  assert.equal(txCount(f.db, f.memberA.id), 3);
});

test('public enrollment requires terms, rejects foreign programs, and duplicate email never discloses an existing card', async t => {
  const f = fixture(t);
  const input = { programId: f.programA, name: 'Cliente Uno', email: 'new@test.example', acceptTerms: true };
  await request(f.app).post('/api/public/join/alpha').set('Origin', origin).send({ ...input, acceptTerms: false }).expect(400);
  await request(f.app).post('/api/public/join/alpha').set('Origin', origin).send({ ...input, programId: f.programB }).expect(404);
  const first = await request(f.app).post('/api/public/join/alpha').set('Origin', origin).send(input).expect(201);
  const duplicate = await request(f.app).post('/api/public/join/alpha').set('Origin', origin).send({ ...input, email: 'NEW@test.example' }).expect(409);
  assert.equal(duplicate.body.code, 'ALREADY_ENROLLED');
  assert.equal(duplicate.body.token, undefined);
  assert.equal(duplicate.body.cardUrl, undefined);
  assert.equal(JSON.stringify(duplicate.body).includes(first.body.token), false);
  assert.equal(one(f.db, 'SELECT count(*) AS n FROM members WHERE email=?', input.email)!.n, 1);
});

test('public card responses omit contact details, wallet authentication secrets and admin session data', async t => {
  const f = fixture(t);
  const response = await request(f.app).get(`/api/public/cards/${f.memberA.publicToken}`).expect(200);
  const body = JSON.stringify(response.body);
  for (const secret of [f.memberA.email, '+39061234567', f.memberA.appleToken, hash, f.memberB.publicToken]) assert.equal(body.includes(secret), false);
  assert.equal(response.body.member.email, undefined);
  assert.equal(response.body.member.phone, undefined);
  assert.equal(response.body.member.appleAuthToken, undefined);
  assert.equal(response.body.wallet.apple.configured, false);
  assert.equal(response.body.wallet.google.configured, false);
  assert.equal(response.headers['cache-control'], 'no-store');
});

test('campaigns include only opt-in customers and withdrawal blocks queued deliveries', async t => {
  const f = fixture(t), owner = await f.login();
  await request(f.app).patch(`/api/public/cards/${f.memberA.publicToken}/consent`).set('Origin', origin).send({ marketingConsent: true }).expect(200);
  const noConsent = f.member(), optedOtherTenant = f.member(f.programB, f.tenantB, 'other-optin@test.example', true);
  const created = await owner.api('post', '/api/campaigns').send({ name: 'Ritorna da noi', title: 'Una novità', body: 'Scopri il nuovo premio', segment: 'all' }).expect(201);
  const sent = await owner.api('post', `/api/campaigns/${created.body.id}/send`).send({}).expect(200);
  assert.equal(sent.body.recipients, 1);
  assert.deepEqual(all(f.db, 'SELECT DISTINCT member_id FROM campaign_deliveries WHERE campaign_id=?', created.body.id).map(x => x.member_id), [f.memberA.id]);
  assert.equal(one(f.db, 'SELECT count(*) AS n FROM campaign_deliveries WHERE member_id IN(?,?)', noConsent.id, optedOtherTenant.id)!.n, 0);
  await request(f.app).patch(`/api/public/cards/${f.memberA.publicToken}/consent`).set('Origin', origin).send({ marketingConsent: false }).expect(200);
  const statuses = all(f.db, 'SELECT status FROM campaign_deliveries WHERE member_id=?', f.memberA.id);
  assert.equal(statuses.length, 2);
  assert.ok(statuses.every(row => row.status === 'blocked'));
  assert.deepEqual(all(f.db, 'SELECT granted FROM consent_log WHERE member_id=? ORDER BY created_at', f.memberA.id).map(x => x.granted), [1, 0]);
  await owner.api('post', `/api/campaigns/${created.body.id}/send`).send({}).expect(409);
});

test('PATCH preserves omitted tenant, program and member fields including marketing consent and locations', async t => {
  const f = fixture(t), owner = await f.login(), agency = await f.login('agency');
  run(f.db, 'UPDATE members SET marketing_consent=1 WHERE id=?', f.memberA.id);
  const tenant = await agency.api('patch', `/api/tenants/${f.tenantA}`).send({ name: 'Nuovo nome attività' }).expect(200);
  assert.equal(tenant.body.industry, 'Caffetteria');
  assert.equal(tenant.body.color, '#123456');
  assert.equal(tenant.body.address, 'Via Roma 12');
  const program = await owner.api('patch', `/api/programs/${f.programA}`).send({ name: 'Nuovo nome programma' }).expect(200);
  assert.equal(program.body.description, 'Descrizione da conservare');
  assert.equal(program.body.pointsPerEuro, 1.5);
  assert.equal(program.body.color, '#123456');
  assert.equal(program.body.locations.length, 1);
  const member = await owner.api('patch', `/api/members/${f.memberA.id}`).send({ name: 'Nome corretto' }).expect(200);
  assert.equal(member.body.phone, '+39061234567');
  assert.equal(member.body.marketingConsent, true);
  assert.equal(member.body.email, f.memberA.email);
  assert.equal(one(f.db, 'SELECT count(*) AS n FROM consent_log WHERE member_id=?', f.memberA.id)!.n, 0);
});

test('deleting a customer invalidates links and removes personal information from idempotency and queued payloads', async t => {
  const f = fixture(t), owner = await f.login(), body = operation('credit', { amount: 2, note: 'Informazione personale del cliente' });
  await owner.api('post', `/api/members/${f.memberA.id}/transactions`).send(body).expect(201);
  assert.ok(one(f.db, 'SELECT response_json FROM idempotency WHERE key=?', body.idempotencyKey)!.response_json.includes(f.memberA.email));
  run(f.db, 'INSERT INTO apple_registrations VALUES(?,?,?,?)', 'device-12345', f.memberA.id, 'push-secret', now());
  await owner.api('delete', `/api/members/${f.memberA.id}`).expect(200);
  await request(f.app).get(`/api/public/cards/${f.memberA.publicToken}`).expect(404);
  await owner.api('post', `/api/members/${f.memberA.id}/transactions`).send(body).expect(404);
  assert.equal(one(f.db, 'SELECT count(*) AS n FROM idempotency WHERE key=?', body.idempotencyKey)!.n, 0);
  // Apple retains only the registration needed to deliver the revoked pass, for at most seven days.
  assert.equal(one(f.db, 'SELECT count(*) AS n FROM apple_registrations WHERE member_id=?', f.memberA.id)!.n, 1);
  const m = one(f.db, 'SELECT * FROM members WHERE id=?', f.memberA.id)!;
  assert.equal(m.status, 'deleted');
  assert.notEqual(m.email, f.memberA.email);
  assert.equal(m.phone, '');
  assert.equal(m.marketing_consent, 0);
  assert.ok(all(f.db, 'SELECT note FROM transactions WHERE member_id=?', f.memberA.id).every(row => row.note === ''));
  assert.ok(all(f.db, "SELECT status,payload_json FROM jobs WHERE member_id=? AND type!='wallet_revoke'", f.memberA.id).every(row => row.status === 'blocked' && row.payload_json === '{}'));
  assert.equal(one(f.db, "SELECT count(*) n FROM jobs WHERE member_id=? AND type='wallet_revoke' AND status='pending'", f.memberA.id)!.n,1);
  run(f.db,'UPDATE members SET updated_at=? WHERE id=?',new Date(Date.now()-8*86400000).toISOString(),f.memberA.id);
  const {processJobs}=await import('../server/jobs.js');
  await processJobs(f.db,0);
  assert.equal(one(f.db,'SELECT count(*) n FROM apple_registrations WHERE member_id=?',f.memberA.id)!.n,0);
});

test('unconfigured Wallet issuance returns a truthful error and never claims to issue a usable pass', async t => {
  const f = fixture(t);
  for (const provider of ['apple', 'google']) {
    const response = await request(f.app).get(`/api/public/cards/${f.memberA.publicToken}/${provider}`).expect(503);
    assert.equal(response.body.code, 'WALLET_CONFIGURATION');
    assert.equal(response.body.url, undefined);
    assert.equal(response.headers['content-type'].includes('application/vnd.apple.pkpass'), false);
    assert.equal(JSON.stringify(response.body).includes(f.memberA.appleToken), false);
  }
});

test('Apple update protocol rejects unauthorized access and never accepts the public QR token as authentication', async t => {
  const f = fixture(t), prefix = '/api/wallet/apple/v1', type = process.env.APPLE_PASS_TYPE_ID!;
  const registration = `${prefix}/devices/device-12345/registrations/${type}/${f.memberA.id}`;
  await request(f.app).post(registration).send({ pushToken: 'push-token-test' }).expect(401);
  await request(f.app).post(registration).set('Authorization', `ApplePass ${f.memberA.publicToken}`).send({ pushToken: 'push-token-test' }).expect(401);
  assert.equal(one(f.db, 'SELECT count(*) AS n FROM apple_registrations')!.n, 0);
  await request(f.app).get(`${prefix}/passes/${type}/${f.memberA.id}`).expect(401);
  await request(f.app).get(`${prefix}/passes/pass.wrong/${f.memberA.id}`).set('Authorization', `ApplePass ${f.memberA.appleToken}`).expect(404);
  await request(f.app).post(registration).set('Authorization', `ApplePass ${f.memberA.appleToken}`).send({ pushToken: 'push-token-test' }).expect(201);
  const updated = await request(f.app).get(`${prefix}/devices/device-12345/registrations/${type}`).expect(200);
  assert.deepEqual(updated.body.serialNumbers, [f.memberA.id]);
  await request(f.app).get(`${prefix}/devices/device-unknown/registrations/${type}`).expect(204);
  await request(f.app).delete(registration).set('Authorization', `ApplePass ${f.memberB.appleToken}`).expect(401);
  await request(f.app).delete(registration).set('Authorization', `ApplePass ${f.memberA.appleToken}`).expect(200);
});

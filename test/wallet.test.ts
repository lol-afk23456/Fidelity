import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildAppleDefinition, notifyAppleDevices } from '../server/wallet/apple.js';
import { getWalletStatus, publicBaseUrl, readServiceAccount } from '../server/wallet/config.js';
import { googleProviderError } from '../server/wallet/google.js';
import { walletIconPng } from '../server/wallet/icon.js';
import { buildGoogleMessage, buildGooglePayloads, googlePassIds, signGoogleSaveJwt } from '../server/wallet/payloads.js';
import { WalletError, type WalletMember, type WalletProgram } from '../server/wallet/types.js';

const member: WalletMember = { id: 'member-1', publicToken: 'public-scanner-token', appleAuthToken: 'a-strong-private-apple-auth-token',
  name: 'Anna Rossi', balance: 4, rewardCount: 1, updatedAt: '2026-09-26T10:00:00Z', offer: 'Un regalo per te' };
const program: WalletProgram = { id: 'program-1', name: 'Pausa caffè', type: 'stamps', rewardThreshold: 10,
  rewardName: 'Un caffè in omaggio', color: '#174436', description: 'Un timbro per ogni caffè.', tenantName: 'Caffè Roma' };
const baseUrl = 'https://fidelity.example';

test('Google Save JWT is cryptographically valid, scoped to the app origin, and contains only a server-issued reference', () => {
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privateKey = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const jwt = signGoogleSaveJwt({ client_email: 'wallet@demo.iam.gserviceaccount.com', private_key: privateKey, private_key_id: 'test-key' },
    '123.member_1', 'loyalty', baseUrl, 1_790_416_800);
  const [header, payload, signature] = jwt.split('.') as [string, string, string];
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url').toString()), { alg: 'RS256', typ: 'JWT', kid: 'test-key' });
  assert.deepEqual(JSON.parse(Buffer.from(payload, 'base64url').toString()), {
    iss: 'wallet@demo.iam.gserviceaccount.com', aud: 'google', typ: 'savetowallet', iat: 1_790_416_800,
    origins: [baseUrl], payload: { loyaltyObjects: [{ id: '123.member_1' }] },
  });
  assert.equal(verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), keys.publicKey, Buffer.from(signature, 'base64url')), true);
  assert.equal(verify('RSA-SHA256', Buffer.from(`${header}.${payload}changed`), keys.publicKey, Buffer.from(signature, 'base64url')), false);
  assert.equal(jwt.includes(member.appleAuthToken), false);
  assert.equal(jwt.includes('PRIVATE KEY'), false);
});

test('Google loyalty state uses authoritative balances and never includes Apple authentication secrets', () => {
  const payload = buildGooglePayloads(member, program, '123456', baseUrl);
  assert.equal(payload.kind, 'loyalty');
  assert.equal(payload.objectPayload.state, 'ACTIVE');
  const loyalty = payload.objectPayload as typeof payload.objectPayload & { loyaltyPoints: { balance: { int: number } }; secondaryLoyaltyPoints: { balance: { int: number } } };
  assert.equal(loyalty.loyaltyPoints.balance.int, 4);
  assert.equal(loyalty.secondaryLoyaltyPoints.balance.int, 0, 'redeemed rewards must not be confused with currently available rewards');
  assert.equal(payload.objectPayload.barcode.value, member.publicToken);
  assert.equal(JSON.stringify(payload).includes(member.appleAuthToken), false);
  assert.equal(payload.objectPayload.linksModuleData.uris[0]?.uri, `${baseUrl}/card/${member.publicToken}`);
  const advanced = buildGooglePayloads({ ...member, balance: 9 }, program, '123456', baseUrl);
  assert.equal(advanced.objectPayload.id, payload.objectPayload.id, 'updates must target the same installed pass');
});

test('Coupon redemption deactivates the Google offer and voids the Apple coupon', () => {
  const coupon = { ...program, type: 'coupon' as const, expiresAt: '2026-12-31T23:59:59Z' };
  const before = buildGooglePayloads({ ...member, balance: 1 }, coupon, '123456', baseUrl);
  const after = buildGooglePayloads({ ...member, balance: 0 }, coupon, '123456', baseUrl);
  assert.equal(before.kind, 'offer');
  assert.equal(before.objectPayload.state, 'ACTIVE');
  assert.equal(after.objectPayload.state, 'INACTIVE');
  assert.equal(after.objectPayload.validTimeInterval?.end.date, '2026-12-31T23:59:59.000Z');
  const apple = buildAppleDefinition({ ...member, balance: 0 }, coupon, { baseUrl, passTypeId: 'pass.test.coupon', teamId: 'TEAM123456' });
  assert.equal(apple.voided, true);
  assert.ok(apple.coupon);
});

test('Apple pass has the required update identity and does not turn marketing into an alert', () => {
  const apple = buildAppleDefinition(member, program, { baseUrl, passTypeId: 'pass.test.loyalty', teamId: 'TEAM123456' });
  assert.equal(apple.serialNumber, member.id);
  assert.equal(apple.authenticationToken, member.appleAuthToken);
  assert.equal(apple.webServiceURL, `${baseUrl}/api/wallet/apple`);
  assert.equal(apple.barcodes[0]?.message, member.publicToken);
  assert.equal(JSON.stringify(apple).includes('changeMessage'), false);
  assert.equal(JSON.stringify(apple).includes(member.offer!), true);
  assert.throws(() => buildAppleDefinition({ ...member, appleAuthToken: 'weak' }, program,
    { baseUrl, passTypeId: 'pass.test.loyalty', teamId: 'TEAM123456' }), WalletError);
});

test('IDs are stable, URL-safe and isolate the same customer across programs', () => {
  const first = googlePassIds('123', member, program);
  const other = googlePassIds('123', member, { ...program, id: 'another-program' });
  assert.deepEqual(first, googlePassIds('123', member, program));
  assert.notEqual(first.objectId, other.objectId);
  assert.notEqual(first.classId, other.classId);
  assert.match(first.objectId, /^123\.[a-z\d_]+$/);
  assert.throws(() => googlePassIds('../issuer', member, program), WalletError);
});

test('Invalid balance, geolocation, expiry and logo inputs fail before provider calls', () => {
  for (const balance of [-1, 0.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => buildGooglePayloads({ ...member, balance }, program, '123', baseUrl), WalletError);
  }
  assert.throws(() => buildGooglePayloads(member, { ...program, locations: [{ latitude: 91, longitude: 0 }] }, '123', baseUrl), WalletError);
  assert.throws(() => buildGooglePayloads(member, { ...program, locations: Array.from({ length: 11 }, () => ({ latitude: 1, longitude: 1 })) }, '123', baseUrl), WalletError);
  assert.throws(() => buildGooglePayloads(member, { ...program, logoUrl: 'http://insecure.test/logo.png' }, '123', baseUrl), WalletError);
  assert.throws(() => buildGooglePayloads(member, { ...program, expiresAt: 'not-a-date' }, '123', baseUrl), WalletError);
});

test('Provider errors are truthful and sanitized, with retryability limited by response', () => {
  const secret = 'PRIVATE-KEY-AND-BEARER-TOKEN';
  const forbidden = googleProviderError({ message: secret, response: { status: 403, data: { secret } }, config: { authorization: secret } });
  assert.equal(forbidden.code, 'GOOGLE_ACCESS_DENIED');
  assert.equal(forbidden.retryable, false);
  assert.equal(forbidden.providerStatus, 403);
  assert.equal(JSON.stringify(forbidden).includes(secret), false);
  assert.equal(forbidden.message.includes(secret), false);
  assert.equal(googleProviderError({ response: { status: 429 } }).retryable, true);
  assert.equal(googleProviderError({ response: { status: 503 } }).retryable, true);
});

test('Missing or invalid credentials never report configured; HTTPS public origin is required', () => {
  const status = getWalletStatus({});
  assert.equal(status.apple.configured, false);
  assert.equal(status.google.configured, false);
  assert.ok(status.google.missing.includes('GOOGLE_ISSUER_ID'));
  for (const url of ['http://fidelity.example', 'https://localhost', 'https://example.com/path', 'https://user:pass@example.com']) {
    assert.throws(() => publicBaseUrl({ PUBLIC_BASE_URL: url }), WalletError);
  }
  assert.equal(publicBaseUrl({ PUBLIC_BASE_URL: `${baseUrl}/` }), baseUrl);
  const dir = mkdtempSync(join(tmpdir(), 'wallet-test-'));
  try {
    const file = join(dir, 'invalid.json');
    writeFileSync(file, JSON.stringify({ private_key: 'DO-NOT-LEAK-ME', client_email: 'x@example.com' }));
    assert.throws(() => readServiceAccount(file), error => error instanceof WalletError && !error.message.includes('DO-NOT-LEAK-ME'));
    assert.equal(getWalletStatus({ PUBLIC_BASE_URL: baseUrl, GOOGLE_ISSUER_ID: '123', GOOGLE_SERVICE_ACCOUNT_FILE: file }).google.configured, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('Google issuer messages use notification type explicitly and enforce bounded plain text', () => {
  const message = buildGoogleMessage({ id: 'campaign-1', title: 'Offerta', body: '<b>Solo oggi</b>' });
  assert.equal(message.message.messageType, 'TEXT_AND_NOTIFY');
  assert.equal(message.message.body.includes('<'), false);
  assert.throws(() => buildGoogleMessage({ id: 'x', title: 'T', body: 'a'.repeat(1001) }), WalletError);
});

test('No devices is a no-op, and fallback icon is a real PNG at the requested dimensions', async () => {
  assert.deepEqual(await notifyAppleDevices([]), { invalidTokens: [] });
  const png = walletIconPng(87);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 87);
  assert.equal(png.readUInt32BE(20), 87);
});

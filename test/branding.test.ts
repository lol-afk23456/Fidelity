import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import request from 'supertest';
import { sanitizeLogo, programLogo } from '../server/branding.js';
import { AppError } from '../server/domain.js';
import { createApp } from '../server/app.js';
import { openDb, id, run, one, now, token, passwordHash } from '../server/db.js';

const dataUrl = (bytes: Buffer, mime = 'png') => `data:image/${mime};base64,${bytes.toString('base64')}`;
const image = (width = 640, height = 200) => sharp({ create: { width, height, channels: 4, background: { r: 40, g: 100, b: 75, alpha: 0.5 } } });

test('PNG logos preserve alpha while fitting the 320×100 Wallet canvas without metadata', async () => {
  const source = await image(400, 400).withMetadata({ exif: { IFD0: { Artist: 'PRIVATE-METADATA' } } }).png().toBuffer();
  assert.ok((await sharp(source).metadata()).exif);
  const output = await sanitizeLogo(dataUrl(source));
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.format, 'png');
  assert.equal(metadata.width, 320);
  assert.equal(metadata.height, 100);
  assert.equal(metadata.hasAlpha, true);
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.icc, undefined);
  assert.equal(metadata.xmp, undefined);
  assert.equal(output.includes(Buffer.from('PRIVATE-METADATA')), false);
  const { data, info } = await sharp(output).raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.channels, 4);
  assert.equal(data[3], 0, 'unused canvas area must remain transparent');
  assert.ok(data[(50 * 320 + 160) * 4 + 3]! > 0, 'the logo must still be visible');
});

test('real JPEG and WebP files are decoded and re-encoded as static PNG', async () => {
  for (const format of ['jpeg', 'webp'] as const) {
    const source = await image()[format]().toBuffer();
    const result = await sanitizeLogo(dataUrl(source, format));
    const metadata = await sharp(result).metadata();
    assert.equal(metadata.format, 'png');
    assert.equal(metadata.width, 320);
    assert.equal(metadata.height, 100);
    assert.equal(metadata.hasAlpha, true);
  }
});

test('SVG, remote URLs, MIME mismatches and fake raster headers are rejected before storage', async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><image href="https://private.example/data"/></svg>');
  const jpeg = await image().jpeg().toBuffer();
  const fakePng = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), svg]);
  for (const value of [dataUrl(svg, 'svg+xml'), dataUrl(svg), dataUrl(jpeg, 'png'), dataUrl(fakePng), 'https://example.com/logo.png', 'file:///private/logo.png']) {
    await assert.rejects(sanitizeLogo(value), error => error instanceof AppError && error.code === 'INVALID_LOGO');
  }
});

test('noncanonical base64 and truncated images cannot pass validation', async () => {
  const png = await image().png().toBuffer();
  for (const value of ['data:image/png;base64,!!!!', 'data:image/png;base64,AAAAA', dataUrl(png.subarray(0, 40)),
    dataUrl(png).replace(';base64,', ';base64,\n')]) {
    await assert.rejects(sanitizeLogo(value), error => error instanceof AppError && error.status === 400);
  }
});

test('decoded file size is limited to 512 KiB even when the image signature is valid', async () => {
  const png = await image().png().toBuffer();
  const tooLarge = Buffer.concat([png, Buffer.alloc(512 * 1024 + 1 - png.length)]);
  await assert.rejects(sanitizeLogo(dataUrl(tooLarge)), error => error instanceof AppError && /512/.test(error.message));
});

test('highly compressed images above two million pixels are rejected, while the boundary is accepted', async () => {
  const tooLarge = await image(2001, 1000).png().toBuffer();
  assert.ok(tooLarge.length < 512 * 1024, 'fixture must exercise the pixel limit, not the byte limit');
  await assert.rejects(sanitizeLogo(dataUrl(tooLarge)), error => error instanceof AppError && /milioni/.test(error.message));
  const boundary = await image(2000, 1000).png().toBuffer();
  const metadata = await sharp(await sanitizeLogo(dataUrl(boundary))).metadata();
  assert.equal(metadata.width, 320);
  assert.equal(metadata.height, 100);
});

test('authorized branding upload persists sanitized bytes, updates only own members, and serves public logos safely', async t => {
  process.env.PUBLIC_BASE_URL = 'http://localhost:5173';
  process.env.NODE_ENV = 'test';
  const db = openDb(':memory:');
  t.after(() => db.close());
  const tenantA = id(), tenantB = id(), ownerId = id(), staffId = id(), ownProgram = id(), otherProgram = id(), memberId = id();
  for (const [tid, slug] of [[tenantA, 'logo-alpha'], [tenantB, 'logo-beta']]) run(db,
    'INSERT INTO tenants(id,name,slug,created_at) VALUES(?,?,?,?)', tid, slug, slug, now());
  const password = 'Branding-integration-password';
  const hash = passwordHash(password);
  for (const [uid, role] of [[ownerId, 'owner'], [staffId, 'staff']]) run(db,
    'INSERT INTO users(id,tenant_id,name,email,password_hash,role,created_at) VALUES(?,?,?,?,?,?,?)', uid, tenantA, `User ${role}`, `${role}@branding.test`, hash, role, now());
  for (const [pid, tid] of [[ownProgram, tenantA], [otherProgram, tenantB]]) run(db,
    'INSERT INTO programs(id,tenant_id,name,type,reward_threshold,reward_name,color,created_at) VALUES(?,?,?,?,?,?,?,?)', pid, tid, 'Carta logo', 'stamps', 10, 'Premio', '#123456', now());
  run(db, 'INSERT INTO members(id,tenant_id,program_id,name,email,consent_at,public_token,apple_auth_token,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
    memberId, tenantA, ownProgram, 'Cliente Test', 'member@branding.test', now(), token(), token(), now(), now());
  const app = createApp(db), logo = dataUrl(await image().png().toBuffer());
  async function login(role: string) {
    const response = await request(app).post('/api/auth/login').set('Origin', process.env.PUBLIC_BASE_URL!).send({ email: `${role}@branding.test`, password }).expect(200);
    return { cookie: (response.headers['set-cookie'] as unknown as string[]).map(x => x.split(';')[0]).join('; '), csrf: response.body.csrfToken };
  }
  const owner = await login('owner'), staff = await login('staff');
  await request(app).post(`/api/programs/${ownProgram}/logo`).set('Origin', process.env.PUBLIC_BASE_URL!).send({ dataUrl: logo }).expect(401);
  await request(app).post(`/api/programs/${ownProgram}/logo`).set('Origin', process.env.PUBLIC_BASE_URL!).set('Cookie', staff.cookie).set('x-csrf-token', staff.csrf).send({ dataUrl: logo }).expect(403);
  await request(app).post(`/api/programs/${otherProgram}/logo`).set('Origin', process.env.PUBLIC_BASE_URL!).set('Cookie', owner.cookie).set('x-csrf-token', owner.csrf).set('x-tenant-id', tenantB).send({ dataUrl: logo }).expect(404);
  assert.equal(programLogo(db, ownProgram), undefined);
  const uploaded = await request(app).post(`/api/programs/${ownProgram}/logo`).set('Origin', process.env.PUBLIC_BASE_URL!).set('Cookie', owner.cookie).set('x-csrf-token', owner.csrf).send({ dataUrl: logo }).expect(200);
  assert.match(uploaded.body.logoUrl, new RegExp(`/api/branding/${ownProgram}\\.png\\?v=`));
  const persisted = programLogo(db, ownProgram)!;
  assert.equal((await sharp(persisted).metadata()).width, 320);
  assert.equal(one(db, 'SELECT count(*) AS n FROM branding')!.n, 1);
  assert.equal(one(db, 'SELECT count(*) AS n FROM jobs WHERE member_id=?', memberId)!.n, 1);
  assert.equal(one(db, 'SELECT count(*) AS n FROM audit WHERE action=?', 'program.logo_updated')!.n, 1);
  assert.ok(one(db, 'SELECT update_seq FROM members WHERE id=?', memberId)!.update_seq > 0);
  const publicLogo = await request(app).get(`/api/branding/${ownProgram}.png`).expect(200);
  assert.match(publicLogo.headers['content-type'], /^image\/png/);
  assert.equal(publicLogo.headers['x-content-type-options'], 'nosniff');
  assert.equal(publicLogo.headers['cache-control'], 'public, max-age=300');
  assert.deepEqual(publicLogo.body, persisted);
  await request(app).get(`/api/branding/${otherProgram}.png`).expect(404);
  run(db, 'UPDATE tenants SET active=0 WHERE id=?', tenantA);
  await request(app).get(`/api/branding/${ownProgram}.png`).expect(404);
});

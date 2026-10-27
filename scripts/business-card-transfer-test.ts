import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import initSqlJs, { type Database } from 'sql.js';
import { handleBusinessCardTransfer } from '../apps/cloudflare/src/business-card-transfer';
import type { CloudflareEnv } from '../apps/cloudflare/src/index';

class Statement {
  private values: unknown[] = [];
  constructor(private readonly db: Database, private readonly sql: string) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  async first<T>() { const s = this.db.prepare(this.sql); try { s.bind(this.values as never[]); return s.step() ? s.getAsObject() as T : null; } finally { s.free(); } }
  async all<T>() { const s = this.db.prepare(this.sql); const results: T[] = []; try { s.bind(this.values as never[]); while (s.step()) results.push(s.getAsObject() as T); return { results }; } finally { s.free(); } }
  async run() { this.db.run(this.sql, this.values as never[]); return { success: true, meta: { changes: this.db.getRowsModified() } }; }
}
class D1 {
  constructor(private readonly db: Database) {}
  prepare(sql: string) { return new Statement(this.db, sql); }
  async batch(statements: Statement[]) { this.db.run('BEGIN'); try { const results = []; for (const statement of statements) results.push(await statement.run()); this.db.run('COMMIT'); return results; } catch (error) { this.db.run('ROLLBACK'); throw error; } }
}
const origin = 'https://claim.example.test';
const base = `${origin}/api/business-cards/transfers`;
const jpeg = (fill: number) => new File([new Uint8Array([0xff, 0xd8, 0xff, ...Array(16).fill(fill), 0xff, 0xd9])], `card-${fill}.jpg`, { type: 'image/jpeg' });
async function setup() {
  const SQL = await initSqlJs(); const db = new SQL.Database(); db.run('PRAGMA foreign_keys=ON');
  db.run("CREATE TABLE preview_users(id TEXT PRIMARY KEY); INSERT INTO preview_users VALUES('owner'),('other'); CREATE TABLE preserved(id TEXT PRIMARY KEY, value TEXT); INSERT INTO preserved VALUES('one','unchanged');");
  const migration = readFileSync('apps/cloudflare/migrations/0070_business_card_transfers.sql', 'utf8'); db.run(migration); db.run(migration);
  assert.equal(db.exec('SELECT value FROM preserved')[0].values[0][0], 'unchanged');
  const env: CloudflareEnv = { DB: new D1(db), GOOGLE_WORKSPACE_CREDENTIAL_MASTER_KEY: '42'.repeat(32) };
  const call = (path: string, init: RequestInit = {}, id = 'owner') => handleBusinessCardTransfer(new Request(path, init), env, { id });
  return { db, env, call };
}
async function create(call: Awaited<ReturnType<typeof setup>>['call']) {
  const response = await call(base, { method: 'POST' }); assert.equal(response.status, 201);
  const data = await response.json() as { token: string; expiresAt: string }; assert.match(data.token, /^[0-9a-f]{48}$/); return data;
}
function upload(front: File | null, back: File | null) { const body = new FormData(); if (front) body.set('file', front); if (back) body.set('backFile', back); return { method: 'POST', body }; }
function withToken(call: Awaited<ReturnType<typeof setup>>['call'], token: string) {
  return (path: string, init: RequestInit = {}, id = 'owner') => {
    assert(!path.includes(token), 'normal transfer requests must not put their secret in the URL');
    const headers = new Headers(init.headers); headers.set('X-Card-Transfer-Token', token);
    return call(path, { ...init, headers }, id);
  };
}

test('two sides use owner-scoped, encrypted, expiring and single-use transfer', async () => {
  const { db, call: rawCall } = await setup(); const { token } = await create(rawCall); const call = withToken(rawCall, token); const path = `${base}/session`;
  assert.equal((await rawCall(path)).status, 404);
  assert.equal((await rawCall(path, { headers: { 'X-Card-Transfer-Token': 'invalid' } })).status, 404);
  assert.equal((await rawCall(`${base}/${token}`, { headers: { 'X-Card-Transfer-Token': token } })).status, 404);
  assert.equal((await rawCall(`${path}?token=${token}`, { headers: { 'X-Card-Transfer-Token': token } })).status, 400);
  assert.equal((await call(path, {}, 'other')).status, 404);
  assert.equal((await call(`${path}/upload`, upload(jpeg(1), jpeg(2)), 'other')).status, 404);
  assert.equal((await call(`${path}/upload`, upload(jpeg(1), null))).status, 400);
  assert.equal((await call(path)).status, 200);
  assert.equal((await call(`${path}/upload`, upload(jpeg(1), jpeg(2)))).status, 200);
  assert.equal((await call(`${path}/upload`, upload(jpeg(3), jpeg(4)))).status, 409);
  for (const [side, value] of [['front', 1], ['back', 2]] as const) {
    const response = await call(`${path}/photo?side=${side}`); assert.equal(response.status, 200);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array(await jpeg(value).arrayBuffer()));
  }
  const rows = db.exec('SELECT ciphertext,iv FROM preview_business_card_transfer_images'); assert.equal(rows[0].values.length, 2);
  assert(!JSON.stringify(rows).includes(token)); assert.notEqual(rows[0].values[0][1], rows[0].values[1][1]);
  assert.equal((await call(path, { method: 'DELETE' }, 'other')).status, 404);
  assert.equal((await call(path, { method: 'DELETE' })).status, 200);
  assert.equal((await call(path)).status, 404); assert.equal(db.exec('SELECT COUNT(*) FROM preview_business_card_transfer_images')[0].values[0][0], 0);
});

test('rejects wrong image content, oversized body, cross-origin and expired token without storing photos', async () => {
  const { db, call: rawCall } = await setup(); const { token } = await create(rawCall); const call = withToken(rawCall, token); const path = `${base}/session`;
  const bad = new File([new Uint8Array(20).fill(4)], 'bad.jpg', { type: 'image/jpeg' });
  assert.equal((await call(`${path}/upload`, upload(jpeg(1), bad))).status, 415);
  assert.equal((await call(`${path}/upload`, { ...upload(jpeg(1), jpeg(2)), headers: { Origin: 'https://other.example' } })).status, 403);
  const big = new File([new Uint8Array(900_001).fill(0xff)], 'big.jpg', { type: 'image/jpeg' });
  assert.equal((await call(`${path}/upload`, upload(jpeg(1), big))).status, 413);
  assert.equal(db.exec('SELECT COUNT(*) FROM preview_business_card_transfer_images')[0].values[0][0], 0);
  db.run("UPDATE preview_business_card_transfers SET expires_at='2000-01-01T00:00:00.000Z'");
  assert.equal((await call(path)).status, 404); assert.equal((await call(`${path}/upload`, upload(jpeg(1), jpeg(2)))).status, 404);
  await create(rawCall); assert.equal(db.exec('SELECT COUNT(*) FROM preview_business_card_transfers')[0].values[0][0], 1);
});

test('a back-image database failure rolls back the status and both images', async () => {
  const { db, call: rawCall } = await setup(); const { token } = await create(rawCall); const call = withToken(rawCall, token); const path = `${base}/session`;
  db.run("CREATE TRIGGER test_fail_back BEFORE INSERT ON preview_business_card_transfer_images WHEN NEW.side='back' BEGIN SELECT RAISE(ABORT,'test failure'); END;");
  assert.equal((await call(`${path}/upload`, upload(jpeg(1), jpeg(2)))).status, 503);
  assert.equal((await (await call(path)).json() as {status:string}).status, 'PENDING');
  assert.equal(db.exec('SELECT COUNT(*) FROM preview_business_card_transfer_images')[0].values[0][0], 0);
  db.run('DROP TRIGGER test_fail_back');
  assert.equal((await call(`${path}/upload`, upload(jpeg(1), jpeg(2)))).status, 200);
});

test('authenticated encryption rejects modified stored image content', async () => {
  const { db, call: rawCall } = await setup(); const { token } = await create(rawCall); const call = withToken(rawCall, token); const path = `${base}/session`;
  assert.equal((await call(`${path}/upload`, upload(jpeg(1), jpeg(2)))).status, 200);
  db.run("UPDATE preview_business_card_transfer_images SET ciphertext='AAAA' WHERE side='front'");
  assert.equal((await call(`${path}/photo?side=front`)).status, 503);
  assert.equal((await call(`${path}/photo?side=back`)).status, 200);
});

test('only the owner can close an expired connection and remove its encrypted images', async () => {
  const { db, call: rawCall } = await setup(); const { token } = await create(rawCall); const call = withToken(rawCall, token); const path = `${base}/session`;
  assert.equal((await call(`${path}/upload`, upload(jpeg(1), jpeg(2)))).status, 200);
  db.run("UPDATE preview_business_card_transfers SET expires_at='2000-01-01T00:00:00.000Z'");
  assert.equal((await call(path)).status, 404);
  assert.equal((await call(`${path}/photo?side=front`)).status, 404);
  assert.equal((await call(`${path}/upload`, upload(jpeg(1), jpeg(2)))).status, 404);
  assert.equal((await call(path, { method: 'DELETE' }, 'other')).status, 404);
  assert.equal(db.exec('SELECT COUNT(*) FROM preview_business_card_transfer_images')[0].values[0][0], 2);
  assert.equal((await call(path, { method: 'DELETE' })).status, 200);
  assert.equal(db.exec('SELECT COUNT(*) FROM preview_business_card_transfer_images')[0].values[0][0], 0);
  assert.equal(db.exec('SELECT COUNT(*) FROM preview_business_card_transfers')[0].values[0][0], 0);
});

test('key configuration is required and no more than three transfers are active per actor', async () => {
  const { db, env, call } = await setup(); const noKey = { ...env, GOOGLE_WORKSPACE_CREDENTIAL_MASTER_KEY: undefined };
  assert.equal((await handleBusinessCardTransfer(new Request(base, { method: 'POST' }), noKey, { id: 'owner' })).status, 503);
  assert.equal(db.exec('SELECT COUNT(*) FROM preview_business_card_transfers')[0].values[0][0], 0);
  await create(call); await create(call); await create(call);
  assert.equal((await call(base, { method: 'POST' })).status, 429);
});

test('cookie writes require same origin and cross-site writes are denied', async () => {
  const { db, call: rawCall } = await setup();
  const cookie = 'claim_center_session=test-session';
  const badHeaders = [
    { Cookie: cookie },
    { Cookie: cookie, Origin: 'https://other.example' },
    { Cookie: cookie, Origin: origin, 'Sec-Fetch-Site': 'cross-site' },
    { 'X-Session-Token': 'test', 'Sec-Fetch-Site': 'cross-site' },
    { Cookie: cookie, 'X-Session-Token': 'test' }
  ];
  for (const headers of badHeaders) assert.equal((await rawCall(base, { method: 'POST', headers })).status, 403);
  assert.equal(db.exec('SELECT COUNT(*) FROM preview_business_card_transfers')[0].values[0][0], 0);
  const allowed = await rawCall(base, { method: 'POST', headers: { Cookie: cookie, Origin: origin, 'Sec-Fetch-Site': 'same-origin' } });
  assert.equal(allowed.status, 201); const { token } = await allowed.json() as { token: string };
  const call = withToken(rawCall, token); const path = `${base}/session`;
  assert.equal((await call(path)).status, 200);
  assert.equal((await call(`${path}/upload`, { ...upload(jpeg(1), jpeg(2)), headers: { Cookie: cookie } })).status, 403);
  assert.equal((await call(`${path}/upload`, { ...upload(jpeg(1), jpeg(2)), headers: { Cookie: cookie, Origin: origin, 'Sec-Fetch-Site': 'same-origin' } })).status, 200);
  assert.equal((await call(path, { method: 'DELETE', headers: { Cookie: cookie, Origin: origin, 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await call(path, { method: 'DELETE', headers: { 'X-Session-Token': 'test' } })).status, 200);
});

test('SQLite migration is additive and idempotent on a populated database', async () => {
  const SQL = await initSqlJs(); const db = new SQL.Database(); db.run('PRAGMA foreign_keys=ON');
  db.run('CREATE TABLE "Organization" (id TEXT PRIMARY KEY); CREATE TABLE "User" (id TEXT PRIMARY KEY); INSERT INTO "Organization" VALUES(\'o\'); INSERT INTO "User" VALUES(\'u\'); CREATE TABLE existing(id TEXT PRIMARY KEY); INSERT INTO existing VALUES(\'keep\');');
  const migration = readFileSync('packages/database/prisma/migrations/20261027090000_business_card_transfers/migration.sql', 'utf8'); db.run(migration); db.run(migration);
  assert.equal(db.exec('SELECT id FROM existing')[0].values[0][0], 'keep'); assert.equal(db.exec('PRAGMA integrity_check')[0].values[0][0], 'ok'); assert.equal(db.exec('PRAGMA foreign_key_check').length, 0);
});

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import initSqlJs, { type Database } from 'sql.js';
import worker, { type CloudflareEnv } from '../apps/cloudflare/src/index';

// All keys, accounts, provider replies and database records below are synthetic.
const ADMIN = '13200000-0000-4000-8000-000000000001', STAFF = '13200000-0000-4000-8000-000000000002';
const KEY = 'CF132SYNTHETICKEY0123456789', ENV_KEY = 'CF132ENVIRONMENTKEY012345', SECOND_KEY = 'CF132SECONDKEY01234567890';
const endpoint = '/api/settings/ecos', table = 'preview_ecos_api_settings';
const migrationRoot = 'apps/cloudflare/migrations/';
const migration = readFileSync(migrationRoot + '0064_cf132_ecos_api_settings.sql', 'utf8');
const now = '2026-09-09T00:00:00.000Z';
const token = (id: string) => 'cf132-synthetic-token-' + id;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const sqlReady = initSqlJs();
type Value = string | number | null;
function rows(db: Database, sql: string, values: Value[] = []): Record<string, any>[] {
  const statement = db.prepare(sql), result: Record<string, any>[] = [];
  try { statement.bind(values); while (statement.step()) result.push(statement.getAsObject()); return result; } finally { statement.free(); }
}
const snapshot = (db: Database, omit: string[] = []) => Object.fromEntries(rows(db, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").filter(row => !omit.includes(row.name)).map(row => [row.name, rows(db, `SELECT * FROM "${row.name}" ORDER BY rowid`)]));
class D1 {
  beforeWrite?: () => Promise<void>;
  constructor(readonly db: Database) {}
  prepare(sql: string, values: Value[] = []): any {
    return { bind: (...bound: Value[]) => this.prepare(sql, bound), sql, values,
      first: async () => rows(this.db, sql, values)[0] ?? null, all: async () => ({ results: rows(this.db, sql, values) }),
      run: async () => {
        if (/^(?:UPDATE|INSERT).*preview_ecos_api_settings/i.test(sql)) { const hook = this.beforeWrite; this.beforeWrite = undefined; if (hook) await hook(); }
        this.db.run(sql, values); return { success: true, meta: { changes: this.db.getRowsModified() } };
      } };
  }
  async batch(statements: { sql: string; values: Value[] }[]) {
    this.db.run('BEGIN IMMEDIATE');
    try { for (const s of statements) this.db.run(s.sql, s.values); this.db.run('COMMIT'); return []; } catch (error) { this.db.run('ROLLBACK'); throw error; }
  }
}
async function fixture(apply = true) {
  const SQL = await sqlReady, db = new SQL.Database(); db.run('PRAGMA foreign_keys=ON');
  const foundation = ['0001_cf_foundation.sql', '0001_cf02_preview_drafts.sql', '0002_cf03_preview_evidence.sql', '0003_cf04_preview_auth.sql'];
  const applySql = (name: string) => db.exec(readFileSync(migrationRoot + name, 'utf8'));
  foundation.forEach(applySql);
  for (const id of [ADMIN, STAFF]) db.run('INSERT INTO preview_users(id,login_id,password_salt,password_hash,password_iterations,display_name,email,roles_json,is_active,created_at) VALUES(?,?,?,?,?,?,?,?,1,?)', [id, id, '1'.repeat(32), '2'.repeat(64), 100000, '합성 검수자', `${id}@example.invalid`, id === ADMIN ? '["admin"]' : '["staff"]', now]);
  readdirSync(migrationRoot).filter(name => /^\d{4}_.+\.sql$/.test(name) && Number(name.slice(0, 4)) <= 63 && !foundation.includes(name)).sort().forEach(applySql);
  for (const id of [ADMIN, STAFF]) db.run('INSERT INTO preview_sessions(id_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)', [hash(token(id)), id, now, '2099-01-01T00:00:00.000Z']);
  if (apply) db.exec(migration);
  const adapter = new D1(db), calls: URL[] = [], control: { mode: string; beforeFetch?: () => Promise<void> } = { mode: '' };
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input)); calls.push(url);
    assert.equal(url.origin, 'https://ecos.bok.or.kr'); assert.equal(init?.redirect, 'manual');
    const hook = control.beforeFetch; control.beforeFetch = undefined; if (hook) await hook();
    if (control.mode === 'HTTP') return new Response('private error ' + KEY, { status: 403 });
    if (control.mode === 'NETWORK') throw new Error('private upstream https://ecos.bok.or.kr/' + KEY);
    if (control.mode === 'JSON') return new Response('not JSON ' + KEY);
    if (control.mode === 'NO_DATA') return Response.json({ RESULT: { CODE: 'INFO-200', MESSAGE: 'no data ' + KEY } });
    if (control.mode === 'AUTH') return Response.json({ RESULT: { CODE: 'INFO-100', MESSAGE: 'private ' + KEY } });
    if (control.mode === 'RATE') return Response.json({ RESULT: { CODE: 'ERROR-602', MESSAGE: 'private ' + KEY } });
    const p = url.pathname.split('/').filter(Boolean), code = p[11];
    const name: Record<string, string> = { '201AA': '광산품', '3AA': '공산품', '4AA': '전력,가스,수도및폐기물', '101AA': '농림수산품' };
    assert.ok(name[code]);
    return Response.json({ StatisticSearch: { list_total_count: 1, row: [{ STAT_CODE: '404Y014', ITEM_CODE1: code, ITEM_NAME1: name[code], ITEM_CODE2: null, ITEM_CODE3: null, ITEM_CODE4: null, UNIT_NAME: '2020=100', TIME: p[9], DATA_VALUE: '123.45' }] } });
  };
  const env = { DB: adapter as unknown as NonNullable<CloudflareEnv['DB']>, AI_CREDENTIAL_MASTER_KEY: '1'.repeat(64), ECOS_API_KEY: ENV_KEY, ECOS_API_TEST_FETCH: fetcher } as CloudflareEnv & { ECOS_API_KEY?: string; ECOS_API_TEST_FETCH: typeof fetch };
  const call = (path = endpoint, method = 'GET', body?: unknown, id = ADMIN, headers: Record<string, string> = {}) => {
    const auth: Record<string, string> = id ? { 'X-Session-Token': token(id) } : {};
    return worker.fetch(new Request('https://preview.example' + path, { method, headers: { ...auth, Origin: 'https://preview.example', 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env);
  };
  const save = (apiKey = KEY, expectedVersion = 0) => call(endpoint, 'PUT', { apiKey, expectedVersion });
  const verify = () => { assert.deepEqual(db.exec('PRAGMA integrity_check')[0].values, [['ok']]); assert.deepEqual(db.exec('PRAGMA foreign_key_check'), []); };
  return { db, adapter, env, control, calls, call, save, verify };
}
async function result(response: Response, status = 200): Promise<any> { const text = await response.text(); assert.equal(response.status, status, text); return JSON.parse(text); }

test('CF132 ECOS additive migration preserves populated pre-existing rows and remains idempotent', async () => {
  const { db, verify } = await fixture(false);
  try { const before = snapshot(db); db.exec(migration); assert.deepEqual(snapshot(db, [table]), before); const after = snapshot(db); db.exec(migration); assert.deepEqual(snapshot(db), after); verify(); }
  finally { db.close(); }
});

test('CF132 ECOS settings are admin-only and retain same-origin/JSON trust boundaries', async () => {
  const { db, call, calls } = await fixture();
  try {
    const before = snapshot(db);
    for (const [path, method, body] of [[endpoint, 'GET', undefined], [endpoint, 'PUT', { apiKey: KEY, expectedVersion: 0 }], [endpoint + '/test', 'POST', { expectedVersion: 0 }]] as const) {
      await result(await call(path, method, body, ''), 401); await result(await call(path, method, body, STAFF), 403);
    }
    const rejectedHeaders: Record<string, string>[] = [{ Origin: 'https://foreign.invalid' }, { 'Sec-Fetch-Site': 'cross-site' }, { Origin: '', Cookie: 'arbitrary=value' }];
    for (const headers of rejectedHeaders) await result(await call(endpoint, 'PUT', { apiKey: KEY, expectedVersion: 0 }, ADMIN, headers), 403);
    await result(await call(endpoint, 'PUT', { apiKey: KEY, expectedVersion: 0 }, ADMIN, { 'Content-Type': 'text/plain' }), 415);
    assert.deepEqual(snapshot(db), before); assert.equal(calls.length, 0);
  } finally { db.close(); }
});

test('CF132 ECOS encrypted save exposes metadata only and preserves law/AI/Google settings and all ES data', async () => {
  const { db, call, save, calls, verify } = await fixture();
  try {
    const law = await call('/api/settings/law-api', 'PUT', { oc: 'cf132_synthetic_law_oc', expectedVersion: 0 }); await result(law);
    const untouched = snapshot(db, [table]); const initial = await result(await call());
    assert.equal(initial.settings.version, 0); assert.equal(initial.settings.configured, false);
    assert.equal(initial.settings.storage, 'NONE');
    const saved = await result(await save()); assert.equal(saved.settings.version, 1); assert.equal(saved.settings.storage, 'ENCRYPTED_D1'); assert.equal(saved.settings.configured, true);
    const raw = rows(db, `SELECT * FROM ${table}`)[0]; assert.match(raw.ciphertext_hex, /^[0-9a-f]+$/); assert.match(raw.iv_hex, /^[0-9a-f]{24}$/);
    assert.equal(Buffer.from(db.export()).includes(Buffer.from(KEY)), false);
    const reloaded = await result(await call()); for (const payload of [initial, saved, reloaded]) { assert.ok(!JSON.stringify(payload).includes(KEY)); assert.ok(!JSON.stringify(payload).includes(ENV_KEY)); assert.equal(payload.settings.apiKey, undefined); assert.equal(payload.settings.ciphertextHex, undefined); }
    assert.deepEqual(snapshot(db, [table]), untouched); assert.equal(calls.length, 0, 'saving does not make an external request'); verify();
  } finally { db.close(); }
});

test('CF132 ECOS invalid/stale key writes preserve encrypted credentials, and missing master key cannot replace them', async () => {
  const { db, call, save, env } = await fixture();
  try {
    await result(await save()); const before = snapshot(db);
    await result(await save(SECOND_KEY, 0), 409);
    for (const apiKey of ['', 'sample', 'short', 'a'.repeat(101), 'https://wrong.invalid/', KEY + '?', ' ']) await result(await call(endpoint, 'PUT', { apiKey, expectedVersion: 1 }), 400);
    for (const expectedVersion of [undefined, '1', -1, 1.5]) await result(await call(endpoint, 'PUT', { apiKey: KEY, expectedVersion }), 400);
    await result(await call(endpoint, 'PUT', { apiKey: KEY, expectedVersion: 1, organizationId: 'forged' }), 400);
    delete env.AI_CREDENTIAL_MASTER_KEY; await result(await save(SECOND_KEY, 1), 503); assert.deepEqual(snapshot(db), before);
  } finally { db.close(); }
});

test('CF132 only the administrator-saved ECOS key powers connection test and staff ES lookup, without exposing credentials', async () => {
  const { db, call, save, calls } = await fixture();
  try {
    const source = '/api/es/sources/ecos?date=2024-06-15&date=2026-05-01&date=2026-04-30';
    await result(await call(source, 'GET', undefined, ''), 401);
    const unconfigured = await result(await call(source, 'GET', undefined, STAFF), 503); assert.equal(calls.length, 0, 'an unregistered environment variable is not a credential fallback');
    await result(await save()); calls.length = 0;
    const checked = await result(await call(endpoint + '/test', 'POST', { expectedVersion: 1 })); assert.ok(checked.checkedAt); assert.ok(calls.length > 0); assert.ok(calls.every(u => u.pathname.split('/')[3] === KEY));
    const before = snapshot(db), requested = calls.length;
    await result(await call(endpoint + '/test', 'POST', { expectedVersion: 0 }), 409); assert.equal(calls.length, requested);
    const response = await result(await call(source, 'GET', undefined, STAFF)); assert.equal(response.items.length, 3);
    for (const item of response.items) { assert.ok(item.month); assert.match(item.source, /404Y014.*2020=100/); assert.ok(item.checkedAt); }
    for (const payload of [unconfigured, checked, response]) { assert.ok(!JSON.stringify(payload).includes(KEY)); assert.ok(!JSON.stringify(payload).includes(ENV_KEY)); }
    assert.deepEqual(snapshot(db), before);
  } finally { db.close(); }
});

test('CF132 ECOS provider and decryption failures fail closed without fallback, key echoes or mutations', async () => {
  const { db, call, save, env, control, calls } = await fixture();
  try {
    await result(await save()); const before = snapshot(db);
    for (const [mode, diagnostic] of [['HTTP', 'HTTP 403'], ['NETWORK', 'NETWORK'], ['JSON', 'INVALID_JSON'], ['NO_DATA', 'INFO-200'], ['AUTH', 'INFO-100'], ['RATE', 'ERROR-602']]) {
      control.mode = mode; const response = await call(endpoint + '/test', 'POST', { expectedVersion: 1 });
      assert.equal(response.status, 502); const text = await response.text(); assert.ok(!text.includes(KEY)); assert.ok(!text.includes(ENV_KEY)); assert.deepEqual(snapshot(db), before);
      assert.ok(text.includes(diagnostic), 'connection endpoint must preserve safe provider diagnosis');
    }
    control.mode = ''; env.AI_CREDENTIAL_MASTER_KEY = '2'.repeat(64); const count = calls.length;
    for (const [path, method, body] of [[endpoint + '/test', 'POST', { expectedVersion: 1 }], ['/api/es/sources/ecos?date=2026-04-30', 'GET', undefined]] as const) {
      const response = await call(path, method, body); assert.ok(response.status >= 400); const text = await response.text(); assert.ok(!text.includes(KEY)); assert.ok(!text.includes(ENV_KEY));
    }
    assert.equal(calls.length, count, 'a bad stored ciphertext never silently uses environment credentials'); assert.deepEqual(snapshot(db), before);
  } finally { db.close(); }
});

test('CF132 ECOS real before-write CAS and provider-test key-rotation races cannot report stale success', async () => {
  const { db, adapter, call, save, control } = await fixture();
  try {
    await result(await save()); let winning: ReturnType<typeof snapshot> | undefined;
    adapter.beforeWrite = async () => { await result(await save(SECOND_KEY, 1)); winning = snapshot(db); };
    await result(await save('CF132LOSINGKEY0123456789', 1), 409); assert.ok(winning); assert.deepEqual(snapshot(db), winning);
    control.beforeFetch = async () => { await result(await save(KEY, 2)); };
    await result(await call(endpoint + '/test', 'POST', { expectedVersion: 2 }), 409); assert.equal(rows(db, `SELECT version FROM ${table}`)[0].version, 3);
  } finally { db.close(); }
});

test('CF132 ECOS DB triggers reject non-admin writes, owner transfer, non-CAS changes and physical deletion', async () => {
  const { db, save, verify } = await fixture();
  try {
    await result(await save()); const before = snapshot(db);
    for (const sql of [`UPDATE ${table} SET updated_by='${STAFF}',version=version+1,updated_at='2099-01-01'`, `UPDATE ${table} SET organization_id='foreign',version=version+1,updated_at='2099-01-01'`, `UPDATE ${table} SET version=version+2,updated_at='2099-01-01'`, `UPDATE ${table} SET created_at='changed',version=version+1,updated_at='2099-01-01'`, `DELETE FROM ${table}`]) assert.throws(() => db.run(sql));
    assert.deepEqual(snapshot(db), before); verify();
  } finally { db.close(); }
});

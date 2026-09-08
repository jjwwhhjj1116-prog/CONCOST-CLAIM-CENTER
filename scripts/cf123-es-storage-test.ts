import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import initSqlJs, { type Database } from 'sql.js';
import { newEsInput, calculateEs } from '../packages/document-engine/src/es-calculation';
import { ES_SHEETS } from '../packages/document-engine/src/es-output';
import { handleEsRequest, esHash, type EsActor, type EsStore, type EsStatement } from '../packages/document-engine/src/es-service';
import { migrateDatabase, createPrismaClient } from '../packages/database/src/db-engine';
import { createApiServer, type ManagedApiServer } from '../apps/api/src/server';
import worker, { type CloudflareEnv } from '../apps/cloudflare/src/index';

// Only synthetic, isolated databases are used. No dev.db, remote D1 or provider calls.
const OWNER = '12300000-0000-4000-8000-000000000001';
const OTHER = '12300000-0000-4000-8000-000000000002';
const ADMIN = '12300000-0000-4000-8000-000000000003';
const FOREIGN = '12300000-0000-4000-8000-000000000004';
const LINK = '12300000-0000-4000-8000-000000000005';
const DELETED_LINK = '12300000-0000-4000-8000-000000000006';
const OTHER_LINK = '12300000-0000-4000-8000-000000000007';
const FOREIGN_LINK = '12300000-0000-4000-8000-000000000008';
const owner: EsActor = { id: OWNER, organizationId: 'concost', admin: false };
const other: EsActor = { id: OTHER, organizationId: 'concost', admin: false };
const admin: EsActor = { id: ADMIN, organizationId: 'concost', admin: true };
const foreign: EsActor = { id: FOREIGN, organizationId: 'other-company', admin: true };
const d1Root = pathToFileURL(path.resolve('apps/cloudflare/migrations') + path.sep);
const nodeRoot = pathToFileURL(path.resolve('packages/database/prisma/migrations') + path.sep);
const d1Migration = readFileSync(new URL('0063_cf123_es_documents.sql', d1Root), 'utf8');
const nodeMigrationName = '20260908090000_cf123_es_documents';
const nodeMigration = readFileSync(new URL(`${nodeMigrationName}/migration.sql`, nodeRoot), 'utf8');
const now = '2026-09-08T09:00:00.000Z';
const expiry = '2099-01-01T00:00:00.000Z';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const token = (userId: string) => `cf123-synthetic-${userId}`;
const input = (title = 'CF123 합성 물가변동 산출서') => ({ ...newEsInput(), title });
function completeInput() {
  const value = input(); value.baseDate = '2026-01-01'; value.adjustmentDate = '2026-09-08'; value.contractAmount = '1000000'; value.costs['11'] = '100000';
  for (const [period, date, wage] of [[value.base, value.baseDate, '100'], [value.current.period, value.adjustmentDate, '105'], [value.previous.period, '2026-09-07', '104']] as const) {
    period.date = date; period.wage = wage; period.materials = ['100', '100', '100', '100']; period.source = '합성 원자료';
    for (const key of Object.keys(period.rates) as Array<keyof typeof period.rates>) period.rates[key] = '1';
  }
  for (const comparison of [value.current, value.previous]) for (const pair of [comparison.machinery, ...comparison.standards]) Object.assign(pair, { baseAverage: '100', comparisonAverage: '105', commonCount: '1', source: '합성 기간쌍' });
  assert.equal(calculateEs(value).status, 'LEGACY_REPLAY'); return value;
}
const rows = (db: Database, sql: string, values: (string | number | null)[] = []) => {
  const statement = db.prepare(sql), result: Record<string, any>[] = [];
  try { statement.bind(values); while (statement.step()) result.push(statement.getAsObject()); return result; }
  finally { statement.free(); }
};
const snapshot = (db: Database, names?: string[]) => Object.fromEntries((names ?? rows(db, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map(row => row.name)).map(name => [name, rows(db, `SELECT * FROM "${name}" ORDER BY rowid`)]));
const integrity = (db: Database) => { assert.deepEqual(db.exec('PRAGMA integrity_check')[0].values, [['ok']]); assert.deepEqual(db.exec('PRAGMA foreign_key_check'), []); };

async function populated(kind: 'd1' | 'node') {
  const SQL = await initSqlJs(), original = new SQL.Database(); original.run('PRAGMA foreign_keys=ON');
  if (kind === 'd1') {
    const foundation = ['0001_cf_foundation.sql', '0001_cf02_preview_drafts.sql', '0002_cf03_preview_evidence.sql', '0003_cf04_preview_auth.sql'];
    const apply = (name: string) => original.exec(readFileSync(new URL(name, d1Root), 'utf8'));
    foundation.forEach(apply);
    for (const id of [OWNER, OTHER, ADMIN]) {
      original.run('INSERT INTO preview_users(id,login_id,password_salt,password_hash,password_iterations,display_name,email,roles_json,is_active,created_at) VALUES(?,?,?,?,?,?,?,?,1,?)', [id, `${id}@example.invalid`, '1'.repeat(32), '2'.repeat(64), 100000, '합성 사용자', `${id}@example.invalid`, id === ADMIN ? '["admin"]' : '["staff"]', now]);
      original.run('INSERT INTO preview_sessions(id_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)', [digest(token(id)), id, now, expiry]);
    }
    readdirSync(d1Root).filter(name => /^\d{4}_.+\.sql$/u.test(name) && Number(name.slice(0, 4)) <= 62 && !foundation.includes(name)).sort().forEach(apply);
    original.run('INSERT INTO preview_ai_credentials(organization_id,owner_scope,owner_id,provider_kind,ciphertext_hex,iv_hex,key_fingerprint,status,version,updated_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', ['concost', 'USER', OWNER, 'GEMINI', 'a'.repeat(64), 'b'.repeat(24), 'c'.repeat(64), 'ACTIVE', 1, OWNER, now, now]);
  } else {
    original.run('CREATE TABLE "_P04Migration" ("name" TEXT PRIMARY KEY,"checksum" TEXT NOT NULL,"appliedAt" TEXT NOT NULL)');
    for (const name of readdirSync(nodeRoot).filter(name => /^\d{14}_/.test(name) && name < nodeMigrationName).sort()) {
      const sql = readFileSync(new URL(`${name}/migration.sql`, nodeRoot), 'utf8'); original.exec(sql);
      original.run('INSERT INTO "_P04Migration" VALUES(?,?,?)', [name, digest(sql), now]);
    }
    for (const org of ['concost', 'other-company']) original.run('INSERT INTO "Organization"(id,name,createdAt,updatedAt) VALUES(?,?,?,?)', [org, '합성 회사', now, now]);
    for (const role of ['admin', 'staff']) original.run('INSERT OR IGNORE INTO "Role"(id,name) VALUES(?,?)', [role, role]);
    for (const id of [OWNER, OTHER, ADMIN, FOREIGN]) {
      original.run('INSERT INTO "User"(id,email,passwordHash,name,organizationId,isActive,createdAt,updatedAt) VALUES(?,?,?,?,?,1,?,?)', [id, `${id}@example.invalid`, 'not-a-live-password', '합성 사용자', id === FOREIGN ? 'other-company' : 'concost', now, now]);
      original.run('INSERT INTO "UserRole"(userId,roleId) VALUES(?,?)', [id, [ADMIN, FOREIGN].includes(id) ? 'admin' : 'staff']);
      original.run('INSERT INTO "Session"(id,userId,tokenHash,expiresAt,createdAt) VALUES(?,?,?,?,?)', [`session-${id}`, id, digest(token(id)), expiry, now]);
    }
    for (const id of [LINK, DELETED_LINK, OTHER_LINK, FOREIGN_LINK]) {
      original.run('INSERT INTO "CaseItem"(id,organizationId,title,claimType,version,deletedAt,createdAt,updatedAt,caseNumber) VALUES(?,?,?,?,1,?,?,?,?)', [id, id === FOREIGN_LINK ? 'other-company' : 'concost', '합성 보존 프로젝트', 'TYPE-01', id === DELETED_LINK ? now : null, now, now, `SYNTHETIC-${id}`]);
      original.run('INSERT INTO "CaseAssignment"(caseId,userId) VALUES(?,?)', [id, id === OTHER_LINK ? OTHER : id === FOREIGN_LINK ? FOREIGN : OWNER]);
    }
    original.run('INSERT INTO "ServerSetting"(organizationId,ownerId,settingKey,valueJson,secretCiphertext,secretIv,secretTag,version,updatedById,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?)', ['concost', OWNER, 'SYNTHETIC_RETENTION', '{"preserve":true}', 'synthetic-ciphertext-not-a-key', 'synthetic-iv', 'synthetic-tag', 1, OWNER, now, now]);
  }
  const before = snapshot(original), image = original.export(); original.close();
  const db = new SQL.Database(image); db.run('PRAGMA foreign_keys=ON');
  return { db, before };
}

class Store implements EsStore {
  beforeBatch?: () => Promise<void>;
  constructor(readonly db: Database) {}
  async all<T>(sql: string, values: (string | number | null)[]) { return rows(this.db, sql, values) as T[]; }
  async batch(statements: EsStatement[]) {
    const hook = this.beforeBatch; this.beforeBatch = undefined; if (hook) await hook();
    this.db.run('BEGIN IMMEDIATE');
    try { statements.forEach(statement => this.db.run(statement.sql, statement.values)); this.db.run('COMMIT'); }
    catch (error) { this.db.run('ROLLBACK'); throw error; }
  }
}
async function fixture() {
  const { db } = await populated('d1'); db.exec(d1Migration); const store = new Store(db);
  const call = (pathname = '/api/es/documents', method = 'GET', body?: unknown, actor = owner) => handleEsRequest({ pathname, method, body, actor, store, canLink: async caseId => caseId === LINK && actor.organizationId === 'concost' && [OWNER, ADMIN].includes(actor.id) });
  const create = (body: Record<string, unknown> = {}, actor = owner) => call('/api/es/documents', 'POST', { input: input(), ...body }, actor);
  return { db, store, call, create };
}
function result(response: { status: number; body: unknown }, expected = 200): any { assert.equal(response.status, expected, JSON.stringify(response.body)); return response.body; }

for (const [kind, sql] of [['d1', d1Migration], ['node', nodeMigration]] as const) test(`CF123 ${kind} migration preserves populated rows, settings, PKs and is idempotent`, async () => {
  const { db, before } = await populated(kind);
  try {
    db.exec(sql); assert.deepEqual(snapshot(db, Object.keys(before)), before); integrity(db);
    const store = new Store(db);
    result(await handleEsRequest({ pathname: '/api/es/documents', method: 'POST', body: { input: input() }, store, actor: owner, canLink: async () => false }), 201);
    const after = snapshot(db); db.exec(sql); assert.deepEqual(snapshot(db), after); integrity(db);
  } finally { db.close(); }
});

test('CF123 owner/company ACL applies to create/list/get/save/calculate and untrusted ownership is discarded', async () => {
  const { db, call, create } = await fixture();
  try {
    const created = result(await create({ ownerId: OTHER, organizationId: 'other-company', approval: 'APPROVED', input: { ...input(), ownerId: OTHER, organizationId: 'other-company', result: { net: '999999' } } }), 201);
    const id = created.document.id, route = `/api/es/documents/${id}`;
    assert.equal(created.document.ownerId, OWNER); assert.equal(created.document.organizationId, 'concost'); assert.equal(created.document.caseId, null); assert.equal(created.document.revision, 1);
    assert.equal(created.input.ownerId, undefined); assert.equal(created.input.result, undefined); assert.equal(created.inputHash, await esHash(JSON.stringify(created.input)));
    const otherId = result(await create({}, other), 201).document.id;
    const foreignId = result(await create({}, foreign), 201).document.id;
    assert.deepEqual(result(await call()).documents.map((doc: any) => doc.id), [id]);
    assert.deepEqual(result(await call('/api/es/documents', 'GET', undefined, other)).documents.map((doc: any) => doc.id), [otherId]);
    assert.deepEqual(new Set(result(await call('/api/es/documents', 'GET', undefined, admin)).documents.map((doc: any) => doc.id)), new Set([id, otherId]));
    assert.deepEqual(result(await call('/api/es/documents', 'GET', undefined, foreign)).documents.map((doc: any) => doc.id), [foreignId]);
    const before = snapshot(db);
    for (const actor of [other, foreign]) for (const [endpoint, method, body] of [[route, 'GET', undefined], [route, 'PUT', { input: input(), expectedRevision: 1 }], [`${route}/runs`, 'POST', { expectedRevision: 1 }]] as const) result(await call(endpoint, method, body, actor), 404);
    result(await call('/api/es/documents', 'GET', undefined, { ...owner, id: '' }), 401);
    result(await call('/api/es/documents', 'GET', undefined, { ...owner, organizationId: '' }), 401);
    assert.deepEqual(snapshot(db), before);
    result(await call(route, 'PUT', { input: input('관리자 검수 저장'), expectedRevision: 1 }, admin));
    assert.equal(result(await call(route)).document.ownerId, OWNER); integrity(db);
  } finally { db.close(); }
});

test('CF123 optional project links require server permission; forged links and invalid payloads cannot mutate storage', async () => {
  const { db, create, call } = await fixture();
  try {
    const created = result(await create({ caseId: LINK }), 201), route = `/api/es/documents/${created.document.id}`;
    assert.equal(created.document.caseId, LINK); const before = snapshot(db);
    for (const caseId of [OTHER_LINK, FOREIGN_LINK, DELETED_LINK, 1, { id: LINK }, 'x'.repeat(101)]) {
      result(await create({ caseId }), 404);
      result(await call(route, 'PUT', { input: input(), expectedRevision: 1, caseId }), 404);
    }
    for (const invalid of [null, [], {}, { ...input(), schemaVersion: 1 }, { ...input(), contractAmount: 'not-a-number' }, { ...input(), title: ' ' }]) result(await create({ input: invalid }), 400);
    assert.deepEqual(snapshot(db), before);
    const unlinked = result(await call(route, 'PUT', { input: input(), expectedRevision: 1, caseId: null })); assert.equal(unlinked.document.caseId, null);
  } finally { db.close(); }
});

test('CF123 stale and interleaved writes produce one revision and one audit event, preserving the winner', async () => {
  const { db, store, create, call } = await fixture();
  try {
    const id = result(await create(), 201).document.id, route = `/api/es/documents/${id}`;
    const before = snapshot(db);
    for (const expectedRevision of [undefined, '1', 0, 2, -1, 1.5]) result(await call(route, 'PUT', { input: input(), expectedRevision }), 409);
    assert.deepEqual(snapshot(db), before);
    store.beforeBatch = async () => { result(await call(route, 'PUT', { input: input('동시 저장 승자'), expectedRevision: 1 })); };
    result(await call(route, 'PUT', { input: input('늦게 도착한 변경'), expectedRevision: 1 }), 409);
    assert.equal(result(await call(route)).input.title, '동시 저장 승자');
    assert.deepEqual(rows(db, 'SELECT revision FROM es_revisions ORDER BY revision').map(row => row.revision), [1, 2]);
    assert.deepEqual(rows(db, 'SELECT action,revision FROM es_audit_events ORDER BY rowid'), [{ action: 'CREATED', revision: 1 }, { action: 'SAVED', revision: 2 }]); integrity(db);
  } finally { db.close(); }
});

test('CF123 failed storage rolls back document, revision and audit and hides internal exception details', async () => {
  const { db, store, create, call } = await fixture();
  try {
    const id = result(await create(), 201).document.id, before = snapshot(db);
    db.run("CREATE TRIGGER cf123_fail_audit BEFORE INSERT ON es_audit_events BEGIN SELECT RAISE(ABORT,'synthetic private credential detail'); END");
    const failed = await call(`/api/es/documents/${id}`, 'PUT', { input: input('저장되면 안 되는 제목'), expectedRevision: 1 });
    assert.equal(failed.status, 503); assert.doesNotMatch(JSON.stringify(failed.body), /synthetic private|credential|INSERT|TRIGGER/i); assert.deepEqual(snapshot(db), before);
    db.run('DROP TRIGGER cf123_fail_audit');
    store.beforeBatch = async () => { throw new Error('synthetic private adapter detail'); };
    const broken = await create(); assert.equal(broken.status, 503); assert.doesNotMatch(JSON.stringify(broken.body), /synthetic private|adapter detail/i); assert.deepEqual(snapshot(db), before);
  } finally { db.close(); }
});

test('CF123 server calculates from immutable saved input and later revisions cannot alter an existing run', async () => {
  const { db, create, call } = await fixture();
  try {
    const created = result(await create(), 201), route = `/api/es/documents/${created.document.id}`;
    result(await call(`${route}/runs`, 'POST', { expectedRevision: 2 }), 409);
    const run = result(await call(`${route}/runs`, 'POST', { expectedRevision: 1, input: input('위조 입력'), result: { net: '999999999' }, revisionId: 'forged', engineVersion: 'forged' }), 201).run;
    assert.deepEqual(run.result, calculateEs(created.input)); assert.equal(run.inputHash, created.inputHash); assert.equal(run.revision, 1);
    const reopened = result(await call(route, 'GET'));
    assert.equal(reopened.run.id, run.id); assert.deepEqual(reopened.run.result, run.result); assert.deepEqual(reopened.run.input, created.input);
    const savedRun = rows(db, 'SELECT * FROM es_runs WHERE id=?', [run.id]); const savedRevision = rows(db, 'SELECT * FROM es_revisions WHERE documentId=? AND revision=1', [created.document.id]);
    result(await call(route, 'PUT', { input: input('다음 저장본'), expectedRevision: 1 }));
    assert.equal(result(await call(route, 'GET')).run, null, 'a prior revision run must not be restored as the current output');
    assert.deepEqual(rows(db, 'SELECT * FROM es_runs WHERE id=?', [run.id]), savedRun); assert.deepEqual(rows(db, 'SELECT * FROM es_revisions WHERE documentId=? AND revision=1', [created.document.id]), savedRevision);
    assert.equal(savedRun[0].revisionId, savedRevision[0].id); result(await call(`${route}/runs`, 'POST', { expectedRevision: 1 }), 409); integrity(db);
  } finally { db.close(); }
});

for (const [kind, sql] of [['d1', d1Migration], ['node', nodeMigration]] as const) test(`CF123 ${kind} database rejects revision/run/audit rewrites, ownership transfers and foreign revision runs`, async () => {
  const { db } = await populated(kind); db.exec(sql); const store = new Store(db);
  const call = (pathname: string, method: string, body?: unknown) => handleEsRequest({ pathname, method, body, actor: owner, store, canLink: async () => false });
  try {
    const id = result(await call('/api/es/documents', 'POST', { input: input() }), 201).document.id;
    const second = result(await call('/api/es/documents', 'POST', { input: input('다른 합성 문서') }), 201).document.id;
    const run = result(await call(`/api/es/documents/${id}/runs`, 'POST', { expectedRevision: 1 }), 201).run;
    const revision = rows(db, 'SELECT id FROM es_revisions WHERE documentId=?', [id])[0].id;
    const before = snapshot(db);
    for (const [table, message] of [['es_revisions', /ES_REVISION_IMMUTABLE/], ['es_runs', /ES_RUN_IMMUTABLE/], ['es_audit_events', /ES_AUDIT_IMMUTABLE/]] as const) {
      assert.throws(() => db.run(`UPDATE ${table} SET actorId=?`, [OTHER]), message);
      assert.throws(() => db.run(`DELETE FROM ${table}`), message);
    }
    for (const [column, value] of [['ownerId', OTHER], ['organizationId', 'other-company']]) assert.throws(() => db.run(`UPDATE es_documents SET ${column}=? WHERE id=?`, [value, id]), /ES_OWNER_IMMUTABLE/);
    assert.throws(() => db.run('INSERT INTO es_runs(id,documentId,revisionId,engineVersion,resultJson,actorId,createdAt) VALUES(?,?,?,?,?,?,?)', [crypto.randomUUID(), second, revision, 'forged', '{}', OWNER, now]), /ES_REVISION_SCOPE/);
    assert.throws(() => db.run('INSERT INTO es_outputs(id,runId,selectionJson,pageRange,format,status,actorId,createdAt) VALUES(?,?,?,?,?,?,?,?)', [crypto.randomUUID(), run.id, '["cover"]', '', 'PRINT', 'PRINTED_SUCCESSFULLY', OWNER, now]), /CHECK constraint failed/);
    assert.deepEqual(snapshot(db), before); integrity(db);
  } finally { db.close(); }
});

test('CF123 outputs enforce document/run/actor/company scope and reject internal or forged sheet IDs', async () => {
  const { db, create, call } = await fixture();
  try {
    const id = result(await create({ input: completeInput() }), 201).document.id, route = `/api/es/documents/${id}`;
    const runId = result(await call(`${route}/runs`, 'POST', { expectedRevision: 1 }), 201).run.id;
    const secondId = result(await create(), 201).document.id;
    const otherId = result(await create({}, other), 201).document.id;
    const otherRun = result(await call(`/api/es/documents/${otherId}/runs`, 'POST', { expectedRevision: 1 }, other), 201).run.id;
    const body = { runId, selection: ['cover'], format: 'REPORT_XLSX' }, before = snapshot(db);
    result(await call(`/api/es/documents/${secondId}/outputs`, 'POST', body), 404);
    result(await call(`${route}/outputs`, 'POST', { ...body, runId: otherRun }), 404);
    for (const actor of [other, foreign]) result(await call(`${route}/outputs`, 'POST', body, actor), 404);
    for (const sheet of ['기본입력', '이후시트출력금지', '기계 및 표준', 'K0', 'K0(직)', '토목표준', '건축표준', '기계표준', '전기표준', '통신표준', '../4', '4.', 'A1:M443', '__proto__']) result(await call(`${route}/outputs`, 'POST', { ...body, selection: ['cover', sheet] }), 400);
    for (const selection of [[], 'cover', [1], Array(18).fill('cover')]) result(await call(`${route}/outputs`, 'POST', { ...body, selection }), 400);
    for (const format of ['HWP', 'DOCX', 'PDF', 'WORKING_XLSX', 'report_xlsx']) result(await call(`${route}/outputs`, 'POST', { ...body, format }), 400);
    assert.deepEqual(snapshot(db), before);
    result(await call(`${route}/outputs`, 'POST', body, admin), 201); integrity(db);
  } finally { db.close(); }
});

test('CF123 outputs block incomplete numeric reports but allow explicit cover, contents and divider drafts', async () => {
  const { db, create, call } = await fixture();
  try {
    const id = result(await create(), 201).document.id, route = `/api/es/documents/${id}`, run = result(await call(`${route}/runs`, 'POST', { expectedRevision: 1 }), 201).run;
    assert.equal(run.result.status, 'INCOMPLETE'); const before = snapshot(db);
    for (const [sheet] of ES_SHEETS.filter(([sheet]) => !['cover', 'contents'].includes(sheet) && !sheet.startsWith('divider_'))) for (const format of ['PRINT', 'REPORT_XLSX']) result(await call(`${route}/outputs`, 'POST', { runId: run.id, selection: [sheet], format, pageCount: 1, pageRange: '' }), 400);
    assert.deepEqual(snapshot(db), before);
    const allowed = ['cover', 'contents', 'divider_1', 'divider_2', 'divider_3', 'divider_4', 'divider_5'];
    for (const selection of allowed.map(sheet => [sheet]).concat([allowed])) result(await call(`${route}/outputs`, 'POST', { runId: run.id, selection, format: 'REPORT_XLSX', result: { status: 'APPROVED' } }), 201);
    integrity(db);
  } finally { db.close(); }
});

test('CF123 outputs preserve all 17 distinct source IDs and canonical order; XLSX ignores print-page filtering', async () => {
  const { db, create, call } = await fixture();
  try {
    const id = result(await create({ input: completeInput() }), 201).document.id, route = `/api/es/documents/${id}`, runId = result(await call(`${route}/runs`, 'POST', { expectedRevision: 1 }), 201).run.id;
    const expected = [['cover', '표지'], ['contents', '목록'], ['divider_1', '붙1'], ['review_summary', '1'], ['divider_2', '붙2'], ['amount_adjustment', '2'], ['weighted_rate', '2.1'], ['advance_deduction', '2.2(선금)'], ['divider_3', '붙3'], ['rate_details', '3'], ['divider_4', '붙4'], ['index_details', '4'], ['divider_5', '붙5'], ['previous_day_eligibility', '2.'], ['previous_day_weighted_rate', '2.1.'], ['previous_day_rate_details', '3.'], ['previous_day_index_details', '4.']];
    assert.deepEqual(ES_SHEETS.map(([id, name]) => [id, name]), expected);
    const sourceIds = expected.map(([id]) => id);
    const output = result(await call(`${route}/outputs`, 'POST', { runId, selection: [...sourceIds].reverse(), format: 'REPORT_XLSX', pageRange: '9999,-1,invalid', pageCount: -1 }), 201).output;
    const saved = rows(db, 'SELECT * FROM es_outputs WHERE id=?', [output.id])[0];
    assert.deepEqual(JSON.parse(saved.selectionJson), sourceIds); assert.equal(saved.pageRange, ''); assert.equal(saved.status, 'REQUESTED'); assert.equal(saved.runId, runId); assert.equal(saved.actorId, OWNER);
    const selected = result(await call(`${route}/outputs`, 'POST', { runId, selection: ['previous_day_index_details', 'index_details', 'previous_day_index_details'], format: 'REPORT_XLSX' }), 201).output;
    assert.deepEqual(JSON.parse(rows(db, 'SELECT selectionJson FROM es_outputs WHERE id=?', [selected.id])[0].selectionJson), ['index_details', 'previous_day_index_details']);
  } finally { db.close(); }
});

test('CF123 PRINT validates page syntax and declared bundle bounds without writing rejected jobs', async () => {
  const { db, create, call } = await fixture();
  try {
    const id = result(await create(), 201).document.id, route = `/api/es/documents/${id}`, runId = result(await call(`${route}/runs`, 'POST', { expectedRevision: 1 }), 201).run.id;
    const body = { runId, selection: ['cover', 'divider_1'], format: 'PRINT', pageRange: '1-2', pageCount: 2 }, before = snapshot(db);
    for (const pageCount of [undefined, 0, -1, 1.5, '2', 10001]) result(await call(`${route}/outputs`, 'POST', { ...body, pageCount }), 400);
    for (const pageRange of [undefined, 1, '0', '-1', '3', '2-1', '1,,2', '1.5', 'NaN', '1-3', '1'.repeat(2001)]) result(await call(`${route}/outputs`, 'POST', { ...body, pageRange }), 400);
    assert.deepEqual(snapshot(db), before);
    const output = result(await call(`${route}/outputs`, 'POST', { ...body, pageRange: '2,1,1' }), 201).output;
    assert.equal(rows(db, 'SELECT pageRange FROM es_outputs WHERE id=?', [output.id])[0].pageRange, '2,1,1');
  } finally { db.close(); }
});

test('CF123 output lifecycle reports only persisted state and never claims physical printer success', async () => {
  const { db, create, call } = await fixture();
  try {
    const id = result(await create(), 201).document.id, route = `/api/es/documents/${id}`, runId = result(await call(`${route}/runs`, 'POST', { expectedRevision: 1 }), 201).run.id;
    const job = async () => result(await call(`${route}/outputs`, 'POST', { runId, selection: ['cover'], format: 'PRINT', pageRange: '', pageCount: 1 }), 201).output.id;
    const outputId = await job();
    for (const status of ['PRINTED', 'SUCCESS', 'REQUESTED', 'APPROVED', 'PRINTED_SUCCESSFULLY']) result(await call(`${route}/outputs`, 'PATCH', { outputId, status }), 400);
    for (const actor of [other, foreign, admin]) result(await call(`${route}/outputs`, 'PATCH', { outputId, status: 'RENDERED' }, actor), 404);
    for (const status of ['RENDERED', 'DIALOG_CLOSED']) {
      const changed = result(await call(`${route}/outputs`, 'PATCH', { outputId, status, printerSuccessVerified: true }));
      assert.equal(changed.printerSuccessVerified, false); assert.equal(changed.reportedStatus, status);
      assert.equal(rows(db, 'SELECT status FROM es_outputs WHERE id=?', [outputId])[0].status, status);
    }
    const failedId = await job(); result(await call(`${route}/outputs`, 'PATCH', { outputId: failedId, status: 'FAILED' }));
    const before = snapshot(db);
    for (const ended of [outputId, failedId]) {
      const late = await call(`${route}/outputs`, 'PATCH', { outputId: ended, status: 'RENDERED' });
      assert.equal(late.status, 409, 'a terminal job must reject a late, contradictory rendered state');
    }
    assert.deepEqual(snapshot(db), before);
  } finally { db.close(); }
});

test('CF123 Worker route retains authentication and same-origin JSON mutation guards', async () => {
  const { db } = await fixture();
  // Thin transactional D1 adapter, matching the actual Worker path rather than mocked replies.
  const prepare = (sql: string, values: (string | number | null)[] = []): any => ({ sql, values, bind: (...bound: (string | number | null)[]) => prepare(sql, bound), first: async () => rows(db, sql, values)[0] ?? null, all: async () => ({ results: rows(db, sql, values) }) });
  const adapter = { prepare, batch: async (statements: any[]) => new Store(db).batch(statements.map(({ sql, values }) => ({ sql, values }))) };
  const call = (method = 'GET', body?: unknown, headers: Record<string, string> = {}) => worker.fetch(new Request('https://preview.example/api/es/documents', { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), { DB: adapter as unknown as NonNullable<CloudflareEnv['DB']> });
  try {
    assert.equal((await call()).status, 401);
    const before = snapshot(db), auth = { 'X-Session-Token': token(OWNER), 'Content-Type': 'application/json' };
    assert.equal((await call('POST', { input: input() }, { ...auth, Origin: 'https://foreign.example' })).status, 403);
    assert.equal((await call('POST', { input: input() }, { ...auth, 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    assert.equal((await call('POST', { input: input() }, { ...auth, Cookie: 'unrelated=value' })).status, 403);
    assert.equal((await call('POST', { input: input() }, { ...auth, Origin: 'https://preview.example', 'Content-Type': 'text/plain' })).status, 415);
    assert.deepEqual(snapshot(db), before);
    const created = await call('POST', { input: input() }, { ...auth, Origin: 'https://preview.example' }); assert.equal(created.status, 201, await created.text());
  } finally { db.close(); }
});

test('CF123 actual Node migration runner and HTTP ES routes preserve settings, numeric revisions, ACL and project lifecycle', async () => {
  const { db, before } = await populated('node');
  const directory = mkdtempSync(path.join(tmpdir(), 'cf123-es-storage-')), dbPath = path.join(directory, 'synthetic-copy.db'), databaseUrl = `file:${dbPath.replace(/\\/g, '/')}`;
  let server: ManagedApiServer | undefined;
  try {
    writeFileSync(dbPath, db.export()); db.close();
    await migrateDatabase(databaseUrl); await migrateDatabase(databaseUrl);
    const SQL = await initSqlJs(), checked = new SQL.Database(readFileSync(dbPath)); checked.run('PRAGMA foreign_keys=ON');
    try {
      const names = Object.keys(before).filter(name => name !== '_P04Migration'); assert.deepEqual(snapshot(checked, names), Object.fromEntries(names.map(name => [name, before[name]])));
      assert.deepEqual(rows(checked, 'SELECT * FROM "_P04Migration" WHERE name<>? ORDER BY rowid', [nodeMigrationName]), before._P04Migration);
      assert.deepEqual(rows(checked, 'SELECT name,checksum FROM "_P04Migration" WHERE name=?', [nodeMigrationName]), [{ name: nodeMigrationName, checksum: digest(nodeMigration) }]); integrity(checked);
    } finally { checked.close(); }
    server = createApiServer({ databaseUrl, environment: {}, allowedOrigins: ['https://es.example'], uploadDir: path.join(directory, 'uploads'), backupRootDir: path.join(directory, 'backups'), restoreRootDir: path.join(directory, 'restores'), credentialVaultDir: path.join(directory, 'vault'), pkceVaultDir: path.join(directory, 'pkce') });
    await new Promise<void>((resolve, reject) => { server!.once('error', reject); server!.listen(0, '127.0.0.1', resolve); });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const call = async (route: string, method = 'GET', body?: unknown, userId = OWNER) => {
      const response = await fetch(base + route, { method, headers: { Authorization: `Bearer ${token(userId)}`, Origin: 'https://es.example', 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(5000) });
      return { status: response.status, body: await response.json() };
    };
    const created = result(await call('/api/es/documents', 'POST', { input: input(), caseId: LINK }), 201), route = `/api/es/documents/${created.document.id}`;
    assert.equal(created.document.ownerId, OWNER); assert.equal(created.document.organizationId, 'concost');
    const listed = result(await call('/api/es/documents')); assert.equal(listed.documents[0].revision, 1, 'Prisma raw SQLite integers must be normalized before JSON and CAS');
    assert.equal(result(await call(route)).document.revision, 1);
    assert.equal(result(await call(route, 'PUT', { input: input('Node 재저장'), expectedRevision: 1, caseId: LINK })).document.revision, 2);
    result(await call(route, 'PUT', { input: input(), expectedRevision: 1 }), 409);
    const runId = result(await call(`${route}/runs`, 'POST', { expectedRevision: 2 }), 201).run.id;
    result(await call(`${route}/outputs`, 'POST', { runId, selection: ['weighted_rate'], format: 'REPORT_XLSX' }), 400);
    result(await call(`${route}/outputs`, 'POST', { runId, selection: ['기본입력'], format: 'REPORT_XLSX' }), 400);
    const outputId = result(await call(`${route}/outputs`, 'POST', { runId, selection: ['cover'], format: 'PRINT', pageRange: '', pageCount: 1 }), 201).output.id;
    const state = result(await call(`${route}/outputs`, 'PATCH', { outputId, status: 'DIALOG_CLOSED', printerSuccessVerified: true }));
    assert.equal(state.printerSuccessVerified, false);
    result(await call(`${route}/outputs`, 'PATCH', { outputId, status: 'RENDERED' }), 409);
    for (const userId of [OTHER, FOREIGN]) { result(await call(route, 'GET', undefined, userId), 404); assert.deepEqual(result(await call('/api/es/documents', 'GET', undefined, userId)).documents, []); }
    result(await call(route, 'GET', undefined, ADMIN));
    for (const caseId of [OTHER_LINK, FOREIGN_LINK, DELETED_LINK]) result(await call('/api/es/documents', 'POST', { input: input(), caseId }), 404);
    const client = createPrismaClient(databaseUrl);
    try {
      const settings = await client.$queryRawUnsafe<any[]>('SELECT valueJson,secretCiphertext FROM "ServerSetting" WHERE settingKey=?', 'SYNTHETIC_RETENTION');
      assert.deepEqual(settings, [{ valueJson: '{"preserve":true}', secretCiphertext: 'synthetic-ciphertext-not-a-key' }]);
    } finally { await client.$disconnect(); }
  } finally {
    if (server?.listening) { await new Promise<void>(resolve => server!.close(() => resolve())); await server.waitForDatabaseClose(); }
    const target = path.resolve(directory), parent = path.resolve(tmpdir());
    assert.equal(path.dirname(target), parent); assert.ok(path.basename(target).startsWith('cf123-es-storage-')); rmSync(target, { recursive: true, force: true });
  }
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import initSqlJs, { type Database } from 'sql.js';
import worker, { type CloudflareEnv } from '../apps/cloudflare/src/index.js';

const ADMIN_ID = '00000000-0000-4000-8000-000000000001';
const STAFF_ID = '00000000-0000-4000-8000-000000000002';
const OUTSIDER_ID = '00000000-0000-4000-8000-000000000003';
const CASE_ID = '40000000-0000-4000-8000-000000000010';
const ADMIN_TOKEN = 'cf13-admin-session-token';
const STAFF_TOKEN = 'cf13-staff-session-token';
const OUTSIDER_TOKEN = 'cf13-outsider-session-token';

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

class SqlStatement {
  private values: unknown[] = [];
  constructor(private readonly database: Database, private readonly sql: string) {}
  bind(...values: unknown[]): SqlStatement { this.values = values; return this; }
  async first<T>(): Promise<T | null> { const statement = this.database.prepare(this.sql); try { statement.bind(this.values as any[]); return statement.step() ? statement.getAsObject() as T : null; } finally { statement.free(); } }
  async all<T>(): Promise<{ results: T[] }> { const statement = this.database.prepare(this.sql); const results: T[] = []; try { statement.bind(this.values as any[]); while (statement.step()) results.push(statement.getAsObject() as T); return { results }; } finally { statement.free(); } }
  async run(): Promise<{ success: boolean; meta: { changes: number; last_row_id: number } }> { this.database.run(this.sql, this.values as any[]); const row = this.database.exec('SELECT last_insert_rowid() AS id')[0]?.values[0]?.[0]; return { success: true, meta: { changes: this.database.getRowsModified(), last_row_id: Number(row ?? 0) } }; }
}
class SqlD1 {
  constructor(readonly database: Database) {}
  prepare(sql: string): SqlStatement { return new SqlStatement(this.database, sql); }
  async batch(statements: SqlStatement[]): Promise<unknown[]> { this.database.run('BEGIN IMMEDIATE'); try { const results = []; for (const statement of statements) results.push(await statement.run()); this.database.run('COMMIT'); return results; } catch (error) { this.database.run('ROLLBACK'); throw error; } }
}

const migration = (name: string): string => readFileSync(join(process.cwd(), 'apps', 'cloudflare', 'migrations', name), 'utf8');

async function setup(): Promise<{ sql: Database; env: CloudflareEnv; providerBodies: Array<Record<string, unknown>> }> {
  const SQL = await initSqlJs();
  const sql = new SQL.Database();
  sql.run('PRAGMA foreign_keys = ON');
  for (const name of ['0001_cf_foundation.sql','0001_cf02_preview_drafts.sql','0002_cf03_preview_evidence.sql','0003_cf04_preview_auth.sql','0004_cf05_google_drive.sql','0005_cf06_case_operations.sql']) sql.exec(migration(name));
  const now = new Date().toISOString();
  const insertUser = (id: string, login: string, roles: string) => sql.run('INSERT INTO preview_users VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)', [id, login, '1'.repeat(32), '2'.repeat(64), 100000, login, `${login}@example.invalid`, roles, now]);
  insertUser(ADMIN_ID, 'admin', '["admin"]');
  sql.exec(migration('0010_cf10_product_experience.sql'));
  insertUser(STAFF_ID, 'staff', '["staff"]'); insertUser(OUTSIDER_ID, 'outsider', '["staff"]');
  for (const name of ['0006_cf07_report_studio_drafts.sql','0007_cf08_report_review_approval.sql','0008_cf09_final_output.sql','0009_cf09_output_actor_scope.sql','0011_cf11_project_workflow.sql','0012_cf12_report_ai_prompts.sql','0013_cf13_litigation_records.sql']) sql.exec(migration(name));
  sql.run('INSERT INTO preview_case_assignments VALUES (?, ?, ?, ?)', [CASE_ID, STAFF_ID, ADMIN_ID, now]);
  for (const [token, id] of [[ADMIN_TOKEN, ADMIN_ID],[STAFF_TOKEN, STAFF_ID],[OUTSIDER_TOKEN, OUTSIDER_ID]] as const) sql.run('INSERT INTO preview_sessions VALUES (?, ?, ?, ?)', [await sha256(token), id, now, new Date(Date.now() + 3_600_000).toISOString()]);
  const providerBodies: Array<Record<string, unknown>> = [];
  const providerFetch: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    providerBodies.push(body);
    return new Response(JSON.stringify({ output_text: '법원 공식 원문으로 검증된 사건 기록을 반영한 초안입니다.' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  return { sql, providerBodies, env: { DB: new SqlD1(sql) as unknown as NonNullable<CloudflareEnv['DB']>, OPENAI_API_KEY: 'SYNTHETIC_SERVER_KEY', OPENAI_TEST_FETCH: providerFetch } };
}

function request(path: string, token: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set('X-Session-Token', token);
  if (init.body) headers.set('Content-Type', 'application/json');
  return new Request(`https://preview.example${path}`, { ...init, headers });
}

const recordPayload = {
  caseId: CASE_ID,
  courtName: '서울중앙지방법원',
  courtCaseNumber: '2026가합12345',
  caseTitle: '공사대금 청구의 소',
  divisionName: '민사 제27부',
  partiesText: '원고 주식회사 컨코스트 / 피고 합성건설 주식회사',
  filedOn: '2026-08-01',
  currentStage: 'HEARING',
  nextHearingAt: '2026-09-14T05:00:00.000Z',
  verificationStatus: 'VERIFIED',
  officialSourceUrl: 'https://www.scourt.go.kr/portal/information/events/search'
};

test('CF13 persists searchable court cases, immutable verified events, and court schedules', async () => {
  const { sql, env } = await setup();
  const created = await worker.fetch(request('/api/litigation-records', ADMIN_TOKEN, { method: 'POST', headers: { 'Idempotency-Key': 'cf13-litigation-create-0001' }, body: JSON.stringify(recordPayload) }), env);
  assert.equal(created.status, 201);
  const createdBody = await created.json() as { record: { id: string; reportEvidenceEligible: boolean; version: number } };
  assert.equal(createdBody.record.reportEvidenceEligible, true);

  const replay = await worker.fetch(request('/api/litigation-records', ADMIN_TOKEN, { method: 'POST', headers: { 'Idempotency-Key': 'cf13-litigation-create-0001' }, body: JSON.stringify(recordPayload) }), env);
  assert.equal(replay.status, 200);
  assert.equal((await replay.json() as { record: { id: string } }).record.id, createdBody.record.id);
  const mismatch = await worker.fetch(request('/api/litigation-records', ADMIN_TOKEN, { method: 'POST', headers: { 'Idempotency-Key': 'cf13-litigation-create-0001' }, body: JSON.stringify({ ...recordPayload, caseTitle: '변조된 사건명' }) }), env);
  assert.equal(mismatch.status, 409);

  const search = await worker.fetch(request('/api/litigation-records?q=2026%EA%B0%80%ED%95%A912345&stage=HEARING', STAFF_TOKEN), env);
  assert.equal(search.status, 200);
  assert.equal((await search.json() as { records: unknown[] }).records.length, 1);

  const sourceSha256 = 'a'.repeat(64);
  const eventPayload = { eventType: 'HEARING', occurredAt: '2026-09-14T05:00:00.000Z', title: '제3차 변론기일', detailText: '감정보완 신청서 제출 여부와 다음 기일을 확인했습니다.', verificationStatus: 'VERIFIED', officialSourceUrl: 'https://www.scourt.go.kr/portal/information/events/search', sourceSha256, createCourtSchedule: true };
  const event = await worker.fetch(request(`/api/litigation-records/${createdBody.record.id}/events`, ADMIN_TOKEN, { method: 'POST', headers: { 'Idempotency-Key': 'cf13-event-hearing-0001' }, body: JSON.stringify(eventPayload) }), env);
  assert.equal(event.status, 200);
  const eventBody = await event.json() as { events: Array<{ scheduleId: string; sourceSha256: string }> };
  assert.equal(eventBody.events[0].sourceSha256, sourceSha256);
  assert.match(eventBody.events[0].scheduleId, /^[0-9a-f-]{36}$/u);
  assert.equal(sql.exec("SELECT count(*) FROM preview_case_schedules WHERE type='COURT'")[0].values[0][0], 1);
  assert.equal(Number(sql.exec('SELECT count(*) FROM preview_case_activities WHERE case_id=?', [CASE_ID])[0]?.values[0]?.[0] ?? 0) >= 2, true);

  const eventId = String(sql.exec('SELECT id FROM preview_litigation_events')[0].values[0][0]);
  assert.throws(() => sql.run("UPDATE preview_litigation_events SET title='위조' WHERE id=?", [eventId]), /append-only/u);
  assert.throws(() => sql.run('DELETE FROM preview_litigation_cases WHERE id=?', [createdBody.record.id]), /cannot be physically deleted/u);
  sql.close();
});

test('CF13 enforces official source, assignment, mutation role, version, and report grounding boundaries', async () => {
  const { sql, env, providerBodies } = await setup();
  const badSource = await worker.fetch(request('/api/litigation-records', ADMIN_TOKEN, { method: 'POST', headers: { 'Idempotency-Key': 'cf13-bad-source-0001' }, body: JSON.stringify({ ...recordPayload, officialSourceUrl: 'https://attacker.example/court' }) }), env);
  assert.equal(badSource.status, 400);
  assert.equal((await worker.fetch(request('/api/litigation-records', STAFF_TOKEN, { method: 'POST', headers: { 'Idempotency-Key': 'cf13-staff-write-0001' }, body: JSON.stringify(recordPayload) }), env)).status, 403);

  const created = await worker.fetch(request('/api/litigation-records', ADMIN_TOKEN, { method: 'POST', headers: { 'Idempotency-Key': 'cf13-litigation-create-0002' }, body: JSON.stringify(recordPayload) }), env);
  const record = (await created.json() as { record: { id: string; version: number } }).record;
  const outsiderList = await worker.fetch(request('/api/litigation-records', OUTSIDER_TOKEN), env);
  assert.deepEqual((await outsiderList.json() as { records: unknown[] }).records, []);
  assert.equal((await worker.fetch(request(`/api/litigation-records/${record.id}`, OUTSIDER_TOKEN), env)).status, 404);

  const stale = await worker.fetch(request(`/api/litigation-records/${record.id}`, ADMIN_TOKEN, { method: 'PUT', body: JSON.stringify({ ...recordPayload, expectedVersion: 99 }) }), env);
  assert.equal(stale.status, 409);

  const config = await worker.fetch(request(`/api/report-authoring/config?caseId=${CASE_ID}`, STAFF_TOKEN), env);
  const chapterId = (await config.json() as { chapters: Array<{ id: string }> }).chapters[0].id;
  const generated = await worker.fetch(request('/api/report-authoring/generate', STAFF_TOKEN, { method: 'POST', body: JSON.stringify({ caseId: CASE_ID, chapterId, expectedDraftVersion: 0 }) }), env);
  assert.equal(generated.status, 200);
  const providerInput = String(providerBodies[0].input);
  assert.match(providerInput, /2026가합12345/u);
  assert.match(providerInput, /officialSourceUrl/u);
  assert.match(providerInput, /Litigation facts require VERIFIED/u);
  assert.doesNotMatch(providerInput, /attacker\.example/u);
  sql.close();
});

test('CF13 routes POST-01 to a responsive, honest court-case workspace', () => {
  const router = readFileSync(join(process.cwd(), 'apps', 'web', 'src', 'routes', 'Router.tsx'), 'utf8');
  const component = readFileSync(join(process.cwd(), 'apps', 'web', 'src', 'routes', 'PreviewLitigationCenter.tsx'), 'utf8');
  const css = readFileSync(join(process.cwd(), 'apps', 'web', 'src', 'routes', 'PreviewLitigationCenter.css'), 'utf8');
  assert.match(router, /currentRoute\.id === 'POST-01'.*PreviewLitigationCenter/u);
  assert.match(component, /공식 외부 자동조회는 아직 연결 전입니다/u);
  assert.match(component, /프로젝트 일정표에 공판 일정 동시 등록/u);
  assert.match(component, /REPORT EVIDENCE READY/u);
  assert.match(css, /@media \(max-width: 1024px\)/u);
  assert.match(css, /@media \(max-width: 680px\)/u);
});
